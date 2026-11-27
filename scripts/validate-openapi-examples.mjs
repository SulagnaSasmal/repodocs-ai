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
    const spec = path.extname(filePath).toLowerCase() === ".json" ? JSON.parse(raw) : yaml.load(raw);

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

function extractParameterNames(content) {
  const sectionMatch = content.match(/## Parameters\s+[\s\S]*?\| --- \| --- \| --- \| --- \|\s*([\s\S]*?)(?:\n## |$)/);
  if (!sectionMatch) {
    return [];
  }

  return sectionMatch[1]
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => line.startsWith("|"))
    .map((line) => line.split("|")[1]?.trim())
    .filter(Boolean)
    .filter((value) => value !== "None");
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

function extractSchemaProperties(spec, operation) {
  const responseEntries = Object.entries(operation.responses || {});
  const success = responseEntries.find(([code]) => code.startsWith("2"));
  if (!success) {
    return null;
  }

  const [, response] = success;
  const schema = resolveSchema(spec, response.content?.["application/json"]?.schema);
  return schema?.properties || null;
}

function extractRequestSchema(spec, operation) {
  return resolveSchema(spec, operation.requestBody?.content?.["application/json"]?.schema) || null;
}

function collectDefinedParameterNames(pathItem, operation) {
  const combined = [...(pathItem.parameters || []), ...(operation.parameters || [])];
  return new Set(combined.map((parameter) => parameter.name));
}

function scoreOperationMatch(candidate, route, requestJson, responseJson, documentedParameters) {
  let score = candidate.route === route ? 5 : 0;

  const requestSchema = extractRequestSchema(candidate.spec, candidate.operation);
  const allowedRequestProperties = requestSchema?.properties || {};
  const allowedResponseProperties = extractSchemaProperties(candidate.spec, candidate.operation) || {};
  const definedParameters = collectDefinedParameterNames(candidate.pathItem, candidate.operation);

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

    const requestSchema = extractRequestSchema(match.spec, match.operation);
    if (requestSchema) {
      if (!requestJson) {
        errors.push(`${relativePath}: request body schema exists but no JSON request example was found`);
      } else if (typeof requestJson === "object" && !Array.isArray(requestJson)) {
        const allowedRequestProperties = requestSchema.properties || {};
        const requiredRequestProperties = new Set(requestSchema.required || []);

        for (const key of Object.keys(requestJson)) {
          if (!(key in allowedRequestProperties)) {
            errors.push(`${relativePath}: request example field '${key}' is not defined in ${path.basename(match.filePath)}`);
          }
        }

        for (const key of requiredRequestProperties) {
          if (!(key in requestJson)) {
            errors.push(`${relativePath}: request example is missing required field '${key}' from ${path.basename(match.filePath)}`);
          }
        }
      }
    }

    if (responseJson && typeof responseJson === "object" && !Array.isArray(responseJson)) {
      const allowedProperties = extractSchemaProperties(match.spec, match.operation);
      if (allowedProperties) {
        for (const key of Object.keys(responseJson)) {
          if (!(key in allowedProperties)) {
            errors.push(`${relativePath}: response example field '${key}' is not defined in ${path.basename(match.filePath)}`);
          }
        }
      }
    }

    const definedParameters = collectDefinedParameterNames(match.pathItem, match.operation);
    for (const name of documentedParameters) {
      if (!definedParameters.has(name)) {
        errors.push(`${relativePath}: parameter '${name}' is not defined in ${path.basename(match.filePath)}`);
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
  console.log(
    `Compared ${comparedCount} endpoint docs in ${checkedLabel} against the OpenAPI spec` +
    (skippedCount === 1 ? " (1 Markdown file describes no endpoint and was not compared)." : skippedCount > 1 ? ` (${skippedCount} Markdown files describe no endpoint and were not compared).` : ".")
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});