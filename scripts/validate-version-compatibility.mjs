import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const specsRoot = path.join(repoRoot, "examples", "openapi");
const scanDirectories = ["examples/api-docs", "examples/complete-system", "generated"];

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function collectFiles(directory, extension) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath, extension)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(extension)) {
      files.push(fullPath);
    }
  }

  return files;
}

function extractFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  return match ? yaml.load(match[1]) : null;
}

async function loadSpecVersions() {
  const versions = new Set();
  if (!(await pathExists(specsRoot))) {
    return versions;
  }

  const files = await collectFiles(specsRoot, ".yaml");
  for (const filePath of files) {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = yaml.load(raw);
    if (typeof parsed?.info?.version === "string") {
      versions.add(parsed.info.version.trim());
    }
  }

  return versions;
}

async function loadSpecs() {
  if (!(await pathExists(specsRoot))) {
    return [];
  }

  const files = await collectFiles(specsRoot, ".yaml");
  const specs = [];

  for (const filePath of files) {
    const raw = await fs.readFile(filePath, "utf8");
    specs.push({ filePath, spec: yaml.load(raw) });
  }

  return specs;
}

function hasEndpointMarker(content) {
  return /- Method: `([A-Z]+)`/.test(content) && /- URL: `([^`]+)`/.test(content);
}

function extractOperation(content) {
  const methodMatch = content.match(/- Method: `([A-Z]+)`/);
  const urlMatch = content.match(/- URL: `([^`]+)`/);
  if (!methodMatch || !urlMatch) {
    return null;
  }

  return { method: methodMatch[1], url: urlMatch[1] };
}

function findSpecOperation(specs, route, method) {
  const lookupMethod = method.toLowerCase();

  for (const { filePath, spec } of specs) {
    const pathItem = spec.paths?.[route];
    const operation = pathItem?.[lookupMethod];
    if (operation) {
      return { filePath, operation };
    }
  }

  return null;
}

function extractSection(content, title) {
  const pattern = new RegExp(`## ${title}\\s+([\\s\\S]*?)(?:\\n## |$)`);
  const match = content.match(pattern);
  return match ? match[1].trim() : "";
}

function validateDeprecatedFields(relativePath, frontmatter, content, errors) {
  if (frontmatter.status !== "deprecated") {
    const unexpectedLifecycle = ["deprecated_since", "sunset_version", "replaced_by", "migration_guide"].filter(
      (field) => field in frontmatter
    );
    if (unexpectedLifecycle.length > 0) {
      errors.push(`${relativePath}: deprecated lifecycle fields require status 'deprecated'`);
    }
    return;
  }

  if (typeof frontmatter.deprecated_since !== "string" || !frontmatter.deprecated_since.trim()) {
    errors.push(`${relativePath}: deprecated documents must set deprecated_since`);
  }

  if (typeof frontmatter.migration_guide !== "string" || !frontmatter.migration_guide.trim()) {
    errors.push(`${relativePath}: deprecated documents must set migration_guide`);
  }

  if (!extractSection(content, "Deprecation")) {
    errors.push(`${relativePath}: deprecated documents must include a Deprecation section`);
  }

  if (!extractSection(content, "Migration")) {
    errors.push(`${relativePath}: deprecated documents must include a Migration section`);
  }
}

