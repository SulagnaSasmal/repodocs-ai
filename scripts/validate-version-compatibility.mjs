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

function hasEndpointMarker(content) {
  return /- Method: `([A-Z]+)`/.test(content) && /- URL: `([^`]+)`/.test(content);
}

async function main() {
  const specVersions = await loadSpecVersions();
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