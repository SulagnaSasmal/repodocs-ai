import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const targetDirectories = ["templates", "examples"];
const requiredFields = [
  "title",
  "description",
  "service",
  "component",
  "owner",
  "api_version",
  "status",
  "dependencies",
  "last_reviewed",
  "security_impact"
];
const allowedStatus = new Set(["draft", "beta", "stable", "deprecated"]);
const allowedSecurityImpact = new Set(["low", "medium", "high"]);
const allowedAudience = new Set(["internal", "external", "both"]);

async function collectMarkdownFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMarkdownFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && entry.name.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files;
}

function extractFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  return match ? match[1] : null;
}

async function main() {
  const markdownFiles = [];
  for (const directory of targetDirectories) {
    const fullDirectory = path.join(repoRoot, directory);
    markdownFiles.push(...(await collectMarkdownFiles(fullDirectory)));
  }

  const errors = [];

  for (const filePath of markdownFiles) {
    const content = await fs.readFile(filePath, "utf8");
    const frontmatter = extractFrontmatter(content);
    const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, "/");

    if (!frontmatter) {
      errors.push(`${relativePath}: missing YAML frontmatter`);
      continue;
    }

    let parsed;
    try {
      parsed = yaml.load(frontmatter);
    } catch (error) {
      errors.push(`${relativePath}: invalid YAML frontmatter (${error.message})`);
      continue;
    }

    for (const field of requiredFields) {
      if (!(field in parsed)) {
        errors.push(`${relativePath}: missing required field '${field}'`);
      }
    }

    if (parsed.status && !allowedStatus.has(parsed.status)) {
      errors.push(`${relativePath}: invalid status '${parsed.status}'`);
    }

    if (parsed.security_impact && !allowedSecurityImpact.has(parsed.security_impact)) {
      errors.push(`${relativePath}: invalid security_impact '${parsed.security_impact}'`);
    }

    if (parsed.dependencies && !Array.isArray(parsed.dependencies)) {
      errors.push(`${relativePath}: dependencies must be an array`);
    }

    if (parsed.audience !== undefined && !allowedAudience.has(parsed.audience)) {
      errors.push(`${relativePath}: invalid audience '${parsed.audience}' — use 'internal', 'external', or 'both'`);
    }

    if (parsed.reviewed_by !== undefined && (typeof parsed.reviewed_by !== "string" || parsed.reviewed_by.trim() === "")) {
      errors.push(`${relativePath}: 'reviewed_by' must be a non-empty string when present`);
    }
  }

  if (errors.length > 0) {
    console.error("Frontmatter validation failed:\n");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(`Validated frontmatter for ${markdownFiles.length} Markdown files.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});