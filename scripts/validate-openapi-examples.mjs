import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import { assertPathsExist, displayPath, exitWithTargetError, parseTargets } from "./lib/cli-targets.mjs";

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
  const blocks = [];
  const pattern = /^(`{3,})([^\n`]*)\n([\s\S]*?)^\1`*[ \t]*$/gm;
  let match;
  while ((match = pattern.exec(String(text || "")))) {
    blocks.push({ lang: match[2].trim().toLowerCase(), body: match[3].replace(/\n$/, "") });
  }
  return blocks;
}

// The curl command in the Request Example section, if there is one.
function requestCurl(content) {
  return codeBlocks(sectionText(content, "Request Example")).find((block) => /^\s*curl\b/.test(block.body))?.body || "";
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
  ["Header Parameters", "header"]
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
  const urlMatch = requestCurl(content).match(/curl\s+(?:(?:-X|--request)\s+\w+\s+)?["']([^"']+)["']/);
  try {
    return urlMatch ? new URL(urlMatch[1]) : null;
  } catch {
    return null;
  }
}

function findSpecOperations(specs, route, method) {
  const lowerMethod = method.toLowerCase();
  const normalizedRoute = normalizeRoute(route);
  const matches = [];

  for (const { filePath, spec } of specs) {
    for (const [specRoute, pathItem] of Object.entries(spec.paths || {})) {
      if (normalizeRoute(specRoute) !== normalizedRoute) {
        continue;
      }

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
function resolveSchema(spec, schema, depth = 0) {
  let resolved = schema;
  while (resolved && typeof resolved === "object" && typeof resolved.$ref === "string" && resolved.$ref.startsWith("#/") && depth < 20) {
    // OpenAPI 3.1 allows keywords next to $ref; they apply on top of the target.
    const { $ref, ...siblings } = resolved;
    const target = $ref.slice(2).split("/").reduce((current, segment) => current?.[segment], spec);
    resolved = target && Object.keys(siblings).length > 0 ? { ...target, ...siblings } : target;
    depth += 1;
  }
  if (!resolved || typeof resolved !== "object" || !Array.isArray(resolved.allOf) || depth > 20) {
    return resolved || null;
  }
  const merged = { ...resolved, properties: { ...(resolved.properties || {}) }, required: [...(resolved.required || [])] };
  delete merged.allOf;
  for (const part of resolved.allOf) {
    const candidate = resolveSchema(spec, part, depth + 1) || {};
    Object.assign(merged.properties, candidate.properties || {});
    merged.required.push(...(candidate.required || []));
  }
  return merged;
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
    // Generated docs escape "<" outside code (array&lt;string&gt;); compare the text.
    .map((cell) => cell.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&"));
}

// Rows of a Markdown table under a "## <heading>" section: [first cell, third cell].
function tableRows(content, heading, minCells = 3) {
  const found = new RegExp(`(^|\\n)## ${heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\r?\\n`).exec(content);
  if (!found) {
    return [];
  }
  const start = found.index + found[1].length;
  const next = content.indexOf("\n## ", start + 3);
  const body = content.slice(start, next === -1 ? undefined : next);
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
  const resolved = resolveSchema(spec, schema);
  if (!resolved || depth > 6) {
    return [];
  }
  const variants = !resolved.properties ? (resolved.oneOf || resolved.anyOf) : null;
  if (Array.isArray(variants) && variants.length > 0) {
    return variants.flatMap((variant) => expandShapes(spec, variant, depth + 1));
  }
  return [resolved];
}

// Checks a JSON example against the schema at every depth: unknown fields
// and values outside an enum. For oneOf/anyOf, the example must fit one
// shape on its own, so fields from different options cannot be mixed.
function checkJsonValue(spec, value, schema, label, kind, depth = 0) {
  return jsonErrors(spec, value, [schema], label, kind, depth);
}

function jsonErrors(spec, value, schemas, label, kind, depth) {
  if (depth > 8 || value === null || value === undefined) {
    return [];
  }
  const shapes = schemas.flatMap((schema) => expandShapes(spec, schema));
  if (shapes.length === 0) {
    return [];
  }
  let best = null;
  for (const shape of shapes) {
    const errors = shapeErrors(spec, value, shape, label, kind, depth);
    if (errors.length === 0) {
      return [];
    }
    if (!best || errors.length < best.length) {
      best = errors;
    }
  }
  return best;
}