async function main() {
  const specVersions = await loadSpecVersions();
  const specs = await loadSpecs();
  const allowedVersions = new Set([...specVersions, "n/a"]);
  const errors = [];
  const markdownFiles = [];

  for (const relativeDirectory of scanDirectories) {
    const directory = path.join(repoRoot, relativeDirectory);
    if (await pathExists(directory)) {
      markdownFiles.push(...(await collectFiles(directory, ".md")));
    }
  }

  for (const filePath of markdownFiles) {
    const content = await fs.readFile(filePath, "utf8");
    const frontmatter = extractFrontmatter(content);
    const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, "/");

    if (!frontmatter) {
      continue;
    }

    const version = typeof frontmatter.api_version === "string" ? frontmatter.api_version.trim() : null;
    if (!version) {
      errors.push(`${relativePath}: missing api_version in frontmatter`);
      continue;
    }

    if (!allowedVersions.has(version)) {
      errors.push(`${relativePath}: api_version '${version}' does not match any known OpenAPI version`);
    }

    if (hasEndpointMarker(content) && version === "n/a") {
      errors.push(`${relativePath}: endpoint-style documentation cannot use api_version 'n/a'`);
    }

    const sourceVersionMatch = content.match(/Source specification version:\s*([^\n]+)/);
    if (sourceVersionMatch) {
      const sourceVersion = sourceVersionMatch[1].trim();
      if (version !== sourceVersion) {
        errors.push(`${relativePath}: frontmatter api_version '${version}' does not match referenced source version '${sourceVersion}'`);
      }
    }

    validateDeprecatedFields(relativePath, frontmatter, content, errors);

    const operationRef = extractOperation(content);
    if (!operationRef) {
      continue;
    }

    const specOperation = findSpecOperation(specs, operationRef.url, operationRef.method);
    if (!specOperation) {
      continue;
    }

    const deprecatedInSpec = specOperation.operation.deprecated === true;
    if (deprecatedInSpec && frontmatter.status !== "deprecated") {
      errors.push(`${relativePath}: status must be 'deprecated' because ${operationRef.method} ${operationRef.url} is deprecated in ${path.basename(specOperation.filePath)}`);
    }

    if (!deprecatedInSpec && frontmatter.status === "deprecated") {
      errors.push(`${relativePath}: document is marked deprecated but ${operationRef.method} ${operationRef.url} is not deprecated in ${path.basename(specOperation.filePath)}`);
    }

    if (!deprecatedInSpec) {
      continue;
    }

    const deprecatedSince = specOperation.operation["x-deprecated-since"];
    const sunsetVersion = specOperation.operation["x-sunset-version"];
    const replacement = specOperation.operation["x-replaced-by"];
    const migrationGuide = specOperation.operation["x-migration-guide"];
    const deprecationSection = extractSection(content, "Deprecation");
    const migrationSection = extractSection(content, "Migration");

    if (deprecatedSince && frontmatter.deprecated_since !== deprecatedSince) {
      errors.push(`${relativePath}: deprecated_since '${frontmatter.deprecated_since}' does not match source value '${deprecatedSince}'`);
    }

    if (sunsetVersion && frontmatter.sunset_version !== sunsetVersion) {
      errors.push(`${relativePath}: sunset_version '${frontmatter.sunset_version}' does not match source value '${sunsetVersion}'`);
    }

    if (replacement && frontmatter.replaced_by !== replacement) {
      errors.push(`${relativePath}: replaced_by '${frontmatter.replaced_by}' does not match source value '${replacement}'`);
    }

    if (migrationGuide && frontmatter.migration_guide !== migrationGuide) {
      errors.push(`${relativePath}: migration_guide '${frontmatter.migration_guide}' does not match source value '${migrationGuide}'`);
    }

    if (deprecatedSince && !deprecationSection.includes(deprecatedSince)) {
      errors.push(`${relativePath}: Deprecation section must mention deprecated_since value '${deprecatedSince}'`);
    }

    if (sunsetVersion && !deprecationSection.includes(sunsetVersion)) {
      errors.push(`${relativePath}: Deprecation section must mention sunset_version '${sunsetVersion}'`);
    }

    if (replacement && !migrationSection.includes(replacement)) {
      errors.push(`${relativePath}: Migration section must mention replacement '${replacement}'`);
    }

    if (migrationGuide && !migrationSection.includes(migrationGuide)) {
      errors.push(`${relativePath}: Migration section must mention migration guide '${migrationGuide}'`);
    }
  }

  if (errors.length > 0) {
    console.error("Version compatibility validation failed:\n");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(`Validated version compatibility for ${markdownFiles.length} Markdown files.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});