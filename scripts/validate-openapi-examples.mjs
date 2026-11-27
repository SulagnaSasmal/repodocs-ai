import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { assertPathsExist, displayPath, exitWithTargetError, parseTargets } from "./lib/cli-targets.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const scanDirectories = ["examples/api-docs", "generated"];
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
  const methodMatch = content.match(/- Method: `([A-Z]+)`/);
  const urlMatch = content.match(/- URL: `([^`]+)`/);
  if (!methodMatch || !urlMatch) {
    return null;
  }

  const method = methodMatch[1];
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
  const bodyMatch = curlBlock.match(/(?:-d|--data|--data-raw)\s+'([^']+)'/);
  if (!bodyMatch) {
    return null;
  }

  try {
    return JSON.parse(bodyMatch[1]);
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
    tableRows(content, heading).map((cells) => ({ name: cells[0], location, required: cells[2]?.toLowerCase() }))
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
    resolved = resolved.$ref.slice(2).split("/").reduce((current, segment) => current?.[segment], spec);
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

// Rows of a Markdown table under a "## <heading>" section: [first cell, third cell].
function tableRows(content, heading, minCells = 3) {
  const start = content.indexOf(`## ${heading}\n`);
  if (start === -1) {
    return [];
  }
  const next = content.indexOf("\n## ", start + 3);
  const body = content.slice(start, next === -1 ? undefined : next);
  // Header rows are the ones directly above a | --- | separator line.
  const lines = body.split(/\r?\n/).map((line) => line.trim());
  const isSeparator = (line) => /^\|\s*:?-{3}/.test(line);
  return lines
    .filter((line, index) => line.startsWith("|") && !isSeparator(line) && !isSeparator(lines[index + 1] || ""))
    .map((line) => line.split(/(?<!\\)\|/).slice(1, -1).map((cell) => cell.trim()))
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

// Checks a JSON example against the schema, at every depth: unknown fields
// and values outside an enum. Returns error messages.
function checkJsonValue(spec, value, schema, label, kind, depth = 0) {
  if (depth > 8 || value === null || value === undefined) {
    return [];
  }
  const shapes = expandShapes(spec, schema);
  if (shapes.length === 0) {
    return [];
  }
  const errors = [];
  const enumShapes = shapes.filter((shape) => Array.isArray(shape.enum));
  if (enumShapes.length > 0 && enumShapes.length === shapes.length && typeof value !== "object") {
    const allowed = enumShapes.flatMap((shape) => shape.enum);
    if (!allowed.map(String).includes(String(value))) {
      errors.push(`${kind} example field '${label}' uses '${value}', which is not one of its allowed values (${allowed.join(", ")})`);
    }
    return errors;
  }
  if (Array.isArray(value)) {
    const itemSchemas = shapes.filter((shape) => shape.items).map((shape) => shape.items);
    for (const item of value.slice(0, 5)) {
      for (const itemSchema of itemSchemas.slice(0, 1)) {
        errors.push(...checkJsonValue(spec, item, itemSchema, `${label}[]`, kind, depth + 1));
      }
    }
    return errors;
  }
  if (typeof value === "object") {
    // Shapes with no listed properties, or that allow extra ones, are open.
    const objectShapes = shapes.filter((shape) => shape.properties && Object.keys(shape.properties).length > 0);
    if (objectShapes.length === 0 || objectShapes.length < shapes.length || shapes.some((shape) => shape.additionalProperties)) {
      return errors;
    }
    for (const [key, child] of Object.entries(value)) {
      const owners = objectShapes.filter((shape) => key in shape.properties);
      const childLabel = label ? `${label}.${key}` : key;
      if (owners.length === 0) {
        if (depth > 0) {
          errors.push(`${kind} example field '${childLabel}' is not defined`);
        }
        continue;
      }
      errors.push(...checkJsonValue(spec, child, owners[0].properties[key], childLabel, kind, depth + 1));
    }
  }
  return errors;
}

