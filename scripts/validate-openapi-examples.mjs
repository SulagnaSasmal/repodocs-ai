import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import { assertPathsExist, displayPath, exitWithTargetError, parseTargets } from "./lib/cli-targets.mjs";
import { constraintProblem, expandShapes as expandSharedShapes, jsonType as sharedJsonType, resolveSchema as resolveSharedSchema, valueProblems } from "./lib/schema-values.mjs";
import { fencedBlocks, withoutFences } from "./lib/markdown-blocks.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

// Every example folder that `repodocs-ai init --with-examples` copies to an
// adopter, so a shipped example never fails their first run.
const scanDirectories = ["examples/api-docs", "examples/payments-api", "examples/complete-system", "generated"];
const supportedSpecExtensions = new Set([".yaml", ".yml", ".json"]);
const supportedMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(directory, extensions) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath, extensions)));
      continue;
    }

    if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }

  return files;
}

async function collectFromTarget(target, extensions) {
  const stats = await fs.stat(target).catch(() => null);
  if (!stats) {
    return [];
  }
  if (stats.isFile()) {
    return extensions.has(path.extname(target).toLowerCase()) ? [target] : [];
  }
  return collectFiles(target, extensions);
}

const skippedSpecs = [];

async function loadSpecs(specTargets) {
  const files = [];
  for (const target of specTargets) {
    files.push(...(await collectFromTarget(target, supportedSpecExtensions)));
  }
  const specs = [];

  for (const filePath of files) {
    const raw = await fs.readFile(filePath, "utf8");
    const spec = path.extname(filePath).toLowerCase() === ".json" ? JSON.parse(raw) : yaml.load(raw, { schema: yaml.CORE_SCHEMA });

    if (spec?.openapi && spec?.paths) {
      specs.push({ filePath, spec });
    } else if (spec?.swagger) {
      // Swagger 2.0 is not read; say so rather than skipping the file without a word.
      skippedSpecs.push(`${path.basename(filePath)} is Swagger ${spec.swagger}, not OpenAPI 3.x, so it was not checked; convert it (for example with swagger2openapi) to include it`);
    }
  }

  return specs;
}

function normalizeRoute(route) {
  return route.replace(/\{[^}]+\}/g, "{}");
}

function extractOperation(content) {
  const methodMatch = content.match(/- Method:\s*`?([A-Za-z]+)`?/);
  const urlMatch = content.match(/- URL:\s*`?([^`\s]+)`?/);
  if (!methodMatch || !urlMatch) {
    return null;
  }

  const method = methodMatch[1].toUpperCase();
  const url = urlMatch[1];
  if (!supportedMethods.has(method)) {
    return null;
  }

  return { method, url };
}

// Fenced code blocks in a piece of text. A fence of three or more backticks is
// closed by a fence at least as long, so content with ``` inside stays whole.
function codeBlocks(text) {
  return fencedBlocks(text).map((block) => ({ lang: block.lang, body: block.body }));
}

// curl commands in a piece of text, each with its continuation lines. A
// shell prompt ("$ curl") or comment lines before it do not hide it.
function curlCommands(text) {
  const commands = [];
  const lines = String(text || "").split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const start = /^\s*(?:\$\s+)?(curl\b.*)$/.exec(lines[index]);
    if (!start) continue;
    let command = start[1];
    // A command continues after a trailing backslash, or while a quoted
    // argument (a pretty-printed JSON body, say) is still open.
    const openQuote = (text) => {
      let quote = null;
      for (let position = 0; position < text.length; position += 1) {
        const character = text[position];
        if (quote === "'") {
          if (character === "'") quote = null;
        } else if (quote === '"') {
          if (character === "\\") position += 1;
          else if (character === '"') quote = null;
        } else if (character === "\\") {
          position += 1;
        } else if (character === "'" || character === '"') {
          quote = character;
        }
      }
      return quote !== null;
    };
    while ((/\\\s*$/.test(lines[index]) || openQuote(command)) && index + 1 < lines.length) {
      index += 1;
      command += `\n${lines[index]}`;
    }
    commands.push(command);
  }
  return commands;
}

function requestCurls(content) {
  return codeBlocks(sectionText(content, "Request Example")).flatMap((block) => curlCommands(block.body));
}

// The curl command in the Request Example section, if there is one.
function requestCurl(content) {
  return requestCurls(content)[0] || "";
}

function extractResponseJson(content) {
  // Only the Response Example section's own JSON block, never a later one.
  const block = codeBlocks(sectionText(content, "Response Example")).find((candidate) => candidate.lang === "json");
  if (!block) {
    return null;
  }

  try {
    return JSON.parse(block.body);
  } catch {
    return { __parseError: true };
  }
}

function extractRequestJson(content) {
  const curlBlock = requestCurl(content);
  if (!curlBlock) {
    return null;
  }

  const bodyMatch = curlBlock.match(/(?:-d|--data|--data-raw)\s+'((?:[^']|'\\'')*)'\s*$/m);
  if (!bodyMatch) {
    return null;
  }

  try {
    return JSON.parse(bodyMatch[1].replace(/'\\''/g, "'"));
  } catch {
    return { __parseError: true };
  }
}

const parameterSections = [
  ["Parameters", null],
  ["Path Parameters", "path"],
  ["Query Parameters", "query"],
  ["Header Parameters", "header"],
  ["Cookie Parameters", "cookie"]
];

// Documented parameters from every parameter table: name, location, Required cell.
function extractDocumentedParameters(content) {
  return parameterSections.flatMap(([heading, location]) =>
    tableRows(content, heading).map((cells) => ({ name: cells[0], type: cells[1], location, required: cells[2]?.toLowerCase(), description: cells[3] }))
  );
}

function extractParameterNames(content) {
  return extractDocumentedParameters(content).map((parameter) => parameter.name);
}

function extractCurlUrl(content) {
  return curlUrl(requestCurl(content));
}

// The URL a curl command calls, with any -G data added to its query.
function curlUrl(command) {
  const parsed = parseCurl(command);
  if (!parsed.url) return null;
  try {
    const url = new URL(parsed.url);
    if (parsed.get) {
      for (const pair of parsed.dataPairs) {
        const separator = pair.indexOf("=");
        if (separator > 0) url.searchParams.append(pair.slice(0, separator), pair.slice(separator + 1));
      }
    }
    return url;
  } catch {
    return null;
  }
}

// Spec routes by their normalised form, built once per spec, so finding the
// operation for each doc does not scan every path (quadratic for big specs).
const routeIndexes = new WeakMap();
function routeIndex(spec) {
  if (!routeIndexes.has(spec)) {
    const index = new Map();
    for (const specRoute of Object.keys(spec.paths || {})) {
      const key = normalizeRoute(specRoute);
      index.set(key, [...(index.get(key) || []), specRoute]);
    }
    routeIndexes.set(spec, index);
  }
  return routeIndexes.get(spec);
}

function findSpecOperations(specs, route, method) {
  const lowerMethod = method.toLowerCase();
  const normalizedRoute = normalizeRoute(route);
  const matches = [];

  for (const { filePath, spec } of specs) {
    for (const specRoute of routeIndex(spec).get(normalizedRoute) || []) {
      const pathItem = spec.paths[specRoute];
      const operation = pathItem?.[lowerMethod];
      if (operation) {
        matches.push({ filePath, spec, pathItem, operation, route: specRoute });
      }
    }
  }

  return matches;
}

// Follows local $ref pointers and flattens allOf, so schemas defined under
// components are compared instead of being silently skipped.
function resolveSchema(spec, schema) {
  return resolveSharedSchema(spec, schema);
}

function resolveRef(spec, value) {
  let resolved = value;
  for (let depth = 0; resolved?.$ref && typeof resolved.$ref === "string" && resolved.$ref.startsWith("#/") && depth < 20; depth += 1) {
    resolved = resolved.$ref.slice(2).split("/").reduce((current, segment) => current?.[segment], spec);
  }
  return resolved;
}

// The JSON media type of a content map: application/json or any +json type.
function jsonSchemaOf(content) {
  if (!content) {
    return undefined;
  }
  const type = Object.keys(content).find((key) => key === "application/json") || Object.keys(content).find((key) => /[/+]json(;|$)/i.test(key));
  return type ? content[type]?.schema : undefined;
}

// The object shapes a schema allows: its variants for oneOf/anyOf, otherwise itself.
function shapesOf(spec, schema) {
  const resolved = resolveSchema(spec, schema);
  if (!resolved) {
    return [];
  }
  const variants = !resolved.properties ? (resolved.oneOf || resolved.anyOf) : null;
  if (Array.isArray(variants) && variants.length > 0) {
    return variants.map((variant) => resolveSchema(spec, variant)).filter(Boolean);
  }
  return [resolved];
}

function allowedProperties(shapes) {
  const properties = {};
  for (const shape of shapes) {
    Object.assign(properties, shape.properties || {});
  }
  return properties;
}

function successResponse(spec, operation) {
  const success = Object.entries(operation.responses || {}).find(([code]) => code.startsWith("2"));
  return success ? resolveRef(spec, success[1]) : undefined;
}

function extractSchemaProperties(spec, operation) {
  const shapes = shapesOf(spec, jsonSchemaOf(successResponse(spec, operation)?.content));
  return shapes.length > 0 && shapes.some((shape) => shape.properties) ? allowedProperties(shapes) : null;
}

function extractRequestSchema(spec, operation) {
  return resolveSchema(spec, jsonSchemaOf(resolveRef(spec, operation.requestBody)?.content)) || null;
}

function definedParameters(spec, pathItem, operation) {
  const byKey = new Map();
  for (const parameter of [...(pathItem.parameters || []), ...(operation.parameters || [])]) {
    const resolved = resolveRef(spec, parameter);
    if (resolved?.name && resolved?.in) {
      byKey.set(`${resolved.in}:${resolved.name}`, resolved);
    }
  }
  return [...byKey.values()];
}

function collectDefinedParameterNames(pathItem, operation, spec) {
  return new Set(definedParameters(spec, pathItem, operation).map((parameter) => parameter.name));
}

// Cells of one table row. Hand-written tables often wrap the name, type and
// Required cells in backticks (`status`); those are read without them.
function splitRow(line) {
  return line
    .split(/(?<!\\)\|/)
    .slice(1, -1)
    .map((cell) => cell.trim())
    .map((cell, index) => (index < 3 ? cell.replace(/^`([^`]*)`$/, "$1") : cell))
    // The Required column: required/optional and true/false mean yes/no.
    .map((cell, index) => (index === 2 ? ({ required: "yes", true: "yes", mandatory: "yes", optional: "no", false: "no" }[cell.toLowerCase()] || cell) : cell))
    // Generated docs escape "<" outside code (array&lt;string&gt;); compare the text.
    .map((cell) => cell.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
}

// Rows of a Markdown table under a "## <heading>" section: [first cell, third cell].
// GFM tables may leave out the outer pipes ("a | b | c"). Rows of a table
// block (consecutive lines around a --- separator) get them back, so every
// reader sees the same cells.
function normalizeTables(text) {
  const lines = String(text).split(/\r?\n/);
  const separator = (line) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/.test(line);
  const blocks = [];
  lines.forEach((line, index) => {
    if (!separator(line)) return;
    let start = index - 1;
    while (start > 0 && lines[start - 1].trim() !== "" && /(?<!\\)\|/.test(lines[start - 1])) start -= 1;
    let end = index + 1;
    while (end < lines.length && lines[end].trim() !== "" && /(?<!\\)\|/.test(lines[end])) end += 1;
    blocks.push([Math.max(start, 0), end]);
  });
  for (const [start, end] of blocks) {
    for (let index = start; index < end; index += 1) {
      let line = lines[index].trim();
      if (!line.startsWith("|")) line = `| ${line}`;
      if (!/(?<!\\)\|$/.test(line)) line = `${line} |`;
      lines[index] = line;
    }
  }
  return lines.join("\n");
}

function tableRows(content, heading, minCells = 3) {
  const found = new RegExp(`(^|\\n)## ${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\r?\\n`).exec(content);
  if (!found) {
    return [];
  }
  const start = found.index + found[1].length;
  const next = content.indexOf("\n## ", start + 3);
  const body = normalizeTables(content.slice(start, next === -1 ? undefined : next));
  // Header rows are the ones directly above a | --- | separator line.
  const lines = body.split(/\r?\n/).map((line) => line.trim());
  const isSeparator = (line) => /^\|\s*:?-{3}/.test(line);
  return lines
    .filter((line, index) => line.startsWith("|") && !isSeparator(line) && !isSeparator(lines[index + 1] || ""))
    .map((line) => splitRow(line))
    .filter((cells) => cells.length >= minCells && cells[0] && cells[0] !== "None");
}

// Every object shape a schema can take, following oneOf/anyOf variants.
function expandShapes(spec, schema, depth = 0) {
  return expandSharedShapes(spec, schema, depth);
}

// Checks a JSON example against the schema at every depth: unknown fields
// and values outside an enum. For oneOf/anyOf, the example must fit one
// shape on its own, so fields from different options cannot be mixed.
function checkJsonValue(spec, value, schema, label, kind, depth = 0) {
  return valueProblems(spec, value, [schema], kind, label, depth);
}


// A value outside the schema's range, length or format.
function valueConstraintError(value, shape) {
  return constraintProblem(value, shape);
}

// Required fields an example leaves out, at every depth, for schemas with a
// single shape (oneOf/anyOf shapes are compared by the type checks instead).
function missingRequiredFields(spec, value, schema, label = "", depth = 0) {
  const resolved = resolveSchema(spec, schema);
  if (!resolved || depth > 8 || resolved.oneOf || resolved.anyOf) {
    return [];
  }
  if (Array.isArray(value)) {
    return value.length > 0 ? missingRequiredFields(spec, value[0], resolved.items, `${label}[]`, depth + 1) : [];
  }
  if (!value || typeof value !== "object") {
    return [];
  }
  const missing = (resolved.required || []).filter((key) => !(key in value) && !resolveSchema(spec, resolved.properties?.[key])?.writeOnly).map((key) => (label ? `${label}.${key}` : key));
  for (const [key, child] of Object.entries(value)) {
    if (resolved.properties?.[key]) {
      missing.push(...missingRequiredFields(spec, child, resolved.properties[key], label ? `${label}.${key}` : key, depth + 1));
    }
  }
  return missing;
}

// The header cells of the first table under a "## <heading>" section.
function sectionTableHeader(content, heading) {
  const section = sectionText(content, heading);
  const line = (section || "").split(/\r?\n/).find((candidate) => /^\s*\|.*\|\s*$/.test(candidate));
  return line ? line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim()) : null;
}

// What a curl command sends: method, headers, cookies, body, Basic auth.
function parseCurl(text) {
  const joined = String(text).replace(/\\\n\s*/g, " ");
  const tokens = [];
  // A shell word can join quoted and unquoted pieces: "abc"'!'"def".
  const word = /(?:"(?:[^"\\]|\\.)*"|'[^']*'|[^\s"']+)+/g;
  const piece = /"((?:[^"\\]|\\.)*)"|'([^']*)'|([^\s"']+)/g;
  for (const match of joined.match(word) || []) {
    let text = "";
    for (const part of match.matchAll(piece)) {
      text += part[1] !== undefined ? part[1].replace(/\\(.)/g, "$1") : part[2] !== undefined ? part[2] : part[3];
    }
    tokens.push(text);
  }
  const result = { method: null, rawMethod: null, url: null, get: false, headers: new Map(), headerNames: new Map(), cookies: new Set(), cookiePairs: [], hasBody: false, multipart: false, basicAuth: false, formFields: [], dataPairs: [], dataArgs: [] };
  const addCookies = (text) => text.split(";").map((pair) => pair.trim()).filter(Boolean).forEach((pair) => {
    const separator = pair.indexOf("=");
    const name = (separator > 0 ? pair.slice(0, separator) : pair).trim();
    result.cookies.add(name);
    result.cookiePairs.push({ name, value: separator > 0 ? decodeURIComponentSafe(pair.slice(separator + 1).trim()) : "" });
  });
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1] || "";
    if (index > 0 && !result.url && /^https?:\/\//i.test(token)) {
      result.url = token;
    } else if (index > 0 && !result.url && !result.varUrl && /^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?\//.test(token)) {
      result.varUrl = token; // "$BASE_URL/payments": the server is in a variable
    } else if (token === "--url") {
      result.url = next;
      index += 1;
    } else if (/^-X[A-Za-z]+$/.test(token)) {
      result.rawMethod = token.slice(2);
      result.method = token.slice(2).toUpperCase(); // -XPOST
    } else if (token === "-G" || token === "--get") {
      result.get = true;
    } else if (token === "--form-string" || token === "-F" || token === "--form") {
      const separator = next.indexOf("=");
      if (separator > 0) {
        const raw = next.slice(separator + 1);
        // -F reads a file for @path and <path; --form-string never does.
        result.formFields.push({ name: next.slice(0, separator), value: raw, file: token !== "--form-string" && /^[@<]/.test(raw) ? raw.slice(1).split(";")[0] : null });
      }
      result.hasBody = true;
      result.multipart = true;
      index += 1;
    } else if (token === "-X" || token === "--request") {
      result.rawMethod = next;
      result.method = next.toUpperCase();
      index += 1;
    } else if (token === "-H" || token === "--header") {
      const separator = next.indexOf(":");
      if (separator > 0) {
        const name = next.slice(0, separator).trim();
        result.headers.set(name.toLowerCase(), next.slice(separator + 1).trim());
        result.headerNames.set(name.toLowerCase(), name);
        if (name.toLowerCase() === "cookie") {
          addCookies(next.slice(separator + 1));
        }
      }
      index += 1;
    } else if (token === "-b" || token === "--cookie") {
      addCookies(next);
      index += 1;
    } else if (/^(-d|--data|--data-raw|--data-binary|--data-urlencode|--json)$/.test(token)) {
      result.hasBody = true;
      result.dataArgs.push({ flag: token, value: next });
      if (/^[^={}[\]"']+=/.test(next) || token === "--data-urlencode") {
        if (token === "--data-urlencode") result.dataPairs.push(next);
        else next.split("&").forEach((pair) => result.dataPairs.push(decodeURIComponentSafe(pair)));
      }
      if (token === "--json") result.headers.set("content-type", "application/json");
      index += 1;
    } else if (token === "-F" || token === "--form") {
      result.hasBody = true;
      result.multipart = true;
      index += 1;
    } else if (token === "-u" || token === "--user") {
      result.basicAuth = true;
      index += 1;
    }
  }
  // -G sends the data in the query string of a GET, not as a body.
  if (result.get) {
    result.hasBody = false;
    result.method = result.method || "GET";
  }
  return result;
}

