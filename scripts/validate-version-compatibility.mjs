import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import { assertPathsExist, displayPath, exitWithTargetError, parseTargets } from "./lib/cli-targets.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const specsRoot = path.join(repoRoot, "examples", "openapi");
const scanDirectories = ["examples/api-docs", "examples/payments-api", "examples/complete-system", "generated"];

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

const specExtensions = new Set([".yaml", ".yml", ".json"]);

async function collectFromTarget(target, extensions) {
  const stats = await fs.stat(target).catch(() => null);
  if (!stats) {
    return [];
  }
  if (stats.isFile()) {
    return extensions.has(path.extname(target).toLowerCase()) ? [target] : [];
  }
  const files = [];
  for (const extension of extensions) {
    files.push(...(await collectFiles(target, extension)));
  }
  return files;
}

async function loadSpecs(specTargets) {
  const specs = [];
  for (const target of specTargets) {
    for (const filePath of await collectFromTarget(target, specExtensions)) {
      const raw = await fs.readFile(filePath, "utf8");
      const spec = path.extname(filePath).toLowerCase() === ".json" ? JSON.parse(raw) : yaml.load(raw, { schema: yaml.CORE_SCHEMA });
      if (spec?.openapi) {
        specs.push({ filePath, spec });
      }
    }
  }
  return specs;
}

function specVersionsOf(specs) {
  const versions = new Set();
  for (const { spec } of specs) {
    if (typeof spec?.info?.version === "string") {
      versions.add(spec.info.version.trim());
    }
  }
  return versions;
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
      `Skipped version compatibility check for ${checkedLabel}: no specs given. ` +
      "Add --specs <folder with your OpenAPI files> to check api_version against the spec."
    );
    return;
  }

  const specTargets = targets.specPaths.length > 0 ? targets.specPaths : [specsRoot];
  const specs = await loadSpecs(specTargets);
  if (targets.userMode && specs.length === 0) {
    console.error(`No OpenAPI specs found in ${specTargets.map((target) => displayPath(target, displayRoot)).join(", ")}.`);
    process.exitCode = 1;
    return;
  }
  const specVersions = specVersionsOf(specs);
  const allowedVersions = new Set([...specVersions, "n/a"]);
  const errors = [];
  const markdownFiles = [];
  let checkedCount = 0;
  let notApplicableCount = 0;

  for (const target of docTargets) {
    markdownFiles.push(...(await collectFromTarget(target, new Set([".md"]))));
  }

  for (const filePath of markdownFiles) {
    const content = await fs.readFile(filePath, "utf8");
    const frontmatter = extractFrontmatter(content);
    const relativePath = displayPath(filePath, displayRoot);

    if (!frontmatter) {
      continue;
    }

    checkedCount += 1;

    const version = typeof frontmatter.api_version === "string" ? frontmatter.api_version.trim() : null;
    if (!version) {
      errors.push(`${relativePath}: missing api_version in frontmatter`);
      continue;
    }

    if (version === "n/a") {
      notApplicableCount += 1;
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
    // One write, then let Node exit on its own, so no line is lost when the
    // output is a pipe.
    process.stderr.write(`Version compatibility validation failed:\n\n${errors.map((error) => `- ${error}`).join("\n")}\n`);
    process.exitCode = 1;
    return;
  }

  const skippedCount = markdownFiles.length - checkedCount;
  if (targets.userMode && checkedCount === 0) {
    console.log(`Skipped version compatibility check for ${checkedLabel}: no docs with frontmatter found, so nothing was compared with the spec.`);
    return;
  }
  const notApplicableNote = notApplicableCount > 0
    ? ` ${notApplicableCount} of them use api_version 'n/a', which is allowed only for docs that describe no endpoint and is not compared with a spec version.`
    : "";
  console.log(
    `Checked api_version for ${checkedCount} Markdown files in ${checkedLabel}` +
    (skippedCount === 1 ? " (1 file has no frontmatter and was not checked)." : skippedCount > 1 ? ` (${skippedCount} files have no frontmatter and were not checked).` : ".") +
    notApplicableNote
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});