import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

// Scan all directories that may contain OpenAPI specifications.
// This must align with docDirectories to avoid phantom endpoint false positives.
const specDirectories = ["examples/openapi", "examples/payments-api", "examples/api-docs"];
const docDirectories = ["examples/api-docs", "examples/payments-api", "examples/complete-system", "generated", "docs"];
const supportedMethods = new Set(["get", "post", "put", "patch", "delete"]);

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(directory, extensions) {
  if (!(await pathExists(directory))) {
    return [];
  }

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

function normalizeRoute(route) {
  return route.replace(/\{[^}]+\}/g, "{}").toLowerCase();
}

async function loadSpecEndpoints() {
  const endpoints = [];
  const specFiles = [];

  for (const dir of specDirectories) {
    specFiles.push(...(await collectFiles(path.join(repoRoot, dir), new Set([".yaml", ".yml", ".json"]))));
  }

  for (const filePath of specFiles) {
    const raw = await fs.readFile(filePath, "utf8");
    let spec;
    try {
      spec = filePath.endsWith(".json") ? JSON.parse(raw) : yaml.load(raw);
    } catch {
      continue;
    }

    if (!spec?.openapi || !spec?.paths) {
      continue;
    }

    for (const [route, pathItem] of Object.entries(spec.paths)) {
      for (const method of supportedMethods) {
        if (pathItem[method]) {
          endpoints.push({
            method: method.toUpperCase(),
            route,
            normalized: `${method.toUpperCase()} ${normalizeRoute(route)}`,
            source: path.relative(repoRoot, filePath).replace(/\\/g, "/"),
            summary: pathItem[method].summary || ""
          });
        }
      }
    }
  }

  // Deduplicate by normalized route — multiple spec files may define the same endpoint.
  const seen = new Set();
  return endpoints.filter((e) => {
    if (seen.has(e.normalized)) {
      return false;
    }
    seen.add(e.normalized);
    return true;
  });
}

async function loadDocumentedEndpoints() {
  const endpoints = [];
  const docFiles = [];

  for (const dir of docDirectories) {
    docFiles.push(...(await collectFiles(path.join(repoRoot, dir), new Set([".md"]))));
  }

  for (const filePath of docFiles) {
    const content = await fs.readFile(filePath, "utf8");
    const methodMatch = content.match(/- Method: `([A-Z]+)`/);
    const urlMatch = content.match(/- URL: `([^`]+)`/);

    if (!methodMatch || !urlMatch) {
      continue;
    }

    const method = methodMatch[1];
    const route = urlMatch[1];

    if (!supportedMethods.has(method.toLowerCase())) {
      continue;
    }

    endpoints.push({
      method,
      route,
      normalized: `${method} ${normalizeRoute(route)}`,
      source: path.relative(repoRoot, filePath).replace(/\\/g, "/")
    });
  }

  return endpoints;
}

async function main() {
  const specEndpoints = await loadSpecEndpoints();
  const docEndpoints = await loadDocumentedEndpoints();

  if (specEndpoints.length === 0) {
    console.log("No OpenAPI specifications found in examples/openapi/.");
    console.log("Add OpenAPI spec files to enable endpoint coverage analysis.");
    return;
  }

  const documentedNormalized = new Set(docEndpoints.map((e) => e.normalized));
  const specNormalized = new Set(specEndpoints.map((e) => e.normalized));

  const undocumented = specEndpoints.filter((e) => !documentedNormalized.has(e.normalized));
  const phantom = docEndpoints.filter((e) => !specNormalized.has(e.normalized));
  const documented = specEndpoints.length - undocumented.length;
  const coverage = Math.round((documented / specEndpoints.length) * 100);

  console.log("\nDocumentation Coverage Report");
  console.log("------------------------------");
  console.log(`Total endpoints in specs : ${specEndpoints.length}`);
  console.log(`Documented endpoints     : ${documented}`);
  console.log(`Undocumented endpoints   : ${undocumented.length}`);
  console.log(`Coverage                 : ${coverage}%`);

  if (undocumented.length > 0) {
    console.log("\nUndocumented Endpoints (present in spec, missing from docs):");
    for (const e of undocumented) {
      const summary = e.summary ? ` — ${e.summary}` : "";
      console.log(`  - ${e.method} ${e.route}  [${e.source}]${summary}`);
    }
  }

  if (phantom.length > 0) {
    console.log("\nPhantom Endpoints (present in docs, not found in spec):");
    for (const e of phantom) {
      console.log(`  - ${e.method} ${e.route}  [${e.source}]`);
    }
  }

  if (undocumented.length === 0 && phantom.length === 0) {
    console.log("\nAll spec endpoints are documented. No phantom endpoints detected.");
  }

  if (undocumented.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