function decodeURIComponentSafe(text) {
  try {
    return decodeURIComponent(String(text).replace(/\+/g, " "));
  } catch {
    return text;
  }
}

function credentialLabel(scheme, name) {
  if (scheme.type === "http" && /basic/i.test(scheme.scheme)) return "Basic credentials (-u)";
  if (scheme.type === "http" || scheme.type === "oauth2" || scheme.type === "openIdConnect") return "an Authorization header";
  if (scheme.type === "apiKey") return `the ${scheme.in || "header"} '${scheme.name || name}'`;
  return `'${name}'`;
}

// The basic types a oneOf/anyOf allows, such as ["string", "number"].
function choiceTypes(spec, schema) {
  const resolved = resolveSchema(spec, schema) || {};
  const choices = resolved.oneOf || resolved.anyOf;
  if (resolved.type || !Array.isArray(choices)) {
    return [];
  }
  return [...new Set(choices.map((choice) => basicType(spec, choice)).filter(Boolean))];
}

// The JSON type of a value, in schema terms.
function jsonType(value) {
  return sharedJsonType(value);
}


// Every property schema a table row name can point at, such as
// "channel.from.type" or "items[].id", across all oneOf/anyOf options, with
// whether its parent marks it required. Property names may contain dots.
function fieldCandidates(spec, shapes, name, depth = 0) {
  const candidates = [];
  if (depth > 6) {
    return candidates;
  }
  for (const shape of shapes.flatMap((candidate) => expandShapes(spec, candidate))) {
    const required = new Set(shape.required || []);
    for (const [property, propertySchema] of Object.entries(shape.properties || {})) {
      for (const suffix of ["", "[]"]) {
        const head = property + suffix;
        const next = suffix ? resolveSchema(spec, propertySchema)?.items : propertySchema;
        if (!next) {
          continue;
        }
        if (name === head) {
          candidates.push({ schema: next, required: required.has(property), readOnly: Boolean(resolveSchema(spec, propertySchema)?.readOnly) });
        } else if (name.startsWith(`${head}.`)) {
          candidates.push(...fieldCandidates(spec, [next], name.slice(head.length + 1), depth + 1));
        }
      }
    }
  }
  return candidates;
}

function schemaForField(spec, shapes, name) {
  return fieldCandidates(spec, shapes, name)[0]?.schema || null;
}

