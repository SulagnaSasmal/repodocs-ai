import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

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

async function loadSpecs() {
  const specsDirectory = path.join(repoRoot, "examples", "openapi");
  if (!(await pathExists(specsDirectory))) {
    return [];
  }

  const files = await collectFiles(specsDirectory, supportedSpecExtensions);
  const specs = [];

  for (const filePath of files) {
    const raw = await fs.readFile(filePath, "utf8");
    const spec = path.extname(filePath).toLowerCase() === ".json" ? JSON.parse(raw) : yaml.load(raw);
    specs.push({ filePath, spec });
  }

  return specs;
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

function findSpecOperation(specs, route, method) {
  const lowerMethod = method.toLowerCase();

  for (const { filePath, spec } of specs) {
    const pathItem = spec.paths?.[route];
    const operation = pathItem?.[lowerMethod];
    if (operation) {
      return { filePath, pathItem, operation };
    }
  }

  return null;
}

function extractSchemaProperties(operation) {
  const responseEntries = Object.entries(operation.responses || {});
  const success = responseEntries.find(([code]) => code.startsWith("2"));
  if (!success) {
    return null;
  }

  const [, response] = success;
  const schema = response.content?.["application/json"]?.schema;
  return schema?.properties || null;
}

function extractRequestSchema(operation) {
  return operation.requestBody?.content?.["application/json"]?.schema || null;
}

function collectDefinedParameterNames(pathItem, operation) {
  const combined = [...(pathItem.parameters || []), ...(operation.parameters || [])];
  return new Set(combined.map((parameter) => parameter.name));
}

async function main() {
  const specs = await loadSpecs();
  const errors = [];
  const markdownFiles = [];

  for (const relativeDirectory of scanDirectories) {
    const directory = path.join(repoRoot, relativeDirectory);
    if (await pathExists(directory)) {
      markdownFiles.push(...(await collectFiles(directory, new Set([".md"]))));
    }
  }

  for (const filePath of markdownFiles) {
    const content = await fs.readFile(filePath, "utf8");
    const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, "/");
    const operationRef = extractOperation(content);

    if (!operationRef) {
      continue;
    }

    const match = findSpecOperation(specs, operationRef.url, operationRef.method);
    if (!match) {
      errors.push(`${relativePath}: no OpenAPI operation found for ${operationRef.method} ${operationRef.url}`);
      continue;
    }

    const responseJson = extractResponseJson(content);
    const requestJson = extractRequestJson(content);
    if (responseJson?.__parseError) {
      errors.push(`${relativePath}: response example is not valid JSON`);
      continue;
    }

    if (requestJson?.__parseError) {
      errors.push(`${relativePath}: request example body is not valid JSON`);
      continue;
    }

    const requestSchema = extractRequestSchema(match.operation);
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
      const allowedProperties = extractSchemaProperties(match.operation);
      if (allowedProperties) {
        for (const key of Object.keys(responseJson)) {
          if (!(key in allowedProperties)) {
            errors.push(`${relativePath}: response example field '${key}' is not defined in ${path.basename(match.filePath)}`);
          }
        }
      }
    }

    const documentedParameters = extractParameterNames(content);
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

  console.log(`Validated ${markdownFiles.length} Markdown files against OpenAPI examples.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});