// The property schema a table row name points at, such as "channel.from.type"
// or "items[].id". Property names may themselves contain dots.
function schemaForField(spec, shapes, name) {
  if (!name) {
    return shapes[0] || null;
  }
  for (const shape of shapes.flatMap((candidate) => expandShapes(spec, candidate))) {
    for (const [property, propertySchema] of Object.entries(shape.properties || {})) {
      for (const suffix of ["", "[]"]) {
        const head = property + suffix;
        if (name === head) {
          return suffix ? resolveSchema(spec, propertySchema)?.items || propertySchema : propertySchema;
        }
        if (name.startsWith(`${head}.`)) {
          const next = suffix ? resolveSchema(spec, propertySchema)?.items : propertySchema;
          const found = schemaForField(spec, [next], name.slice(head.length + 1));
          if (found) {
            return found;
          }
        }
      }
    }
  }
  return null;
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
    process.exit(1);
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

    const specName = path.basename(match.filePath);
    const spec = match.spec;

    const requestShapes = shapesOf(spec, extractRequestSchema(spec, match.operation));
    if (requestShapes.length > 0) {
      if (!requestJson) {
        errors.push(`${relativePath}: request body schema exists but no JSON request example was found`);
      } else if (typeof requestJson === "object" && !Array.isArray(requestJson)) {
        const allowed = allowedProperties(requestShapes);
        const keys = Object.keys(requestJson);
        for (const key of keys) {
          if (!(key in allowed)) {
            errors.push(`${relativePath}: request example field '${key}' is not defined in ${specName}`);
          } else if (resolveSchema(spec, allowed[key])?.readOnly) {
            errors.push(`${relativePath}: request example sends '${key}', which is readOnly in ${specName}`);
          }
        }
        for (const message of checkJsonValue(spec, requestJson, extractRequestSchema(spec, match.operation), "", "request")) {
          errors.push(`${relativePath}: ${message} in ${specName}`);
        }
        // The example must satisfy the required fields of at least one allowed shape.
        const missingByShape = requestShapes.map((shape) => (shape.required || []).filter((key) => !(key in requestJson)));
        if (!missingByShape.some((missing) => missing.length === 0)) {
          const fewest = missingByShape.reduce((best, missing) => (missing.length < best.length ? missing : best));
          for (const key of fewest) {
            errors.push(`${relativePath}: request example is missing required field '${key}' from ${specName}`);
          }
        }
      }
    }

    const responseShapes = shapesOf(spec, jsonSchemaOf(successResponse(spec, match.operation)?.content));
    if (responseJson && typeof responseJson === "object" && !Array.isArray(responseJson) && responseShapes.some((shape) => shape.properties)) {
      const allowed = allowedProperties(responseShapes);
      for (const key of Object.keys(responseJson)) {
        if (!(key in allowed)) {
          errors.push(`${relativePath}: response example field '${key}' is not defined in ${specName}`);
        } else if (resolveSchema(spec, allowed[key])?.writeOnly) {
          errors.push(`${relativePath}: response example shows '${key}', which is writeOnly in ${specName}`);
        }
      }
      for (const message of checkJsonValue(spec, responseJson, jsonSchemaOf(successResponse(spec, match.operation)?.content), "", "response")) {
        errors.push(`${relativePath}: ${message} in ${specName}`);
      }
    }

    // Parameter tables: every parameter exists in the spec with the same Required flag.
    const specParameters = definedParameters(spec, match.pathItem, match.operation);
    for (const documented of extractDocumentedParameters(content)) {
      const defined = specParameters.find((parameter) => parameter.name === documented.name && (!documented.location || parameter.in === documented.location));
      if (!defined) {
        errors.push(`${relativePath}: parameter '${documented.name}' is not defined in ${specName}`);
        continue;
      }
      const specRequired = defined.required ? "yes" : "no";
      if ((documented.required === "yes" || documented.required === "no") && documented.required !== specRequired) {
        errors.push(`${relativePath}: parameter '${documented.name}' is marked Required: ${documented.required}, but the spec says ${specRequired}`);
      }
    }

    // Request body table: top-level Required flags match the spec. Skipped
    // when the body has several shapes, which are documented per option.
    if (requestShapes.length === 1 && !content.includes("### Option 1")) {
      const required = new Set(requestShapes[0].required || []);
      for (const cells of tableRows(content, "Request Body")) {
        const [name, , flag] = cells;
        if (/[.[\]]/.test(name) || !(name in (requestShapes[0].properties || {}))) {
          continue;
        }
        if ((flag === "yes" || flag === "no") && (flag === "yes") !== required.has(name)) {
          errors.push(`${relativePath}: request field '${name}' is marked Required: ${flag}, but the spec says ${required.has(name) ? "yes" : "no"}`);
        }
      }
    }

    // Request body table rows: every field exists, with the spec's type and allowed values.
    const tableShapes = expandShapes(spec, extractRequestSchema(spec, match.operation) || resolveSchema(spec, Object.values(resolveRef(spec, match.operation.requestBody)?.content || {})[0]?.schema));
    if (tableShapes.length > 0) {
      for (const [name, type, , description = ""] of tableRows(content, "Request Body")) {
        const fieldSchema = schemaForField(spec, tableShapes, name);
        if (!fieldSchema) {
          errors.push(`${relativePath}: request field '${name}' in the Request Body table is not defined in ${specName}`);
          continue;
        }
        const specType = basicType(spec, fieldSchema);
        const docType = type.replace(/<.*$/, "").trim();
        if (specType && /^(string|integer|number|boolean|object|array)$/.test(docType) && docType !== specType) {
          errors.push(`${relativePath}: request field '${name}' is documented as ${docType}, but the spec says ${specType}`);
        }
        const listed = description.match(/Allowed values: ([^.|]+?)(?:\.\s|\.$|$)/)?.[1];
        const specEnum = resolveSchema(spec, fieldSchema)?.enum;
        if (listed) {
          const documentedValues = listed.split(",").map((value) => value.trim()).filter(Boolean).sort();
          const specValues = (specEnum || []).map(String).sort();
          if (!specEnum || documentedValues.join("|") !== specValues.join("|")) {
            errors.push(`${relativePath}: request field '${name}' lists allowed values (${documentedValues.join(", ")}) that do not match the spec (${specValues.join(", ") || "no enum"})`);
          }
        }
      }
    }

    // Authentication section agrees with the spec's security requirements.
    const security = match.operation.security ?? spec.security ?? [];
    const requiresAuth = security.some((requirement) => requirement && Object.keys(requirement).length > 0);
    const authStart = content.search(/## Authentication/);
    const authText = authStart === -1 ? "" : content.slice(authStart, content.indexOf("\n## ", authStart + 3) === -1 ? undefined : content.indexOf("\n## ", authStart + 3));
    if (authText) {
      const saysNone = /no authentication/i.test(authText);
      if (requiresAuth && saysNone) {
        errors.push(`${relativePath}: Authentication says none is required, but the spec requires it`);
      }
      if (!requiresAuth && !saysNone && /authentication is required|bearer|api key|oauth|basic/i.test(authText)) {
        errors.push(`${relativePath}: Authentication says it is required, but the spec defines no security for this operation`);
      }
      if (requiresAuth && /API key in (header|query|cookie)/.test(authText)) {
        const schemes = spec.components?.securitySchemes || {};
        const hasApiKey = security.some((requirement) => Object.keys(requirement || {}).some((name) => resolveRef(spec, schemes[name])?.type === "apiKey"));
        if (!hasApiKey) {
          errors.push(`${relativePath}: Authentication mentions an API key, but the spec's security for this operation uses no API key`);
        }
      }
    }

    // The request example calls one of the spec's servers.
    const bases = serverBases(spec).filter((base) => /^https?:\/\//.test(base));
    const exampleUrl = extractCurlUrl(content);
    if (exampleUrl && bases.length > 0 && !bases.some((base) => exampleUrl.href.startsWith(base))) {
      errors.push(`${relativePath}: request example calls ${exampleUrl.origin}${exampleUrl.pathname}, which is not under any server in ${specName} (${bases.join(", ")})`);
    }

    // The success status shown with the response example exists in the spec.
    const statusShown = content.match(/## Response Example\s+Status: `([^`]+)`/)?.[1];
    if (statusShown && !statusCodeAllowed(statusShown, match.operation.responses)) {
      errors.push(`${relativePath}: response status '${statusShown}' is not defined for ${operationRef.method} ${operationRef.url} in ${specName}`);
    }

    // Query string in the request example: known parameters and allowed values.
    const curlUrl = extractCurlUrl(content);
    if (curlUrl) {
      for (const [name, value] of curlUrl.searchParams) {
        const defined = specParameters.find((parameter) => parameter.in === "query" && parameter.name === name);
        if (!defined) {
          errors.push(`${relativePath}: request example uses query parameter '${name}', which is not defined in ${specName}`);
          continue;
        }
        const allowedValues = resolveSchema(spec, defined.schema)?.enum;
        if (Array.isArray(allowedValues) && !allowedValues.map(String).includes(value)) {
          errors.push(`${relativePath}: query parameter '${name}' uses '${value}', which is not one of its allowed values (${allowedValues.join(", ")})`);
        }
      }
    }

    // Status codes in the Error Codes table exist in the spec.
    for (const [code] of tableRows(content, "Error Codes", 2)) {
      const normalized = code.replace(/`/g, "");
      if (normalized === "default" ? !("default" in (match.operation.responses || {})) : !statusCodeAllowed(normalized, match.operation.responses)) {
        errors.push(`${relativePath}: status code '${normalized}' is not defined for ${operationRef.method} ${operationRef.url} in ${specName}`);
      }
    }
  }

  if (errors.length > 0) {
    console.error("OpenAPI example validation failed:\n");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
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
  process.exit(1);
});