// The values listed after the last "Allowed values:" in a table cell. The
// generator appends this note after the spec's own description, which may
// contain the same words.
function listedAllowedValues(description, specDescription = "") {
  // The generator writes: Allowed values: `a`, `b`, `c`
  // Hand-written docs also say "One of: `a`, `b` or `c`" or "Possible values: ...".
  const matches = [...description.matchAll(/(?:Allowed values|One of|Possible values|Valid values|Accepted values)\s*:?\s*((?:`[^`]*`(?:,?\s*(?:or\s+|and\s+)?)?)+)/gi)];
  if (matches.length > 0) {
    return [...matches[matches.length - 1][1].matchAll(/`([^`]*)`/g)].map((match) => match[1]);
  }
  // A hand-written plain list at the end of the cell: Allowed values: a, b.
  // Skipped when the spec's own description says "Allowed values", since
  // that text was copied from the spec, not written as a list.
  if (/Allowed values/i.test(specDescription)) {
    return null;
  }
  const plain = description.match(/Allowed values: ([A-Za-z0-9_.:-]+(?:, [A-Za-z0-9_.:-]+)*)\.?\s*$/);
  return plain ? plain[1].split(", ") : null;
}

// The Default, Format, Minimum and Maximum notes in a table cell, each
// compared with the schema. A note the spec's own description also contains
// is skipped: the doc may just repeat the spec's prose.
function constraintNoteProblems(spec, schema, description, label, ownerDescription = "") {
  const resolved = resolveSchema(spec, schema) || {};
  // The parameter's own description counts too: a note copied from it is the spec's prose.
  const specDescription = `${resolved.description || ""} ${ownerDescription || ""}`;
  const problems = [];
  const specValues = {
    Default: resolved.default === undefined ? undefined : typeof resolved.default === "object" ? JSON.stringify(resolved.default) : String(resolved.default),
    Format: resolved.format,
    Minimum: resolved.minimum === undefined ? undefined : String(resolved.minimum),
    Maximum: resolved.maximum === undefined ? undefined : String(resolved.maximum),
    "Minimum length": resolved.minLength === undefined ? undefined : String(resolved.minLength),
    "Maximum length": resolved.maxLength === undefined ? undefined : String(resolved.maxLength)
  };
  for (const [note, specValue] of Object.entries(specValues)) {
    if (new RegExp(`${note}:`).test(specDescription)) {
      continue;
    }
    let documented = listedNote(description, note);
    if (documented !== undefined && note === "Format" && !/^[A-Za-z0-9-]+$/.test(documented)) {
      documented = undefined; // a pattern such as `YYYY-MM-DD`, not a format name
    }
    if (documented !== undefined && /^(Minimum|Maximum)/.test(note)) {
      documented = documented.match(/^-?\d+(?:\.\d+)?/)?.[0]; // "1, maximum: 100" reads as 1
    }
    if (documented !== undefined && documented !== specValue) {
      problems.push(`${label} says ${note}: ${documented}, but the spec says ${specValue === undefined ? `no ${note.toLowerCase()}` : specValue}`);
    }
  }
  return problems;
}

// Request Body table rows with the option each belongs to: from a
// "### Option N" heading, or an "Option N of M" label in the description.
function requestBodyRowsWithOption(content) {
  const section = normalizeTables(sectionText(content, "Request Body") || "");
  const rows = [];
  let headingOption = "";
  const lines = section.split(/\r?\n/).map((line) => line.trim());
  const isSeparator = (line) => /^\|\s*:?-{3}/.test(line);
  lines.forEach((line, index) => {
    const heading = line.match(/^### Option (\d+)/);
    if (heading) {
      headingOption = heading[1];
      return;
    }
    if (!line.startsWith("|") || isSeparator(line) || isSeparator(lines[index + 1] || "")) {
      return;
    }
    const cells = splitRow(line);
    if (cells.length < 3 || !cells[0] || cells[0] === "None") {
      return;
    }
    const label = (cells[3] || "").match(/^Option (\d+) of \d+/)?.[1] || "";
    rows.push({ cells, option: `${headingOption}/${label}` });
  });
  return rows;
}

function listedNote(description, label) {
  return description.match(new RegExp(`(?:^|\\. )${label}: ([^|]+?)(?:\\. [A-Z][a-z]+(?: [a-z]+)?:|\\.\\s*$|$)`))?.[1]?.trim();
}

// A text value (a header, cookie, path segment or form field) against its schema.
function parameterValueProblem(spec, parameter, value) {
  if (/^\{[^}]+\}$|^<[^>]+>$|^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?$/.test(value)) {
    return null; // a placeholder or shell variable
  }
  const schema = resolveSchema(spec, parameter.schema) || {};
  const type = [].concat(schema.type || []).find((candidate) => candidate !== "null");
  if (Array.isArray(schema.enum) && !schema.enum.map(String).includes(value)) {
    return `uses '${value}', which is not one of its allowed values (${schema.enum.join(", ")})`;
  }
  const typed = type === "integer" ? (/^-?\d+$/.test(value) ? Number(value) : undefined)
    : type === "number" ? (/^-?\d+(\.\d+)?$/.test(value) ? Number(value) : undefined)
    : type === "boolean" ? (/^(true|false)$/.test(value) ? value === "true" : undefined)
    : value;
  if (typed === undefined) {
    return `uses '${value}', which is not a valid ${type}`;
  }
  return type === "array" || type === "object" ? null : valueConstraintError(typed, schema);
}

function basicType(spec, schema) {
  const resolved = resolveSchema(spec, schema);
  if (!resolved) {
    return null;
  }
  if (resolved.type) {
    return resolved.type;
  }
  if (resolved.properties) {
    return "object";
  }
  return null;
}

function serverBases(spec) {
  return (spec.servers || []).map((server) =>
    String(server.url || "").replace(/\{([^}]+)\}/g, (match, name) => String(server.variables?.[name]?.default ?? server.variables?.[name]?.enum?.[0] ?? match)).replace(/\/$/, "")
  );
}

function statusCodeAllowed(code, responses) {
  const codes = Object.keys(responses || {});
  return codes.includes(code) || codes.includes(`${code[0]}XX`) || codes.includes(`${code[0]}xx`);
}

function scoreOperationMatch(candidate, route, requestJson, responseJson, documentedParameters) {
  let score = candidate.route === route ? 5 : 0;

  const allowedRequestProperties = allowedProperties(shapesOf(candidate.spec, extractRequestSchema(candidate.spec, candidate.operation)));
  const allowedResponseProperties = extractSchemaProperties(candidate.spec, candidate.operation) || {};
  const definedParameters = collectDefinedParameterNames(candidate.pathItem, candidate.operation, candidate.spec);

  if (requestJson && typeof requestJson === "object" && !Array.isArray(requestJson)) {
    for (const key of Object.keys(requestJson)) {
      score += key in allowedRequestProperties ? 3 : -4;
    }
  }

  if (responseJson && typeof responseJson === "object" && !Array.isArray(responseJson)) {
    for (const key of Object.keys(responseJson)) {
      score += key in allowedResponseProperties ? 2 : -3;
    }
  }

  for (const name of documentedParameters) {
    score += definedParameters.has(name) ? 3 : -4;
  }

  return score;
}

function findBestSpecOperation(specs, route, method, requestJson, responseJson, documentedParameters, docPath = "", exampleUrl = null) {
  const candidates = findSpecOperations(specs, route, method);
  if (candidates.length === 0) {
    return null;
  }

  // When several specs define the operation, the one in the doc's own folder,
  // or the nearest folder above it, describes it.
  const proximity = (candidate) => {
    const specDirectory = path.dirname(path.resolve(candidate.filePath));
    const docDirectory = path.dirname(path.resolve(docPath || "."));
    const relative = path.relative(specDirectory, docDirectory);
    return docPath && !relative.startsWith("..") && !path.isAbsolute(relative) ? 100 - relative.split(path.sep).filter(Boolean).length : 0;
  };

  return candidates
    .map((candidate) => ({
      candidate,
      // The spec whose server the request example calls is the one it documents.
      score: scoreOperationMatch(candidate, route, requestJson, responseJson, documentedParameters) + proximity(candidate) +
        (exampleUrl && serverBases(candidate.spec).some((base) => /^https?:\/\//.test(base) && exampleUrl.href.startsWith(base)) ? 50 : 0)
    }))
    .sort((left, right) => right.score - left.score)[0].candidate;
}

function sectionText(content, heading) {
  // "## Heading" at the start of a line, so a "##### Heading" inside copied
  // spec prose is not taken for the section.
  const found = new RegExp(`(^|\\n)## ${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`).exec(content);
  if (!found) {
    return null;
  }
  const start = found.index + found[1].length;
  const next = content.indexOf("\n## ", start + 3);
  return content.slice(start, next === -1 ? undefined : next);
}

function securityRequirementsOf(spec, operation) {
  return operation ? (operation.security ?? spec.security ?? []) : (spec.security ?? []);
}

// Checks an Authentication section's wording against the security schemes in use.
// Header names the spec knows about anywhere: header parameters on any operation, or a
// name the API description itself mentions (APIs often describe their auth headers in prose).
const knownHeaderCache = new WeakMap();
function specKnownHeaderNames(spec) {
  if (knownHeaderCache.has(spec)) {
    return knownHeaderCache.get(spec);
  }
  const names = new Set();
  knownHeaderCache.set(spec, names);
  for (const pathItem of Object.values(spec.paths || {})) {
    for (const method of ["get", "put", "post", "delete", "patch", "head", "options"]) {
      if (!pathItem?.[method]) continue;
      for (const parameter of definedParameters(spec, pathItem, pathItem[method])) {
        if (parameter.in === "header" && parameter.name) names.add(parameter.name.toLowerCase());
      }
    }
  }
  const description = String(spec.info?.description || "");
  for (const found of description.matchAll(/([A-Za-z][A-Za-z0-9-]*)\s*:/g)) names.add(found[1].toLowerCase());
  return names;
}

function authenticationErrors(spec, authText, requirements, subject, operationParameters = null, warn = null) {
  const errors = [];
  const schemes = spec.components?.securitySchemes || {};
  const inUse = requirements.flatMap((requirement) => Object.keys(requirement || {}).map((name) => resolveRef(spec, schemes[name]) || {}));
  const requiresAuth = inUse.length > 0;
  // "Two operations need no authentication: ..." lists exceptions; it does not say the API is open.
  const saysNone = /no authentication/i.test(authText.replace(/[^.\n]*\bneeds? no authentication:[^\n]*/gi, ""));
  if (requiresAuth && saysNone) {
    errors.push(`Authentication says none is required, but the spec requires it for ${subject}`);
  }
  if (!requiresAuth && !saysNone && /authentication is required|bearer|oauth|basic auth/i.test(authText) && !/defines no security scheme/i.test(authText)) {
    errors.push(`Authentication says it is required, but the spec defines no security for ${subject}`);
  }
  if (!requiresAuth) {
    // With no scheme, credentials can only travel as the operation's own parameters.
    const headerNames = new Set((operationParameters || []).filter((parameter) => parameter.in === "header").map((parameter) => parameter.name.toLowerCase()));
    const knownElsewhere = specKnownHeaderNames(spec);
    for (const found of authText.matchAll(/\bheader\s+`([^`]+)`|`([^`]+)`\s+header\b|`([A-Za-z][A-Za-z0-9-]*)`/gi)) {
      const name = (found[1] || found[2] || found[3]).replace(/:.*$/, "").trim();
      const looksLikeHeader = Boolean(found[1] || found[2]) || /^(x-|api-|authorization$)/i.test(name);
      if (looksLikeHeader && /^[A-Za-z][A-Za-z0-9-]*$/.test(name) && !headerNames.has(name.toLowerCase())) {
        if (warn && knownElsewhere.has(name.toLowerCase())) {
          // The spec uses this header elsewhere but leaves it off this operation: a spec gap, not an invented header.
          warn(`Authentication names the header '${name}', which the spec uses elsewhere but does not declare on ${subject}; confirm with an SME`);
          continue;
        }
        errors.push(`Authentication names the header '${name}', but ${subject} has no such header parameter and the spec defines no security scheme`);
      }
    }
  }
  if (requiresAuth) {
    const has = (test) => inUse.some(test);
    const checks = [
      [/bearer/i, (scheme) => (scheme.type === "http" && /bearer/i.test(scheme.scheme)) || scheme.type === "oauth2" || scheme.type === "openIdConnect", "a Bearer token"],
      [/oauth/i, (scheme) => scheme.type === "oauth2" || scheme.type === "openIdConnect", "OAuth"],
      [/\bbasic\b/i, (scheme) => scheme.type === "http" && /basic/i.test(scheme.scheme), "Basic authentication"],
      [/API key in (header|query|cookie)/, (scheme) => scheme.type === "apiKey", "an API key"]
    ];
    const descriptions = inUse.map((scheme) => String(scheme.description || "")).join(" ");
    for (const [pattern, test, label] of checks) {
      if (pattern.test(authText) && !has(test) && !pattern.test(descriptions)) {
        errors.push(`Authentication mentions ${label}, but the spec's security for ${subject} does not use it`);
      }
    }
    // OAuth scopes: the ones the doc lists are the ones the operation requires.
    const oauthScopes = new Set(requirements.flatMap((requirement) => Object.entries(requirement || {})
      .filter(([name]) => ["oauth2", "openIdConnect"].includes(resolveRef(spec, schemes[name])?.type))
      .flatMap(([, scopes]) => (Array.isArray(scopes) ? scopes : []))));
    // "scopes: `a`, `b`" (as generated), or a plain list up to ")" or the end of the sentence.
    const scopeList = authText.match(/\bscopes?:\s*((?:`[^`]+`(?:\s*(?:,|\band\b|\bor\b)\s*)?)+)/i)?.[1]
      || authText.match(/\bscopes?:\s*([^)\n]+?)(?:\)|\.(?:\s|$)|\n|$)/i)?.[1];
    // Prose such as "a token with both the `a` and `b` scopes": the code spans
    // in the sentences that mention scopes.
    const spans = "`[^`]+`(?:\\s*(?:,|\\band\\b|\\bor\\b)\\s*`[^`]+`)*";
    const proseScopes = scopeList ? null : [
      ...authText.matchAll(new RegExp(`(${spans})\\s+scopes?\\b`, "gi")),
      ...authText.matchAll(new RegExp(`\\bscopes?\\s+(${spans})`, "gi"))
    ].map((found) => found[1]).join(", ");
    const listedScopes = scopeList || proseScopes || null;
    const usesOAuth = inUse.some((scheme) => scheme.type === "oauth2" || scheme.type === "openIdConnect");
    if (!usesOAuth) {
      // Scopes belong to OAuth; a Bearer scheme's prose may mention them freely.
    } else if (listedScopes) {
      const documented = new Set((listedScopes.includes("`") ? [...listedScopes.matchAll(/`([^`]+)`/g)].map((found) => found[1]) : listedScopes.split(/,|\band\b|\bor\b/)).map((entry) => entry.replace(/[`*]/g, "").trim()).filter(Boolean));
      const invented = [...documented].filter((scope) => !oauthScopes.has(scope));
      const missing = [...oauthScopes].filter((scope) => !documented.has(scope));
      if (invented.length > 0) {
        errors.push(`Authentication lists the OAuth scope${invented.length === 1 ? "" : "s"} ${invented.join(", ")}, which the spec does not require for ${subject}${oauthScopes.size ? ` (it requires ${[...oauthScopes].join(", ")})` : ""}`);
      }
      if (missing.length > 0 && subject !== "the API") {
        errors.push(`Authentication leaves out the OAuth scope${missing.length === 1 ? "" : "s"} ${missing.join(", ")}, which the spec requires for ${subject}`);
      }
    } else if (oauthScopes.size > 0 && subject !== "the API" && /oauth|bearer/i.test(authText)) {
      errors.push(`Authentication does not say which OAuth scopes ${subject} needs; the spec requires ${[...oauthScopes].join(", ")}`);
    }
    // A header named in the prose ("header `X-API-Key`") must be one the spec uses.
    const knownHeaders = new Set(inUse.filter((scheme) => scheme.type === "apiKey" && scheme.in === "header").map((scheme) => String(scheme.name).toLowerCase()));
    if (inUse.some((scheme) => scheme.type !== "apiKey")) knownHeaders.add("authorization");
    for (const found of authText.matchAll(/\bheader\s+`([^`]+)`|`([^`]+)`\s+header\b/gi)) {
      const name = (found[1] || found[2]).replace(/:.*$/, "").trim();
      if (/^[A-Za-z][A-Za-z0-9-]*$/.test(name) && !knownHeaders.has(name.toLowerCase()) && !descriptions.toLowerCase().includes(name.toLowerCase())) {
        errors.push(`Authentication names the header '${name}', but the spec's security for ${subject} uses ${[...knownHeaders].join(", ") || "no header"}`);
      }
    }
  }
  return errors;
}

function routePattern(route) {
  return new RegExp(`^${route.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\\\{[^}]+\\\}|\{[^}]+\}/g, "[^/]+")}$`);
}

// Warnings do not fail the run: things worth fixing before publishing that a
// hand-written doc may leave out on purpose.
const warnings = [];

function checkEndpointDoc(content, relativePath, match, operationRef, requestJson, responseJson) {
  const errors = [];
  const add = (message) => errors.push(`${relativePath}: ${message}`);
  const warn = (message) => warnings.push(`${relativePath}: ${message}`);
  const specName = path.basename(match.filePath);
  const spec = match.spec;
  const operation = match.operation;
  const requestBody = resolveRef(spec, operation.requestBody);
  const requestSchemaJson = extractRequestSchema(spec, operation);
  const requestShapes = shapesOf(spec, requestSchemaJson);

  // A section under another name is not checked, so a rename would switch
  // the comparison off without a word.
  const sectionNames = [
    ["Request Example", /^##\s+(?:example requests?|request examples|sample requests?|requests?|example|examples|curl example)\s*$/im],
    ["Response Example", /^##\s+(?:example responses?|response examples|sample responses?|responses?)\s*$/im],
    ["Error Codes", /^##\s+(?:errors?|error responses|error codes and messages|status codes|errors and status codes)\s*$/im],
    ["Request Body", /^##\s+(?:body|request|request payload|payload|request schema)\s*$/im]
  ];
  for (const [expected, alias] of sectionNames) {
    const renamed = content.match(alias);
    if (sectionText(content, expected) === null && renamed) {
      add(`the doc has '${renamed[0].trim()}' but no '## ${expected}' section, so it was not compared with ${specName}; name the section '## ${expected}'`);
    }
  }
  for (const expected of ["Summary", "Request Example", "Response Example", "Error Codes"]) {
    if (sectionText(content, expected) === null && !sectionNames.some(([name, alias]) => name === expected && alias.test(content))) {
      warn(`the doc has no '## ${expected}' section`);
    }
  }

  // Request example JSON.
  if (requestShapes.length > 0) {
    if (!requestJson) {
      add("request body schema exists but no JSON request example was found");
    } else if (requestJson.__parseError !== true) {
      for (const message of checkJsonValue(spec, requestJson, requestSchemaJson, "", "request")) {
        add(`${message} in ${specName}`);
      }
    }
    if (requestJson && typeof requestJson === "object" && !Array.isArray(requestJson) && requestJson.__parseError !== true) {
      const missingByShape = requestShapes.map((shape) => (shape.required || []).filter((key) => !(key in requestJson)));
      if (!missingByShape.some((missing) => missing.length === 0)) {
        const fewest = missingByShape.reduce((best, missing) => (missing.length < best.length ? missing : best));
        for (const key of fewest) {
          add(`request example is missing required field '${key}' from ${specName}`);
        }
      }
    }
  }

  // Response example JSON.
  const success = Object.entries(operation.responses || {}).find(([code]) => code.startsWith("2"));
  const successSchema = jsonSchemaOf(successResponse(spec, operation)?.content);
  // Each section once: a second "## Response Example" would hide the real one.
  for (const heading of ["Endpoint", "Request Example", "Response Example", "Request Body", "Error Codes"]) {
    const count = (content.match(new RegExp(`^## ${heading}\\s*$`, "gm")) || []).length;
    if (count > 1) {
      add(`has ${count} "## ${heading}" sections; only one is allowed`);
    }
  }
  // Every JSON block in the Response Example is an example of the success response.
  const allResponseJson = codeBlocks(sectionText(content, "Response Example")).filter((block) => block.lang === "json").slice(1);
  for (const block of allResponseJson) {
    try {
      const extra = JSON.parse(block.body);
      for (const message of checkJsonValue(spec, extra, successSchema, "", "response")) {
        add(`${message} in ${specName} (a second JSON block in the Response Example)`);
      }
    } catch {
      add(`a second JSON block in the Response Example is not valid JSON`);
    }
  }
  const responseProse = withoutFences(sectionText(content, "Response Example") || "");
  if (successSchema && /^(?: {4}|\t)[{[]/m.test(responseProse)) {
    add(`the Response Example has an indented code block, which is not compared; put the example in a \`\`\`json block`);
  }
  if (successSchema && sectionText(content, "Response Example") && !/^Status:\s*`?(?:\d{3}|[1-5]XX)\b/im.test(sectionText(content, "Response Example"))) {
    warn(`the Response Example has no "Status:" line, so the success status is not compared with ${specName}`);
  }
  // A Response Example whose JSON block lost its language would not be compared at all.
  const responseBlocks = codeBlocks(sectionText(content, "Response Example"));
  if (successSchema && responseBlocks.length > 0 && !responseBlocks.some((block) => block.lang === "json")) {
    add(`the Response Example has no \`json\` code block (found ${responseBlocks.map((block) => block.lang || "no language").join(", ")}), so it could not be compared with ${specName}`);
  }
  // Tables are read by column position, so their headers must say what each column is.
  for (const heading of ["Parameters", "Path Parameters", "Query Parameters", "Header Parameters", "Request Body"]) {
    const header = sectionTableHeader(content, heading);
    if (header && !(/name|field|parameter/i.test(header[0] || "") && /type/i.test(header[1] || "") && /required/i.test(header[2] || ""))) {
      warn(`the ${heading} table header is '${header.join(" | ")}'; the checks read columns in the order Name, Type, Required, Description`);
    }
  }

  if (responseJson && typeof responseJson === "object") {
    const responseShapes = shapesOf(spec, successSchema);
    for (const message of checkJsonValue(spec, responseJson, successSchema, "", "response")) {
      add(`${message} in ${specName}`);
    }
    // Spec examples often leave out required response fields, so this is a warning.
    for (const missing of missingRequiredFields(spec, responseJson, successSchema)) {
      warn(`response example leaves out '${missing}', which ${specName} marks as required`);
    }
  }

  // Error response body example.
  const errorBodyMatch = content.match(/Error response body \(`([^`]+)`\):\s*\n(`{3,})json[^\n]*\n([\s\S]*?)\n\2`*[ \t]*$/m);
  const errorBody = errorBodyMatch ? [errorBodyMatch[0], errorBodyMatch[1], errorBodyMatch[3]] : null;
  if (errorBody) {
    const errorResponse = resolveRef(spec, operation.responses?.[errorBody[1]]);
    if (!errorResponse) {
      add(`error response body is shown for '${errorBody[1]}', which is not a response of ${operationRef.method} ${operationRef.url}`);
    } else {
      try {
        const parsed = JSON.parse(errorBody[2]);
        for (const message of checkJsonValue(spec, parsed, jsonSchemaOf(errorResponse.content), "", "error response")) {
          add(`${message} in ${specName}`);
        }
      } catch {
        add("error response body example is not valid JSON");
      }
    }
  }

  // Parameter tables against the spec: existence, Required, type, default; every spec parameter documented.
  const specParameters = definedParameters(spec, match.pathItem, operation);
  const documentedParameters = extractDocumentedParameters(content);
  const seenParameters = new Set();
  for (const documented of documentedParameters) {
    const key = `${documented.location}:${documented.name}`;
    if (seenParameters.has(key)) {
      add(`parameter '${documented.name}' is listed more than once`);
    }
    seenParameters.add(key);
    const defined = specParameters.find((parameter) => parameter.name === documented.name && (!documented.location || parameter.in === documented.location));
    const deepRow = documented.name.match(/^([^[\]]+)\[([^[\]]+)\]$/);
    if (!defined && deepRow) {
      // A row for one key of a deepObject parameter, such as sort[by].
      const base = specParameters.find((parameter) => parameter.name === deepRow[1] && parameter.in === "query");
      const property = base ? resolveSchema(spec, base.schema)?.properties?.[deepRow[2]] : undefined;
      if (!property) {
        add(`parameter '${documented.name}' is not defined in ${specName}`);
        continue;
      }
      const propertyType = basicType(spec, property);
      const rowType = String(documented.type || "").replace(/<.*$/, "").trim();
      if (propertyType && /^(string|integer|number|boolean|object|array)$/.test(rowType) && rowType !== propertyType) {
        add(`parameter '${documented.name}' is documented as ${rowType}, but the spec says ${propertyType}`);
      }
      constraintNoteProblems(spec, property, documented.description || "", `parameter '${documented.name}'`).forEach(add);
      const rowListed = listedAllowedValues(documented.description || "", resolveSchema(spec, property)?.description || "");
      const rowEnum = resolveSchema(spec, property)?.enum;
      if (rowListed && (!rowEnum || [...rowListed].sort().join("|") !== rowEnum.map(String).sort().join("|"))) {
        add(`parameter '${documented.name}' lists allowed values (${rowListed.join(", ")}) that do not match the spec (${(rowEnum || []).join(", ") || "no enum"})`);
      }
      continue;
    }
    if (!defined) {
      add(`parameter '${documented.name}' is not defined in ${specName}`);
      continue;
    }
    const specRequired = defined.required ? "yes" : "no";
    if (documented.required && !/^(yes|no)$/i.test(documented.required)) {
      add(`parameter '${documented.name}' has '${documented.required}' in the Required column; write yes or no`);
    }
    if ((documented.required === "yes" || documented.required === "no") && documented.required !== specRequired) {
      add(`parameter '${documented.name}' is marked Required: ${documented.required}, but the spec says ${specRequired}`);
    }
    const specType = basicType(spec, defined.schema);
    const docType = String(documented.type || "").replace(/<.*$/, "").trim();
    if (specType && /^(string|integer|number|boolean|object|array)$/.test(docType) && docType !== specType) {
      add(`parameter '${documented.name}' is documented as ${docType}, but the spec says ${specType}`);
    }
    const parameterChoices = choiceTypes(spec, defined.schema);
    if (parameterChoices.length > 1 && /^(string|integer|number|boolean|object|array)$/.test(docType)) {
      add(`parameter '${documented.name}' is documented as ${docType}, but the spec allows ${parameterChoices.join(", ")}`);
    }
    if ((defined.deprecated || resolveSchema(spec, defined.schema)?.deprecated) && !/deprecated/i.test(documented.description || "")) {
      add(`parameter '${documented.name}' is deprecated in ${specName}, but the doc does not say so`);
    }
    constraintNoteProblems(spec, defined.schema, documented.description || "", `parameter '${documented.name}'`, defined.description).forEach(add);
    const parameterEnum = resolveSchema(spec, defined.schema)?.enum;
    const parameterListed = listedAllowedValues(documented.description || "", `${defined.description || ""} ${resolveSchema(spec, defined.schema)?.description || ""}`);
    if (parameterListed && (!parameterEnum || [...parameterListed].sort().join("|") !== parameterEnum.map(String).sort().join("|"))) {
      add(`parameter '${documented.name}' lists allowed values (${parameterListed.join(", ")}) that do not match the spec (${(parameterEnum || []).join(", ") || "no enum"})`);
    }
    if (!parameterListed && Array.isArray(parameterEnum) && parameterEnum.length > 0 && parameterEnum.length <= 20) {
      warn(`parameter '${documented.name}' does not list its allowed values (${parameterEnum.join(", ")}) from ${specName}`);
    }
  }
  const hasParameterTables = parameterSections.some(([heading]) => sectionText(content, heading) !== null);
  if (hasParameterTables) {
    for (const parameter of specParameters.filter((candidate) => ["path", "query", "header", "cookie"].includes(candidate.in))) {
      if (!documentedParameters.some((documented) => documented.name === parameter.name && (!documented.location || documented.location === parameter.in))) {
        // Headers that carry credentials are documented with the authentication, not the parameter tables.
        const credentialHeaders = securityRequirementsOf(spec, operation).flatMap((requirement) => Object.keys(requirement || {}))
          .map((name) => resolveRef(spec, spec.components?.securitySchemes?.[name]) || {})
          .filter((scheme) => scheme.type === "apiKey" && scheme.in === "header").map((scheme) => String(scheme.name).toLowerCase());
        const omittedHeader = parameter.in === "header" && (/^(authorization|content-type|accept)$/i.test(parameter.name) || credentialHeaders.includes(parameter.name.toLowerCase()));
        if (!omittedHeader) {
          // A required parameter must be documented; an optional one may be left out.
          (parameter.required ? add : warn)(`${parameter.required ? "required" : "optional"} ${parameter.in} parameter '${parameter.name}' from ${specName} is missing from the parameter tables`);
        }
      }
    }
  }

  // Request Body section and table.
  const bodySection = sectionText(content, "Request Body");
  const bodyRows = tableRows(content, "Request Body");
  if (requestBody?.content && bodySection !== null && /Not applicable\./.test(bodySection)) {
    add(`the spec defines a request body, but the Request Body section says "Not applicable."`);
  }
  if (requestBody?.content && bodySection === null && /## Request Example/.test(content)) {
    add("the spec defines a request body, but the doc has no Request Body section");
  }
  if (!requestBody?.content && bodyRows.length > 0) {
    add(`the Request Body table lists fields, but the spec defines no request body for ${operationRef.method} ${operationRef.url}`);
  }
  const bodyMedia = requestBody?.content ? Object.keys(requestBody.content) : [];
  if (bodySection && requestBody?.content) {
    if (/Request body is optional/i.test(bodySection) && requestBody.required === true) {
      add(`the Request Body says the body is optional, but the spec says it is required`);
    }
    if (/Request body is required/i.test(bodySection) && requestBody.required !== true) {
      add(`the Request Body says the body is required, but the spec says it is optional`);
    }
  }
  const curlContentType = content.match(/curl [\s\S]*?-H "Content-Type: ([^";]+)/i)?.[1]?.trim();
  if (curlContentType && bodyMedia.length > 0 && !bodyMedia.some((media) => media.split(";")[0].trim().toLowerCase() === curlContentType.toLowerCase())) {
    add(`the request example sends Content-Type ${curlContentType}, but the spec's request body types are ${bodyMedia.join(", ")}`);
  }
  const contentTypeNote = bodySection?.match(/Content type: `([^`]+)`/)?.[1];
  if (contentTypeNote && !bodyMedia.includes(contentTypeNote)) {
    add(`the Request Body says Content type: ${contentTypeNote}, but the spec's request body types are ${bodyMedia.join(", ") || "none"}`);
  }
  const tableSchema = requestSchemaJson || resolveSchema(spec, Object.values(requestBody?.content || {})[0]?.schema);
  const tableShapes = expandShapes(spec, tableSchema);
  if (tableShapes.length > 0 && bodyRows.length > 0) {
    const bodyIsRequired = requestBody?.required === true;
    const seenRows = new Set();
    for (const { cells: [name, type, flag, description = ""], option } of requestBodyRowsWithOption(content)) {
      const rowKey = `${option}|${name}`;
      if (seenRows.has(rowKey)) {
        add(`request field '${name}' is listed more than once in the Request Body table`);
      }
      seenRows.add(rowKey);
      const candidates = fieldCandidates(spec, tableShapes, name);
      if (candidates.length === 0) {
        add(`request field '${name}' in the Request Body table is not defined in ${specName}`);
        continue;
      }
      const isTopLevel = !/[.[\]]/.test(name);
      const problemsFor = (candidate) => {
        const problems = [];
        const specType = basicType(spec, candidate.schema);
        const docType = type.replace(/<.*$/, "").trim();
        if (specType && /^(string|integer|number|boolean|object|array)$/.test(docType) && docType !== specType) {
          problems.push(`request field '${name}' is documented as ${docType}, but the spec says ${specType}`);
        }
        const fieldChoices = choiceTypes(spec, candidate.schema);
        if (fieldChoices.length > 0 && /^(string|integer|number|boolean|object|array)$/.test(docType) && (fieldChoices.length > 1 || !fieldChoices.includes(docType))) {
          problems.push(`request field '${name}' is documented as ${docType}, but the spec allows ${fieldChoices.join(", ")}`);
        }
        if (resolveSchema(spec, candidate.schema)?.deprecated && !/deprecated/i.test(description)) {
          problems.push(`request field '${name}' is deprecated in ${specName}, but the doc does not say so`);
        }
        const listed = listedAllowedValues(description, resolveSchema(spec, candidate.schema)?.description || "");
        const specEnum = resolveSchema(spec, candidate.schema)?.enum;
        problems.push(...constraintNoteProblems(spec, candidate.schema, description, `request field '${name}'`));
        if (listed) {
          const documentedValues = [...listed].sort();
          const specValues = (specEnum || []).map(String).sort();
          if (!specEnum || documentedValues.join("|") !== specValues.join("|")) {
            problems.push(`request field '${name}' lists allowed values (${documentedValues.join(", ")}) that do not match the spec (${specValues.join(", ") || "no enum"})`);
          }
        }
        if (flag && !/^(yes|no|unspecified)$/i.test(flag)) {
          problems.push(`request field '${name}' has '${flag}' in the Required column; write yes or no`);
        }
        if ((flag === "yes" || flag === "no") && !(isTopLevel && bodyIsRequired === false && flag === "no" && !candidate.required)) {
          if ((flag === "yes") !== candidate.required) {
            problems.push(`request field '${name}' is marked Required: ${flag}, but the spec says ${candidate.required ? "yes" : "no"}`);
          }
        }
        if (candidate.readOnly) {
          problems.push(`request field '${name}' is readOnly in ${specName} and should not be listed as a request field`);
        }
        return problems;
      };
      const results = candidates.map(problemsFor);
      if (!results.some((problems) => problems.length === 0)) {
        results.reduce((best, problems) => (problems.length < best.length ? problems : best)).forEach(add);
      }
    }
    // Every top-level field of a single-shape body is documented, and every
    // required nested field of a documented parent.
    if (tableShapes.length === 1 && !content.includes("### Option 1")) {
      const documentedNames = new Set(bodyRows.map(([name]) => name));
      // A schema that contains itself is listed once by the generator, so a
      // cycle ends the walk here too.
      const nestedRequired = (schema, prefix, depth, ancestors = new Set()) => {
        const resolved = resolveSchema(spec, schema);
        // For an array the generator follows its items, so the items are what repeat.
        const followed = resolved?.type === "array" ? resolved.items : schema;
        const identity = typeof followed?.$ref === "string" ? followed.$ref : followed;
        if (!resolved || depth > 5 || ancestors.has(identity)) return [];
        ancestors = new Set(ancestors).add(identity);
        const target = resolved.type === "array" ? resolveSchema(spec, resolved.items) : resolved;
        const childPrefix = resolved.type === "array" ? `${prefix}[]` : prefix;
        if (!target?.properties || target.oneOf || target.anyOf) return [];
        return Object.entries(target.properties).flatMap(([key, child]) => {
          const name = `${childPrefix}.${key}`;
          const childSchema = resolveSchema(spec, child);
          if (childSchema?.readOnly) return [];
          const own = (target.required || []).includes(key) ? [name] : [];
          return [...own, ...(documentedNames.has(name) ? nestedRequired(child, name, depth + 1, ancestors) : [])];
        });
      };
      for (const [property, propertySchema] of Object.entries(tableShapes[0].properties || {})) {
        if (!documentedNames.has(property)) continue;
        for (const name of nestedRequired(propertySchema, property, 1)) {
          if (!documentedNames.has(name)) {
            add(`required request field '${name}' from ${specName} is missing from the Request Body table`);
          }
        }
      }
      for (const [property, propertySchema] of Object.entries(tableShapes[0].properties || {})) {
        if (!documentedNames.has(property) && !resolveSchema(spec, propertySchema)?.readOnly) {
          // A required field must be documented; an optional one may be left out.
          const fieldRequired = (tableShapes[0].required || []).includes(property);
          (fieldRequired ? add : warn)(`${fieldRequired ? "required" : "optional"} request field '${property}' from ${specName} is missing from the Request Body table`);
        }
      }
    }
  }

  // Authentication section.
  const authText = sectionText(content, "Authentication");
  if (authText) {
    authenticationErrors(spec, authText, securityRequirementsOf(spec, operation), `${operationRef.method} ${operationRef.url}`, specParameters, warn).forEach(add);
  }

  // The Endpoint URL's placeholders are the spec's own path parameter names.
  const endpointPlaceholders = (operationRef.url.match(/\{([^}]+)\}/g) || []).map((entry) => entry.slice(1, -1));
  const routePlaceholders = (match.route.match(/\{([^}]+)\}/g) || []).map((entry) => entry.slice(1, -1));
  if (endpointPlaceholders.join("|") !== routePlaceholders.join("|") && endpointPlaceholders.length === routePlaceholders.length) {
    add(`the Endpoint URL ${operationRef.url} names its path parameters {${endpointPlaceholders.join("}, {")}}, but the spec path is ${match.route}`);
  }

  // curl calls elsewhere in the doc (an "Additional examples" section, say)
  // must at least call a path and method the spec defines.
  const outsideRequestExample = sectionText(content, "Request Example") === null ? content : content.replace(sectionText(content, "Request Example"), "");
  guideCurlErrors(outsideRequestExample, relativePath, [{ filePath: match.filePath, spec }]).forEach((message) => errors.push(message));

  // Credentials the request example sends, against the operation's security.
  const curlText = requestCurl(content);
  const allRequestCurls = requestCurls(content);
  const curlCount = allRequestCurls.length;
  if (sectionText(content, "Request Example") && curlCount === 0) {
    warn(`the Request Example has no curl command, so the request was not compared with ${specName}`);
  }
  // Every curl in the Request Example calls this operation; the first is
  // compared in full, the others by method and path.
  for (const [position, command] of allRequestCurls.slice(1).entries()) {
    const extra = parseCurl(command);
    const extraMethod = extra.method || (extra.hasBody ? "POST" : "GET");
    const extraUrl = curlUrl(command);
    const base = extraUrl ? serverBases(spec).filter((candidate) => extraUrl.href.replace(/^http:/, "https:").startsWith(candidate.replace(/^http:/, "https:"))).sort((left, right) => right.length - left.length)[0] : null;
    const extraPath = extraUrl && base !== undefined && base !== null ? decodeURIComponent(extraUrl.pathname).slice(new URL(base).pathname.replace(/\/$/, "").length) || "/" : null;
    if (extraMethod !== operationRef.method || (extraPath !== null && !routePattern(match.route).test(extraPath))) {
      add(`curl command ${position + 2} in the Request Example sends ${extraMethod} ${extraPath ?? extraUrl?.pathname ?? "(no URL)"}, but this doc describes ${operationRef.method} ${operationRef.url}`);
    }
  }
  if (curlText) {
    const schemes = spec.components?.securitySchemes || {};
    const requirements = securityRequirementsOf(spec, operation);
    const inUse = requirements.flatMap((requirement) => Object.keys(requirement || {}).map((name) => resolveRef(spec, schemes[name]) || {}));
    const subject = `${operationRef.method} ${operationRef.url}`;
    const curl = parseCurl(curlText);
    const sendsBasic = curl.basicAuth || /^basic\b/i.test(curl.headers.get("authorization") || "");
    const sendsBearer = /^bearer\b/i.test(curl.headers.get("authorization") || "");
    // An API key sent in an Authorization header may carry any prefix the spec describes.
    const apiKeyInAuthorization = inUse.some((scheme) => scheme.type === "apiKey" && scheme.in === "header" && String(scheme.name).toLowerCase() === "authorization");
    // When the spec's description says how to send that key ("Bearer <key>"), the example must match.
    const authorizationScheme = inUse.find((scheme) => scheme.type === "apiKey" && scheme.in === "header" && String(scheme.name).toLowerCase() === "authorization");
    const expectedPrefix = String(authorizationScheme?.description || "").match(/\b(Bearer|Token|Basic|ApiKey)\s+</i)?.[1];
    const sentAuthorization = curl.headers.get("authorization") || "";
    // A shell variable ($API_KEY) may hold the whole value, prefix included.
    if (expectedPrefix && sentAuthorization && !sentAuthorization.startsWith("$") && !new RegExp(`^${expectedPrefix}\\s`, "i").test(sentAuthorization)) {
      add(`the request example sends 'Authorization: ${sentAuthorization}', but the spec says to send '${expectedPrefix} <key>'`);
    }
    if (curl.headers.has("authorization") && !sentAuthorization.trim()) {
      add(`the request example sends an empty Authorization header`);
    }
    // An Authorization header for an http or OAuth scheme uses that scheme's word.
    const httpSchemes = inUse.filter((scheme) => scheme.type === "http" || scheme.type === "oauth2" || scheme.type === "openIdConnect");
    if (!apiKeyInAuthorization && httpSchemes.length > 0 && sentAuthorization.trim() && !sentAuthorization.startsWith("$")) {
      const word = sentAuthorization.trim().split(/\s+/)[0].toLowerCase();
      const allowedWords = new Set(httpSchemes.map((scheme) => (scheme.type === "http" ? String(scheme.scheme || "").toLowerCase() : "bearer")));
      if (!allowedWords.has(word) && !(word === "basic" && curl.basicAuth)) {
        add(`the request example sends 'Authorization: ${sentAuthorization.split(/\s+/)[0]} ...', but the spec's security for ${subject} uses ${[...allowedWords].map((entry) => entry.charAt(0).toUpperCase() + entry.slice(1)).join(" or ")}`);
      }
    }
    if (sendsBasic && !apiKeyInAuthorization && !inUse.some((scheme) => scheme.type === "http" && /basic/i.test(scheme.scheme))) {
      add(`the request example sends Basic credentials, but the spec's security for ${subject} does not use Basic authentication`);
    }
    if (sendsBearer && !apiKeyInAuthorization && !inUse.some((scheme) => (scheme.type === "http" && /bearer/i.test(scheme.scheme)) || scheme.type === "oauth2" || scheme.type === "openIdConnect")) {
      add(`the request example sends a Bearer token, but the spec's security for ${subject} does not use one`);
    }

    // Credentials for at least one of the operation's security requirements.
    const authOptional = requirements.length === 0 || requirements.some((requirement) => !requirement || Object.keys(requirement).length === 0);
    if (!authOptional) {
      const curlUrl = extractCurlUrl(content);
      const sends = (scheme) => {
        if (scheme.type === "http" && /basic/i.test(scheme.scheme)) return sendsBasic;
        if (scheme.type === "http" || scheme.type === "oauth2" || scheme.type === "openIdConnect") return curl.headers.has("authorization");
        if (scheme.type === "apiKey" && scheme.in === "header") return curl.headers.has(String(scheme.name).toLowerCase());
        if (scheme.type === "apiKey" && scheme.in === "query") return Boolean(curlUrl?.searchParams.has(scheme.name));
        if (scheme.type === "apiKey" && scheme.in === "cookie") return curl.cookies.has(scheme.name);
        return true;
      };
      const satisfied = requirements.some((requirement) => Object.keys(requirement).every((name) => sends(resolveRef(spec, schemes[name]) || {})));
      if (!satisfied) {
        const expected = requirements.map((requirement) => Object.keys(requirement).map((name) => credentialLabel(resolveRef(spec, schemes[name]) || {}, name)).join(" and ")).join(", or ");
        add(`the request example sends no credentials for ${subject}; the spec requires ${expected}`);
      }
    }

    // The HTTP method. Methods are case-sensitive: "-X get" is not GET.
    if (curl.rawMethod && curl.rawMethod !== curl.rawMethod.toUpperCase()) {
      add(`the request example sends the method '${curl.rawMethod}'; HTTP methods are case-sensitive, so write ${curl.rawMethod.toUpperCase()}`);
    }
    const sentMethod = curl.method || (curl.hasBody ? "POST" : "GET");
    if (sentMethod !== operationRef.method) {
      add(`the request example sends ${sentMethod}, but this doc describes ${operationRef.method} ${operationRef.url}`);
    }

    // Headers: every one the spec defines, and the required ones present.
    const headerParameters = specParameters.filter((parameter) => parameter.in === "header");
    const securityHeaders = new Set(inUse.filter((scheme) => scheme.type === "apiKey" && scheme.in === "header").map((scheme) => String(scheme.name).toLowerCase()));
    if (inUse.some((scheme) => scheme.type === "http" || scheme.type === "oauth2" || scheme.type === "openIdConnect")) securityHeaders.add("authorization");
    const standardHeaders = new Set(["content-type", "accept", "user-agent", "accept-encoding", "accept-language", "cookie"]);
    for (const name of curl.headers.keys()) {
      if (!standardHeaders.has(name) && !securityHeaders.has(name) && !headerParameters.some((parameter) => parameter.name.toLowerCase() === name)) {
        add(`the request example sends header '${curl.headerNames.get(name)}', which ${specName} does not define for ${subject}`);
      }
    }
    for (const parameter of headerParameters.filter((candidate) => candidate.required && !/^(authorization|content-type|accept)$/i.test(candidate.name))) {
      if (!curl.headers.has(parameter.name.toLowerCase())) {
        add(`the request example leaves out required header '${parameter.name}'`);
      }
    }
    // Header values against their schemas.
    for (const parameter of headerParameters) {
      const value = curl.headers.get(parameter.name.toLowerCase());
      if (value !== undefined) {
        const problem = parameterValueProblem(spec, parameter, value);
        if (problem) add(`header '${parameter.name}' ${problem}`);
      }
    }

    // Cookies: the spec's cookie parameters and any API key kept in a cookie.
    const cookieParameters = specParameters.filter((parameter) => parameter.in === "cookie");
    const securityCookies = new Set(inUse.filter((scheme) => scheme.type === "apiKey" && scheme.in === "cookie").map((scheme) => scheme.name));
    for (const { name, value } of curl.cookiePairs) {
      const parameter = cookieParameters.find((candidate) => candidate.name === name);
      if (!parameter) {
        if (!securityCookies.has(name)) add(`the request example sends cookie '${name}', which ${specName} does not define for ${subject}`);
        continue;
      }
      const problem = parameterValueProblem(spec, parameter, value);
      if (problem) add(`cookie '${name}' ${problem}`);
    }
    for (const parameter of cookieParameters.filter((candidate) => candidate.required)) {
      if (!curl.cookies.has(parameter.name)) {
        add(`the request example leaves out required cookie '${parameter.name}'`);
      }
    }

    // A form-urlencoded body: its fields against the body schema.
    const formMedia = Object.entries(requestBody?.content || {}).find(([type]) => /application\/x-www-form-urlencoded/i.test(type));
    if (formMedia && curl.hasBody && !curl.multipart) {
      const formContentType = (curl.headers.get("content-type") || "").toLowerCase();
      const onlyForm = Object.keys(requestBody.content).every((type) => /x-www-form-urlencoded/i.test(type));
      if (onlyForm && /json/.test(formContentType)) {
        add(`the request example sends JSON, but ${subject} takes an application/x-www-form-urlencoded body`);
      } else if (!/json/.test(formContentType)) {
        const formSchema = resolveSchema(spec, formMedia[1].schema) || {};
        const formProperties = formSchema.properties || {};
        const sentFields = new Map();
        for (const pair of curl.dataPairs) {
          const separator = pair.indexOf("=");
          if (separator > 0) sentFields.set(pair.slice(0, separator), pair.slice(separator + 1));
        }
        for (const [name, value] of sentFields) {
          const fieldSchema = formProperties[name];
          if (!fieldSchema) {
            if (!formSchema.additionalProperties && Object.keys(formProperties).length > 0) add(`the request example sends form field '${name}', which is not defined in ${specName}`);
            continue;
          }
          const problem = parameterValueProblem(spec, { schema: fieldSchema }, value);
          if (problem) add(`form field '${name}' ${problem}`);
        }
        for (const required of formSchema.required || []) {
          if (!sentFields.has(required) && !resolveSchema(spec, formProperties[required])?.readOnly) {
            add(`the request example leaves out required form field '${required}'`);
          }
        }
      }
    }

    // Multipart fields against the body schema; a real local path in -F would
    // upload that file from the reader's machine.
    const multipartMedia = Object.entries(requestBody?.content || {}).find(([type]) => /multipart\/form-data/i.test(type))?.[1];
    if (curl.formFields.length > 0 && multipartMedia) {
      const formSchema = resolveSchema(spec, multipartMedia.schema) || {};
      const formProperties = formSchema.properties || {};
      for (const field of curl.formFields) {
        if (field.file && !/^<[^>]+>$|^path\/to\//.test(field.file)) {
          add(`the request example uploads the local file '${field.file}' in field '${field.name}'; use a placeholder such as @<file>`);
        }
        const fieldSchema = formProperties[field.name] ? resolveSchema(spec, formProperties[field.name]) || {} : null;
        if (!fieldSchema) {
          if (!formSchema.additionalProperties && Object.keys(formProperties).length > 0) {
            add(`the request example sends form field '${field.name}', which is not defined in ${specName}`);
          }
          continue;
        }
        if (field.file) continue;
        const fieldType = [].concat(fieldSchema.type || []).find((type) => type !== "null");
        if (Array.isArray(fieldSchema.enum) && !fieldSchema.enum.map(String).includes(field.value)) {
          add(`form field '${field.name}' uses '${field.value}', which is not one of its allowed values (${fieldSchema.enum.join(", ")})`);
        } else if ((fieldType === "integer" && !/^-?\d+$/.test(field.value)) || (fieldType === "number" && !/^-?\d+(\.\d+)?$/.test(field.value)) || (fieldType === "boolean" && !/^(true|false)$/.test(field.value))) {
          add(`form field '${field.name}' uses '${field.value}', which is not a valid ${fieldType}`);
        }
      }
      for (const required of formSchema.required || []) {
        if (!curl.formFields.some((field) => field.name === required)) {
          add(`the request example leaves out required form field '${required}'`);
        }
      }
    }
    if (!requestBody?.content && curl.hasBody) {
      add(`the request example sends a body, but ${operationRef.method} ${operationRef.url} defines no request body`);
    }
    // A body needs its Content-Type; -F sets multipart itself.
    if (requestBody?.content && curl.hasBody && !curl.multipart && !curl.headers.has("content-type")) {
      add(`the request example sends a body without a Content-Type header; the spec's request body types are ${Object.keys(requestBody.content).join(", ")}`);
    }
    if (requestBody?.required === true && !curl.hasBody) {
      add(`the request example sends no body, but the spec requires one`);
    }
  }

  // Request example URL: server, path, query parameters.
  const bases = serverBases(spec).filter((base) => /^https?:\/\//.test(base));
  const exampleUrl = extractCurlUrl(content);
  if (exampleUrl) {
    const base = bases.find((candidate) => exampleUrl.href.startsWith(candidate));
    if (bases.length > 0 && !base) {
      add(`request example calls ${exampleUrl.origin}${exampleUrl.pathname}, which is not under any server in ${specName} (${bases.join(", ")})`);
    } else {
      const basePath = base ? new URL(base).pathname.replace(/\/$/, "") : "";
      const examplePath = decodeURIComponent(exampleUrl.pathname).slice(basePath.length) || "/";
      if (!routePattern(match.route).test(examplePath)) {
        add(`request example path ${examplePath} does not match ${match.route}`);
      } else {
        // Path parameter values against their schemas.
        const names = (match.route.match(/\{([^}]+)\}/g) || []).map((entry) => entry.slice(1, -1));
        const capture = new RegExp(`^${match.route.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\\\{[^}]+\\\}|\{[^}]+\}/g, "([^/]+)")}$`).exec(examplePath);
        names.forEach((name, position) => {
          const parameter = specParameters.find((candidate) => candidate.in === "path" && candidate.name === name);
          const value = capture?.[position + 1];
          if (parameter && value !== undefined) {
            const problem = parameterValueProblem(spec, parameter, value);
            if (problem) add(`path parameter '${name}' ${problem}`);
          }
        });
      }
    }
    const apiKeyQueryNames = new Set(securityRequirementsOf(spec, operation).flatMap((requirement) => Object.keys(requirement || {}))
      .map((name) => resolveRef(spec, spec.components?.securitySchemes?.[name]) || {})
      .filter((scheme) => scheme.type === "apiKey" && scheme.in === "query").map((scheme) => scheme.name));
    const sentQueryNames = new Set();
    for (const [name, value] of exampleUrl.searchParams) {
      if (apiKeyQueryNames.has(name)) {
        continue;
      }
      // deepObject parameters are sent as name[key]=value.
      const deep = name.match(/^([^[\]]+)\[([^[\]]+)\]$/);
      const baseName = deep ? deep[1] : name;
      sentQueryNames.add(baseName);
      let defined = specParameters.find((parameter) => parameter.in === "query" && parameter.name === name);
      let schema = defined ? resolveSchema(spec, defined.schema) : null;
      if (!defined && deep) {
        defined = specParameters.find((parameter) => parameter.in === "query" && parameter.name === baseName);
        const objectSchema = defined ? resolveSchema(spec, defined.schema) || {} : null;
        if (defined && objectSchema.properties && !(deep[2] in objectSchema.properties) && !objectSchema.additionalProperties) {
          add(`query parameter '${name}': '${deep[2]}' is not a key of '${baseName}' in ${specName}`);
          continue;
        }
        schema = objectSchema?.properties?.[deep[2]] ? resolveSchema(spec, objectSchema.properties[deep[2]]) : null;
      }
      if (!defined) {
        add(`request example uses query parameter '${name}', which is not defined in ${specName}`);
        continue;
      }
      if (/^\{[^}]+\}$|^<[^>]+>$/.test(value) || !schema) {
        continue; // a visible placeholder, or a key with no schema of its own
      }
      const itemSchema = schema.type === "array" ? resolveSchema(spec, schema.items) || {} : schema;
      const values = schema.type === "array" ? value.split(",") : [value];
      for (const single of values) {
        const allowedValues = itemSchema.enum;
        if (Array.isArray(allowedValues) && !allowedValues.map(String).includes(single)) {
          add(`query parameter '${name}' uses '${single}', which is not one of its allowed values (${allowedValues.join(", ")})`);
          continue;
        }
        const typed = itemSchema.type === "integer" ? (/^-?\d+$/.test(single) ? Number(single) : undefined)
          : itemSchema.type === "number" ? (/^-?\d+(\.\d+)?$/.test(single) ? Number(single) : undefined)
          : itemSchema.type === "boolean" ? (/^(true|false)$/.test(single) ? single === "true" : undefined)
          : single;
        if (typed === undefined) {
          add(`query parameter '${name}' uses '${single}', which is not a valid ${itemSchema.type}`);
          continue;
        }
        const constraint = valueConstraintError(typed, itemSchema);
        if (constraint) {
          add(`query parameter '${name}' ${constraint}`);
        }
      }
    }
    for (const parameter of specParameters.filter((candidate) => candidate.in === "query" && candidate.required)) {
      if (!exampleUrl.searchParams.has(parameter.name) && !sentQueryNames.has(parameter.name)) {
        add(`request example leaves out required query parameter '${parameter.name}'`);
      }
    }
    // Placeholders left in the path must be the operation's own path parameters.
    const pathParameterNames = new Set(specParameters.filter((parameter) => parameter.in === "path").map((parameter) => parameter.name));
    for (const placeholder of decodeURIComponent(exampleUrl.pathname).match(/\{([^}]+)\}/g) || []) {
      const name = placeholder.slice(1, -1);
      if (!pathParameterNames.has(name)) {
        add(`the request example URL has placeholder {${name}}, which is not a path parameter of ${operationRef.method} ${operationRef.url} (path parameters: ${[...pathParameterNames].join(", ") || "none"})`);
      }
    }
  }

  // Success status, and a response without a body.
  const statusShown = content.match(/## Response Example\s+Status: `([^`]+)`/)?.[1];
  if (statusShown && !statusCodeAllowed(statusShown, operation.responses)) {
    add(`response status '${statusShown}' is not defined for ${operationRef.method} ${operationRef.url} in ${specName}`);
  } else if (statusShown && !/^2/.test(statusShown) && Object.keys(operation.responses || {}).some((code) => code.startsWith("2"))) {
    add(`the Response Example shows status '${statusShown}', but the success response of ${operationRef.method} ${operationRef.url} is ${Object.keys(operation.responses).filter((code) => code.startsWith("2")).join(" or ")}; error bodies belong under Error Codes`);
  }
  const shownResponse = statusShown ? resolveRef(spec, operation.responses?.[statusShown] || operation.responses?.[`${statusShown[0]}XX`]) : null;
  const responseJsonBlocks = codeBlocks(sectionText(content, "Response Example")).filter((block) => block.lang === "json");
  if (shownResponse && !shownResponse.content && responseJsonBlocks.length > 0) {
    add(`the Response Example shows a JSON body for '${statusShown}', but the spec defines no body for that response`);
  }
  if (shownResponse?.content && responseJsonBlocks.length > 0 && !Object.keys(shownResponse.content).some((type) => /[/+]json(;|$)/i.test(type))) {
    add(`the Response Example shows JSON, but '${statusShown}' returns ${Object.keys(shownResponse.content).join(" or ")}, not JSON`);
  }
  const noBodyCode = content.match(/This operation returns `([^`]+)` with no response body\./)?.[1];
  if (noBodyCode) {
    const noBodyResponse = resolveRef(spec, operation.responses?.[noBodyCode] || operation.responses?.[`${noBodyCode[0]}XX`]);
    if (!noBodyResponse) {
      add(`response status '${noBodyCode}' is not defined for ${operationRef.method} ${operationRef.url} in ${specName}`);
    } else if (noBodyResponse.content) {
      add(`the doc says '${noBodyCode}' has no response body, but the spec defines one`);
    }
  }

  // Error Codes: every listed code exists, and every spec error response is listed.
  const errorSection = sectionText(content, "Error Codes");
  const listedCodes = tableRows(content, "Error Codes", 2).map(([code]) => code.replace(/`/g, ""));
  for (const code of listedCodes) {
    if (code === "default" ? !("default" in (operation.responses || {})) : !statusCodeAllowed(code, operation.responses)) {
      add(`status code '${code}' is not defined for ${operationRef.method} ${operationRef.url} in ${specName}`);
    } else if (/^2/.test(code)) {
      add(`the Error Codes table lists '${code}', which is a success response`);
    }
  }
  if (errorSection !== null) {
    for (const code of Object.keys(operation.responses || {}).filter((candidate) => !candidate.startsWith("2"))) {
      if (!listedCodes.includes(code)) {
        warn(`error response '${code}' from ${specName} is missing from the Error Codes table`);
      }
    }
  }

  return errors;
}