// A value outside the schema's range, length or format.
function valueConstraintError(value, shape) {
  if (typeof value === "number") {
    if (typeof shape.minimum === "number" && (shape.exclusiveMinimum === true ? value <= shape.minimum : value < shape.minimum)) {
      return `is ${value}, below the spec's minimum of ${shape.minimum}`;
    }
    if (typeof shape.maximum === "number" && (shape.exclusiveMaximum === true ? value >= shape.maximum : value > shape.maximum)) {
      return `is ${value}, above the spec's maximum of ${shape.maximum}`;
    }
    if (typeof shape.exclusiveMinimum === "number" && value <= shape.exclusiveMinimum) {
      return `is ${value}, not above the spec's exclusive minimum of ${shape.exclusiveMinimum}`;
    }
    if (typeof shape.exclusiveMaximum === "number" && value >= shape.exclusiveMaximum) {
      return `is ${value}, not below the spec's exclusive maximum of ${shape.exclusiveMaximum}`;
    }
  }
  if (typeof value === "string") {
    if (typeof shape.minLength === "number" && [...value].length < shape.minLength) {
      return `is ${[...value].length} characters, shorter than the spec's minimum length of ${shape.minLength}`;
    }
    if (typeof shape.maxLength === "number" && [...value].length > shape.maxLength) {
      return `is ${[...value].length} characters, longer than the spec's maximum length of ${shape.maxLength}`;
    }
    const formats = {
      email: /^[^@\s]+@[^@\s]+\.[^@\s]+$/,
      date: /^\d{4}-\d{2}-\d{2}$/,
      "date-time": /^\d{4}-\d{2}-\d{2}[Tt ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?([Zz]|[+-]\d{2}:?\d{2})?$/,
      uuid: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
      uri: /^[A-Za-z][A-Za-z0-9+.-]*:\S*$/
    };
    if (formats[shape.format] && value !== "" && !formats[shape.format].test(value)) {
      return `is '${value}', which is not a valid ${shape.format}`;
    }
  }
  return null;
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
  const pattern = /"((?:[^"\\]|\\.)*)"|'((?:[^']|'\\'')*)'|(\S+)/g;
  let match;
  while ((match = pattern.exec(joined))) {
    tokens.push(match[1] !== undefined ? match[1].replace(/\\(.)/g, "$1") : match[2] !== undefined ? match[2].replace(/'\\''/g, "'") : match[3]);
  }
  const result = { method: null, headers: new Map(), headerNames: new Map(), cookies: new Set(), hasBody: false, multipart: false, basicAuth: false };
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const next = tokens[index + 1] || "";
    if (token === "-X" || token === "--request") {
      result.method = next.toUpperCase();
      index += 1;
    } else if (token === "-H" || token === "--header") {
      const separator = next.indexOf(":");
      if (separator > 0) {
        const name = next.slice(0, separator).trim();
        result.headers.set(name.toLowerCase(), next.slice(separator + 1).trim());
        result.headerNames.set(name.toLowerCase(), name);
        if (name.toLowerCase() === "cookie") {
          next.slice(separator + 1).split(";").forEach((pair) => result.cookies.add(pair.split("=")[0].trim()));
        }
      }
      index += 1;
    } else if (token === "-b" || token === "--cookie") {
      next.split(";").forEach((pair) => result.cookies.add(pair.split("=")[0].trim()));
      index += 1;
    } else if (/^(-d|--data|--data-raw|--data-binary|--data-urlencode|--json)$/.test(token)) {
      result.hasBody = true;
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
  return result;
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
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function shapeErrors(spec, value, shape, label, kind, depth) {
  const allowedTypes = [].concat(shape.type || []);
  if (allowedTypes.length > 0) {
    const actual = jsonType(value);
    const fits =
      allowedTypes.includes(actual) ||
      (actual === "integer" && allowedTypes.includes("number")) ||
      (actual === "null" && shape.nullable === true);
    if (!fits) {
      const where = label ? `${kind} example field '${label}'` : `the ${kind} example`;
      return [`${where} is ${/^[aeiou]/.test(actual) ? "an" : "a"} ${actual}, but the spec says ${allowedTypes.join(" or ")}`];
    }
  }
  const constraint = valueConstraintError(value, shape);
  if (constraint) {
    const where = label ? `${kind} example field '${label}'` : `the ${kind} example`;
    return [`${where} ${constraint}`];
  }
  if (Array.isArray(shape.enum) && (value === null || typeof value !== "object")) {
    return shape.enum.map(String).includes(String(value))
      ? []
      : [`${kind} example field '${label}' uses '${value}', which is not one of its allowed values (${shape.enum.join(", ")})`];
  }
  if (Array.isArray(value)) {
    if (!shape.items) {
      return [];
    }
    return value.slice(0, 5).flatMap((item) => jsonErrors(spec, item, [shape.items], `${label}[]`, kind, depth + 1));
  }
  if (value && typeof value === "object") {
    const properties = shape.properties || {};
    if (Object.keys(properties).length === 0 || shape.additionalProperties) {
      return [];
    }
    const errors = [];
    if (kind === "request" && label) {
      // Required fields of nested objects; the top level is checked separately.
      for (const key of shape.required || []) {
        if (!(key in value) && !resolveSchema(spec, properties[key])?.readOnly) {
          errors.push(`request example field '${label}.${key}' is missing, and the spec requires it`);
        }
      }
    }
    for (const [key, child] of Object.entries(value)) {
      const childLabel = label ? `${label}.${key}` : key;
      if (!(key in properties)) {
        errors.push(`${kind} example field '${childLabel}' is not defined`);
        continue;
      }
      errors.push(...jsonErrors(spec, child, [properties[key]], childLabel, kind, depth + 1));
    }
    return errors;
  }
  return [];
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
  const matches = [...description.matchAll(/Allowed values: ((?:`[^`]*`(?:, )?)+)/g)];
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
function constraintNoteProblems(spec, schema, description, label) {
  const resolved = resolveSchema(spec, schema) || {};
  const specDescription = String(resolved.description || "");
  const problems = [];
  const specValues = {
    Default: resolved.default === undefined ? undefined : typeof resolved.default === "object" ? JSON.stringify(resolved.default) : String(resolved.default),
    Format: resolved.format,
    Minimum: resolved.minimum === undefined ? undefined : String(resolved.minimum),
    Maximum: resolved.maximum === undefined ? undefined : String(resolved.maximum)
  };
  for (const [note, specValue] of Object.entries(specValues)) {
    if (new RegExp(`${note}:`).test(specDescription)) {
      continue;
    }
    let documented = listedNote(description, note);
    if (documented !== undefined && note === "Format" && !/^[A-Za-z0-9-]+$/.test(documented)) {
      documented = undefined; // a pattern such as `YYYY-MM-DD`, not a format name
    }
    if (documented !== undefined && (note === "Minimum" || note === "Maximum")) {
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
  const section = sectionText(content, "Request Body") || "";
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
  return description.match(new RegExp(`(?:^|\\. )${label}: ([^|]+?)(?:\\. [A-Z][a-z]+:|\\.\\s*$|$)`))?.[1]?.trim();
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
function authenticationErrors(spec, authText, requirements, subject) {
  const errors = [];
  const schemes = spec.components?.securitySchemes || {};
  const inUse = requirements.flatMap((requirement) => Object.keys(requirement || {}).map((name) => resolveRef(spec, schemes[name]) || {}));
  const requiresAuth = inUse.length > 0;
  const saysNone = /no authentication/i.test(authText);
  if (requiresAuth && saysNone) {
    errors.push(`Authentication says none is required, but the spec requires it for ${subject}`);
  }
  if (!requiresAuth && !saysNone && /authentication is required|bearer|api key|oauth|basic/i.test(authText)) {
    errors.push(`Authentication says it is required, but the spec defines no security for ${subject}`);
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

  // Request example JSON.
  if (requestShapes.length > 0) {
    if (!requestJson) {
      add("request body schema exists but no JSON request example was found");
    } else if (typeof requestJson === "object" && !Array.isArray(requestJson)) {
      const allowed = allowedProperties(requestShapes);
      for (const key of Object.keys(requestJson)) {
        if (key in allowed && resolveSchema(spec, allowed[key])?.readOnly) {
          add(`request example sends '${key}', which is readOnly in ${specName}`);
        }
      }
      for (const message of checkJsonValue(spec, requestJson, requestSchemaJson, "", "request")) {
        add(`${message} in ${specName}`);
      }
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
    if (!Array.isArray(responseJson)) {
      const allowed = allowedProperties(responseShapes);
      for (const key of Object.keys(responseJson)) {
        if (key in allowed && resolveSchema(spec, allowed[key])?.writeOnly) {
          add(`response example shows '${key}', which is writeOnly in ${specName}`);
        }
      }
    }
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
    constraintNoteProblems(spec, defined.schema, documented.description || "", `parameter '${documented.name}'`).forEach(add);
    const parameterEnum = resolveSchema(spec, defined.schema)?.enum;
    const parameterListed = listedAllowedValues(documented.description || "", `${defined.description || ""} ${resolveSchema(spec, defined.schema)?.description || ""}`);
    if (parameterListed && (!parameterEnum || [...parameterListed].sort().join("|") !== parameterEnum.map(String).sort().join("|"))) {
      add(`parameter '${documented.name}' lists allowed values (${parameterListed.join(", ")}) that do not match the spec (${(parameterEnum || []).join(", ") || "no enum"})`);
    }
  }
  const hasParameterTables = parameterSections.some(([heading]) => sectionText(content, heading) !== null);
  if (hasParameterTables) {
    for (const parameter of specParameters.filter((candidate) => ["path", "query", "header"].includes(candidate.in))) {
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
        if (fieldChoices.length > 1 && /^(string|integer|number|boolean|object|array)$/.test(docType)) {
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
    // Every top-level field of a single-shape body is documented.
    if (tableShapes.length === 1 && !content.includes("### Option 1")) {
      const documentedNames = new Set(bodyRows.map(([name]) => name));
      for (const [property, propertySchema] of Object.entries(tableShapes[0].properties || {})) {
        if (!documentedNames.has(property) && !resolveSchema(spec, propertySchema)?.readOnly) {
          add(`request field '${property}' from ${specName} is missing from the Request Body table`);
        }
      }
    }
  }

  // Authentication section.
  const authText = sectionText(content, "Authentication");
  if (authText) {
    authenticationErrors(spec, authText, securityRequirementsOf(spec, operation), `${operationRef.method} ${operationRef.url}`).forEach(add);
  }

  // Credentials the request example sends, against the operation's security.
  const curlText = requestCurl(content);
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

    // The HTTP method.
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

// Checks an API overview doc: base URL and authentication against the spec.
function checkOverviewDoc(content, relativePath, specs) {
  const errors = [];
  const title = content.match(/^title:\s*"?(.+?)"?\s*$/m)?.[1] || "";
  const spec = specs.find(({ spec: candidate }) => title.startsWith(String(candidate.info?.title || "").replace(/\s+API$/i, "")))?.spec || (specs.length === 1 ? specs[0].spec : null);
  if (!spec) {
    return errors;
  }
  const baseSection = sectionText(content, "Base URL");
  const baseUrl = baseSection?.match(/`([^`]+)`/)?.[1];
  const bases = serverBases(spec);
  if (baseUrl && bases.length > 0 && !bases.includes(baseUrl.replace(/\/$/, ""))) {
    errors.push(`${relativePath}: Base URL ${baseUrl} is not a server in the spec (${bases.join(", ")})`);
  }
  const authText = sectionText(content, "Authentication");
  if (authText) {
    const schemes = Object.keys(spec.components?.securitySchemes || {});
    const requirements = (spec.security && spec.security.length > 0) ? spec.security : schemes.map((name) => ({ [name]: [] }));
    authenticationErrors(spec, authText, requirements, "the API").forEach((message) => errors.push(`${relativePath}: ${message}`));
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