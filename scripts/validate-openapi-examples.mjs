import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
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

function extractResponseJson(content) {
  const responseMatch = content.match(/## Response Example\s+[\s\S]*?```json\s*([\s\S]*?)```/);
  if (!responseMatch) {
    return null;
  }

  try {
    return JSON.parse(responseMatch[1]);
  } catch {
    return { __parseError: true };
  }
}

function extractRequestJson(content) {
  const requestMatch = content.match(/## Request Example\s+[\s\S]*?```bash\s*([\s\S]*?)```/);
  if (!requestMatch) {
    return null;
  }

  const curlBlock = requestMatch[1];
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
  const requestMatch = content.match(/## Request Example\s+[\s\S]*?```bash\s*([\s\S]*?)```/);
  const urlMatch = requestMatch?.[1].match(/curl\s+(?:-X\s+\w+\s+)?"([^"]+)"/);
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
    .map((cell, index) => (index < 3 ? cell.replace(/^`([^`]*)`$/, "$1") : cell));
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

function findBestSpecOperation(specs, route, method, requestJson, responseJson, documentedParameters) {
  const candidates = findSpecOperations(specs, route, method);
  if (candidates.length === 0) {
    return null;
  }

  return candidates
    .map((candidate) => ({
      candidate,
      score: scoreOperationMatch(candidate, route, requestJson, responseJson, documentedParameters)
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
  }
  return errors;
}

function routePattern(route) {
  return new RegExp(`^${route.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\\\{[^}]+\\\}|\{[^}]+\}/g, "[^/]+")}$`);
}

function checkEndpointDoc(content, relativePath, match, operationRef, requestJson, responseJson) {
  const errors = [];
  const add = (message) => errors.push(`${relativePath}: ${message}`);
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
  }

  // Error response body example.
  const errorBody = content.match(/Error response body \(`([^`]+)`\):\s*```json\s*([\s\S]*?)```/);
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
        const omittedHeader = parameter.in === "header" && /^(authorization|content-type|accept)$/i.test(parameter.name);
        if (!omittedHeader) {
          add(`${parameter.in} parameter '${parameter.name}' from ${specName} is missing from the parameter tables`);
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
  const curlText = (content.match(/```(?:bash|shell|sh|console)?\n(curl [\s\S]*?)```/) || [])[1] || "";
  if (curlText) {
    const schemes = spec.components?.securitySchemes || {};
    const requirements = securityRequirementsOf(spec, operation);
    const inUse = requirements.flatMap((requirement) => Object.keys(requirement || {}).map((name) => resolveRef(spec, schemes[name]) || {}));
    const subject = `${operationRef.method} ${operationRef.url}`;
    const sendsBasic = /(?:^|\s)(?:-u|--user)\s/.test(curlText) || /Authorization:\s*Basic\b/i.test(curlText);
    const sendsBearer = /Authorization:\s*Bearer\b/i.test(curlText);
    if (sendsBasic && !inUse.some((scheme) => scheme.type === "http" && /basic/i.test(scheme.scheme))) {
      add(`the request example sends Basic credentials, but the spec's security for ${subject} does not use Basic authentication`);
    }
    if (sendsBearer && !inUse.some((scheme) => (scheme.type === "http" && /bearer/i.test(scheme.scheme)) || scheme.type === "oauth2" || scheme.type === "openIdConnect")) {
      add(`the request example sends a Bearer token, but the spec's security for ${subject} does not use one`);
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
    for (const [name, value] of exampleUrl.searchParams) {
      const defined = specParameters.find((parameter) => parameter.in === "query" && parameter.name === name);
      if (!defined) {
        add(`request example uses query parameter '${name}', which is not defined in ${specName}`);
        continue;
      }
      const allowedValues = resolveSchema(spec, defined.schema)?.enum;
      if (Array.isArray(allowedValues) && !allowedValues.map(String).includes(value)) {
        add(`query parameter '${name}' uses '${value}', which is not one of its allowed values (${allowedValues.join(", ")})`);
      }
    }
    for (const parameter of specParameters.filter((candidate) => candidate.in === "query" && candidate.required)) {
      if (!exampleUrl.searchParams.has(parameter.name)) {
        add(`request example leaves out required query parameter '${parameter.name}'`);
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
        add(`error response '${code}' from ${specName} is missing from the Error Codes table`);
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
      documentedParameters
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

    errors.push(...checkEndpointDoc(content, relativePath, match, operationRef, requestJson, responseJson));
  }

  if (errors.length > 0) {
    // One write, then let Node exit on its own, so no line is lost when the
    // output is a pipe.
    process.stderr.write(`OpenAPI example validation failed:\n\n${errors.map((error) => `- ${error}`).join("\n")}\n`);
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
    (skippedCount === 1 ? " (1 Markdown file describes no endpoint and was not compared)." : skippedCount > 1 ? ` (${skippedCount} Markdown files describe no endpoint and were not compared).` : ".")
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});