// curl calls in a doc that is not an endpoint doc (an overview or a guide): a call to a
// spec server must use a path and method that server's spec defines.
function guideCurlErrors(content, relativePath, specs) {
  const errors = [];
  for (const block of codeBlocks(content)) {
    for (const command of curlCommands(block.body)) {
      const curl = parseCurl(command);
      const method = (curl.method || (curl.hasBody ? "POST" : "GET")).toLowerCase();
      for (const { filePath, spec } of specs) {
        const specName = path.basename(filePath);
        let route;
        let url = null;
        if (curl.url) {
          url = curlUrl(command);
          const bare = curl.url.replace(/[?#].*$/, "").replace(/\/$/, "");
          // http and https are the same server for this purpose.
          const sameScheme = (text) => text.replace(/^http:/i, "https:");
          const base = serverBases(spec).filter((candidate) => candidate && (sameScheme(bare) === sameScheme(candidate) || sameScheme(bare).startsWith(`${sameScheme(candidate)}/`))).sort((a, b) => b.length - a.length)[0];
          if (!base) continue;
          route = decodeURIComponentSafe(sameScheme(bare).slice(sameScheme(base).length)) || "/";
        } else if (curl.varUrl) {
          // The variable holds the server, so the rest is the path.
          route = decodeURIComponentSafe(curl.varUrl.replace(/^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/, "").replace(/[?#].*$/, "").replace(/\/$/, "")) || "/";
          try {
            url = new URL(`https://variable.invalid${curl.varUrl.replace(/^\$\{?[A-Za-z_][A-Za-z0-9_]*\}?/, "")}`);
          } catch {
            url = null;
          }
        } else {
          continue;
        }
        const routes = Object.keys(spec.paths || {}).filter((specRoute) => routePattern(specRoute).test(route));
        if (routes.length === 0) {
          errors.push(`${relativePath}: a curl example calls ${route}, which ${specName} does not define`);
          continue;
        }
        const specRoute = routes.find((candidate) => spec.paths[candidate]?.[method]);
        if (!specRoute) {
          errors.push(`${relativePath}: a curl example sends ${method.toUpperCase()} ${route}, but ${specName} defines no ${method.toUpperCase()} for that path`);
          continue;
        }
        guideRequestErrors(spec, specName, spec.paths[specRoute], spec.paths[specRoute][method], `${method.toUpperCase()} ${specRoute}`, command, curl, url)
          .forEach((message) => errors.push(`${relativePath}: a curl example for ${method.toUpperCase()} ${specRoute} ${message}`));
      }
    }
  }
  // Other calls to a spec server (wget, fetch, Python, a URL in inline code):
  // the path must exist, whatever the tool.
  // Only code that makes calls: a URL inside a JSON or YAML example is data
  // (a "next" link, say). curl commands were checked above, so they are cut out.
  const withoutCurl = (text) => curlCommands(text).reduce((rest, command) => rest.replace(command, ""), text);
  const callingCode = codeBlocks(content).filter((block) => !/^(json|jsonc|yaml|yml|xml|csv|text|txt|)$/.test(block.lang));
  const inlineCode = [...withoutFences(content).matchAll(/`([^`\n]+)`/g)].map((found) => found[1]);
  const codeText = [...callingCode.map((block) => withoutCurl(block.body)), ...inlineCode].join("\n");
  // The method, where the code says it: requests.delete(url), axios.post(url), wget (GET).
  const methodFor = new Map();
  for (const [, verb, called] of codeText.matchAll(/\b(?:requests|axios|httpx|session|client|http)\.(get|post|put|patch|delete)\(\s*f?["'`](https?:\/\/[^"'`]+)["'`]/gi)) {
    methodFor.set(called, verb.toLowerCase());
  }
  for (const [, called] of codeText.matchAll(/\bwget\b[^\n]*?["']?(https?:\/\/[^\s"']+)/g)) {
    if (!/--method[= ]/.test(called)) methodFor.set(called, "get");
  }
  for (const [rawUrl] of codeText.matchAll(/https?:\/\/[^\s"'`<>)\]]+/g)) {
    const verb = methodFor.get(rawUrl);
    const bare = rawUrl.replace(/[?#].*$/, "").replace(/[.,;:]+$/, "").replace(/\/$/, "");
    for (const { filePath, spec } of specs) {
      const sameScheme = (text) => text.replace(/^http:/i, "https:");
      const base = serverBases(spec).filter((candidate) => candidate && sameScheme(bare).startsWith(`${sameScheme(candidate)}/`)).sort((left, right) => right.length - left.length)[0];
      if (!base) continue;
      const route = decodeURIComponentSafe(sameScheme(bare).slice(sameScheme(base).length));
      const matching = Object.keys(spec.paths || {}).filter((specRoute) => routePattern(specRoute).test(route));
      if (matching.length === 0) {
        errors.push(`${relativePath}: a code example calls ${route}, which ${path.basename(filePath)} does not define`);
      } else if (verb && !matching.some((specRoute) => spec.paths[specRoute]?.[verb])) {
        errors.push(`${relativePath}: a code example sends ${verb.toUpperCase()} ${route}, but ${path.basename(filePath)} defines no ${verb.toUpperCase()} for that path`);
      }
    }
  }
  // "GET /v3/payout/{id}" in prose: an endpoint the spec should have. A
  // warning, since prose may name another API.
  const prose = withoutFences(content.replace(/^---\n[\s\S]*?\n---\n/, ""));
  for (const [, verb, named] of prose.matchAll(/\b(GET|POST|PUT|PATCH|DELETE)\s+`?(\/[A-Za-z0-9_\-./{}]+)`?/g)) {
    const route = named.replace(/[.,;:]+$/, "");
    // Only paths that look like this API's: the same first segment, or one
    // close to it ("/payment" for "/payments").
    const firstSegment = route.split("/")[1] || "";
    const close = (segment) => {
      let shared = 0;
      while (shared < Math.min(segment.length, firstSegment.length) && segment[shared] === firstSegment[shared]) shared += 1;
      return segment === firstSegment || (shared >= 4 && Math.abs(segment.length - firstSegment.length) <= 2);
    };
    const related = specs.filter(({ spec }) => Object.keys(spec.paths || {}).some((specRoute) => close(specRoute.split("/")[1] || "")));
    if (related.length === 0) continue;
    // Defined in any of the specs is enough: a folder can hold several.
    const matchingIn = (spec) => Object.keys(spec.paths || {}).filter((specRoute) => routePattern(specRoute).test(route) || normalizeRoute(specRoute) === normalizeRoute(route));
    const withPath = related.filter(({ spec }) => matchingIn(spec).length > 0);
    if (withPath.length === 0) {
      warnings.push(`${relativePath}: names ${verb} ${route}, which ${related.map(({ filePath }) => path.basename(filePath)).join(" / ")} does not define`);
    } else if (!withPath.some(({ spec }) => matchingIn(spec).some((specRoute) => spec.paths[specRoute]?.[verb.toLowerCase()]))) {
      warnings.push(`${relativePath}: names ${verb} ${route}, but ${withPath.map(({ filePath }) => path.basename(filePath)).join(" / ")} defines no ${verb} for that path`);
    }
  }
  return errors;
}

// A curl call in a guide, checked against the operation it calls: its query
// parameters, its credentials and its JSON body. Optional parameters may be
// left out, as a guide shows only what it needs.
function guideRequestErrors(spec, specName, pathItem, operation, subject, command, curl, url) {
  const errors = [];
  const parameters = definedParameters(spec, pathItem, operation);
  const schemes = spec.components?.securitySchemes || {};
  const requirements = securityRequirementsOf(spec, operation);
  const inUse = requirements.flatMap((requirement) => Object.keys(requirement || {}).map((name) => resolveRef(spec, schemes[name]) || {}));
  const apiKeyQuery = new Set(inUse.filter((scheme) => scheme.type === "apiKey" && scheme.in === "query").map((scheme) => scheme.name));
  if (url) {
    for (const [name, value] of url.searchParams) {
      if (apiKeyQuery.has(name)) continue;
      const deep = name.match(/^([^[\]]+)\[([^[\]]+)\]$/);
      const parameter = parameters.find((candidate) => candidate.in === "query" && (candidate.name === name || (deep && candidate.name === deep[1])));
      if (!parameter) {
        errors.push(`uses query parameter '${name}', which ${specName} does not define`);
        continue;
      }
      if (deep) continue;
      const schema = resolveSchema(spec, parameter.schema) || {};
      const values = schema.type === "array" ? value.split(",") : [value];
      for (const single of values) {
        const problem = parameterValueProblem(spec, { schema: schema.type === "array" ? schema.items : parameter.schema }, single);
        if (problem) errors.push(`query parameter '${name}' ${problem}`);
      }
    }
    for (const parameter of parameters.filter((candidate) => candidate.in === "query" && candidate.required)) {
      if (![...url.searchParams.keys()].some((name) => name === parameter.name || name.startsWith(`${parameter.name}[`))) {
        errors.push(`leaves out required query parameter '${parameter.name}'`);
      }
    }
  }
  // Credentials.
  const authorization = curl.headers.get("authorization") || "";
  const sendsBasic = curl.basicAuth || /^basic\b/i.test(authorization);
  const sendsBearer = /^bearer\b/i.test(authorization);
  const apiKeyInAuthorization = inUse.some((scheme) => scheme.type === "apiKey" && scheme.in === "header" && String(scheme.name).toLowerCase() === "authorization");
  if (sendsBasic && !apiKeyInAuthorization && requirements.length > 0 && !inUse.some((scheme) => scheme.type === "http" && /basic/i.test(scheme.scheme))) {
    errors.push(`sends Basic credentials, but ${specName} does not use Basic authentication for it`);
  }
  if (sendsBearer && !apiKeyInAuthorization && requirements.length > 0 && !inUse.some((scheme) => (scheme.type === "http" && /bearer/i.test(scheme.scheme)) || scheme.type === "oauth2" || scheme.type === "openIdConnect")) {
    errors.push(`sends a Bearer token, but ${specName} does not use one for it`);
  }
  const authOptional = requirements.length === 0 || requirements.some((requirement) => !requirement || Object.keys(requirement).length === 0);
  if (!authOptional) {
    const sends = (scheme) => {
      if (scheme.type === "http" && /basic/i.test(scheme.scheme)) return sendsBasic;
      if (scheme.type === "http" || scheme.type === "oauth2" || scheme.type === "openIdConnect") return curl.headers.has("authorization");
      if (scheme.type === "apiKey" && scheme.in === "header") return curl.headers.has(String(scheme.name).toLowerCase());
      if (scheme.type === "apiKey" && scheme.in === "query") return Boolean(url?.searchParams.has(scheme.name));
      if (scheme.type === "apiKey" && scheme.in === "cookie") return curl.cookies.has(scheme.name);
      return true;
    };
    if (!requirements.some((requirement) => Object.keys(requirement).every((name) => sends(resolveRef(spec, schemes[name]) || {})))) {
      errors.push(`sends no credentials; ${specName} requires ${requirements.map((requirement) => Object.keys(requirement).map((name) => credentialLabel(resolveRef(spec, schemes[name]) || {}, name)).join(" and ")).join(", or ")}`);
    }
  }
  // Body.
  const requestBody = resolveRef(spec, operation.requestBody);
  if (!requestBody?.content && curl.hasBody) {
    errors.push(`sends a body, but ${specName} defines no request body for it`);
  }
  const jsonArgument = curl.dataArgs.find((argument) => /^\s*[[{]/.test(argument.value));
  const bodySchema = jsonSchemaOf(requestBody?.content);
  if (jsonArgument && bodySchema) {
    let body;
    try {
      body = JSON.parse(jsonArgument.value);
    } catch {
      errors.push("sends a JSON body that does not parse");
    }
    if (body !== undefined) {
      valueProblems(spec, body, [bodySchema], "request").forEach((message) => errors.push(`sends a body in which ${message}`));
      if (body && typeof body === "object" && !Array.isArray(body)) {
        const shapes = shapesOf(spec, bodySchema);
        const missing = shapes.map((shape) => (shape.required || []).filter((key) => !(key in body) && !resolveSchema(spec, shape.properties?.[key])?.readOnly));
        if (shapes.length > 0 && !missing.some((list) => list.length === 0)) {
          errors.push(`leaves out required body field${missing[0].length === 1 ? "" : "s"} ${missing.reduce((best, list) => (list.length < best.length ? list : best)).join(", ")}`);
        }
      }
    }
  }
  return errors;
}

// Checks an API overview doc: base URL and authentication against the spec.
function checkOverviewDoc(content, relativePath, specs) {
  const errors = [];
  const title = content.match(/^title:\s*"?(.+?)"?\s*$/m)?.[1] || "";
  const spec = specs.find(({ spec: candidate }) => title.startsWith(String(candidate.info?.title || "").replace(/\s+API$/i, "")))?.spec || (specs.length === 1 ? specs[0].spec : null);
  if (!spec) {
    return errors;
  }
  const baseSection = sectionText(content, "Base URL");
  const bases = serverBases(spec);
  if (baseSection === null && bases.length > 0) {
    warnings.push(`${relativePath}: the overview has no '## Base URL' section`);
  }
  // Every server the section names, the other servers included.
  for (const [, baseUrl] of (baseSection || "").matchAll(/`([a-z][a-z0-9+.-]*:\/\/[^`]+)`/gi)) {
    if (bases.length > 0 && !bases.includes(baseUrl.replace(/\/$/, ""))) {
      errors.push(`${relativePath}: Base URL ${baseUrl} is not a server in the spec (${bases.join(", ")})`);
    }
  }
  const authText = sectionText(content, "Authentication");
  if (authText) {
    const schemes = Object.keys(spec.components?.securitySchemes || {});
    // The overview describes the whole API: the global requirements and any an
    // operation sets on its own, such as HTTP Basic on a token endpoint.
    const operationRequirements = Object.values(spec.paths || {}).flatMap((pathItem) =>
      ["get", "put", "post", "delete", "patch", "head", "options"].flatMap((method) => (Array.isArray(pathItem?.[method]?.security) ? pathItem[method].security : [])));
    const declared = [...((spec.security && spec.security.length > 0) ? spec.security : []), ...operationRequirements].filter((requirement) => Object.keys(requirement || {}).length > 0);
    const requirements = declared.length > 0 ? declared : schemes.map((name) => ({ [name]: [] }));
    const allHeaderParameters = Object.values(spec.paths || {}).flatMap((pathItem) =>
      ["get", "put", "post", "delete", "patch", "head", "options"].filter((method) => pathItem?.[method]).flatMap((method) => definedParameters(spec, pathItem, pathItem[method])));
    authenticationErrors(spec, authText, requirements, "the API", allHeaderParameters).forEach((message) => errors.push(`${relativePath}: ${message}`));
  }
  return errors;
}

async function main() {
  let targets;
  try {
    targets = parseTargets();
    await assertPathsExist(targets.docPaths, "Docs path");
    await assertPathsExist(targets.specPaths, "Specs path");
  } catch (error) {
    exitWithTargetError(error);
  }

  const docTargets = targets.userMode
    ? targets.docPaths
    : scanDirectories.map((relativeDirectory) => path.join(repoRoot, relativeDirectory));
  const displayRoot = targets.userMode ? targets.baseDirectory : repoRoot;
  const checkedLabel = docTargets.map((target) => displayPath(target, displayRoot)).join(", ");

  if (targets.userMode && targets.specPaths.length === 0) {
    console.log(
      `Skipped OpenAPI example check for ${checkedLabel}: no specs given. ` +
      "Add --specs <folder with your OpenAPI files> to compare docs against the spec."
    );
    return;
  }

  const specTargets = targets.specPaths.length > 0 ? targets.specPaths : [path.join(repoRoot, "examples")];
  const specs = await loadSpecs(specTargets);
  warnings.push(...skippedSpecs);
  if (targets.userMode && specs.length === 0) {
    console.error(`No OpenAPI 3.x specs found in ${specTargets.map((target) => displayPath(target, displayRoot)).join(", ")}.`);
    process.exitCode = 1;
    return;
  }

  const errors = [];
  const markdownFiles = [];
  let comparedCount = 0;
  const documentedOperations = new Map();
  const documentedInFolder = new Map();

  for (const target of docTargets) {
    markdownFiles.push(...(await collectFromTarget(target, new Set([".md"]))));
  }

  for (const filePath of markdownFiles) {
    const content = await fs.readFile(filePath, "utf8");
    const relativePath = displayPath(filePath, displayRoot);
    const operationRef = extractOperation(content);

    if (!operationRef) {
      if (/^# API Overview/m.test(content)) {
        errors.push(...checkOverviewDoc(content, relativePath, specs));
      } else if (targets.userMode && (/^component:\s*"?endpoint"?\s*$/m.test(content) || /^# Endpoint:/m.test(content) || /## Request Example/.test(content))) {
        errors.push(`${relativePath}: looks like an endpoint doc, but its Endpoint section (Method and URL) is missing or unreadable, so it could not be compared with the spec`);
      }
      errors.push(...guideCurlErrors(content, relativePath, specs));
      continue;
    }

    comparedCount += 1;

    const responseJson = extractResponseJson(content);
    const requestJson = extractRequestJson(content);
    const documentedParameters = extractParameterNames(content);

    const match = findBestSpecOperation(
      specs,
      operationRef.url,
      operationRef.method,
      requestJson,
      responseJson,
      documentedParameters,
      filePath,
      extractCurlUrl(content)
    );

    if (!match) {
      errors.push(`${relativePath}: no OpenAPI operation found for ${operationRef.method} ${operationRef.url}`);
      continue;
    }

    if (responseJson?.__parseError) {
      errors.push(`${relativePath}: response example is not valid JSON`);
      continue;
    }

    if (requestJson?.__parseError) {
      errors.push(`${relativePath}: request example body is not valid JSON`);
      continue;
    }

    // Two docs in one folder for the same operation; separate example sets
    // in separate folders may each document it.
    const operationKey = `${match.filePath}#${operationRef.method} ${match.route}`;
    const folderKey = `${path.dirname(relativePath)}|${operationKey}`;
    if (documentedInFolder.has(folderKey)) {
      errors.push(`${relativePath}: describes the same operation (${operationRef.method} ${match.route}) as ${documentedInFolder.get(folderKey)}`);
    } else {
      documentedInFolder.set(folderKey, relativePath);
    }
    documentedOperations.set(operationKey, relativePath);
    errors.push(...checkEndpointDoc(content, relativePath, match, operationRef, requestJson, responseJson));
  }

  // Operations with no doc, in a spec these docs already document.
  if (targets.userMode) {
    const documentedSpecs = new Set([...documentedOperations.keys()].map((key) => key.split("#")[0]));
    for (const { filePath, spec } of specs.filter((candidate) => documentedSpecs.has(candidate.filePath))) {
      const missing = [];
      for (const [route, pathItem] of Object.entries(spec.paths || {})) {
        for (const method of ["get", "post", "put", "patch", "delete"]) {
          if (pathItem?.[method] && !documentedOperations.has(`${filePath}#${method.toUpperCase()} ${route}`)) {
            missing.push(`${method.toUpperCase()} ${route}`);
          }
        }
      }
      if (missing.length > 0) {
        warnings.push(`${path.basename(filePath)}: ${missing.length} operation(s) have no doc: ${missing.slice(0, 10).join(", ")}${missing.length > 10 ? ", ..." : ""}`);
      }
    }
  }

  // The same problem found twice (two array items, two checks) is reported once.
  const uniqueErrors = [...new Set(errors)];
  errors.length = 0;
  errors.push(...uniqueErrors);
  const uniqueWarnings = [...new Set(warnings)];
  warnings.length = 0;
  warnings.push(...uniqueWarnings);
  const warningReport = warnings.length > 0 ? `\nOpenAPI example warnings:\n\n${warnings.map((warning) => `- ${warning}`).join("\n")}\n` : "";

  if (errors.length > 0) {
    // One write, then let Node exit on its own, so no line is lost when the
    // output is a pipe.
    process.stderr.write(`OpenAPI example validation failed:\n\n${errors.map((error) => `- ${error}`).join("\n")}\n${warningReport}`);
    process.exitCode = 1;
    return;
  }

  const skippedCount = markdownFiles.length - comparedCount;
  if (targets.userMode && comparedCount === 0) {
    console.log(`Skipped OpenAPI example check for ${checkedLabel}: no endpoint docs found, so nothing was compared with the spec.`);
    return;
  }
  console.log(
    `Compared ${comparedCount} endpoint docs in ${checkedLabel} against the OpenAPI spec` +
    (skippedCount === 1 ? " (1 Markdown file describes no endpoint and was not compared)" : skippedCount > 1 ? ` (${skippedCount} Markdown files describe no endpoint and were not compared)` : "") +
    (warnings.length > 0 ? `, with ${warnings.length} warning(s) to resolve before publishing.` : ".")
  );
  if (warningReport) {
    process.stderr.write(warningReport);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});