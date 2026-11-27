import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { assertPathsExist, displayPath, exitWithTargetError, parseTargets } from "./lib/cli-targets.mjs";

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
  let targets;
  try {
    targets = parseTargets();
    await assertPathsExist(targets.docPaths, "Docs path");
  } catch (error) {
    exitWithTargetError(error);
  }

  const directoriesToCheck = targets.userMode
    ? targets.docPaths
    : targetDirectories.map((directory) => path.join(repoRoot, directory));
  const displayRoot = targets.userMode ? targets.baseDirectory : repoRoot;
  const checkedLabel = directoriesToCheck.map((directory) => displayPath(directory, displayRoot)).join(", ");

  const markdownFiles = [];
  for (const fullDirectory of directoriesToCheck) {
    const stats = await fs.stat(fullDirectory).catch(() => null);
    if (stats?.isFile()) {
      if (fullDirectory.endsWith(".md")) {
        markdownFiles.push(fullDirectory);
      }
      continue;
    }
    if (stats) {
      markdownFiles.push(...(await collectMarkdownFiles(fullDirectory)));
    }
  }

  if (markdownFiles.length === 0) {
    console.error(`No Markdown files found in ${checkedLabel}. Nothing was checked, so no result is reported.`);
    process.exit(1);
  }

  const errors = [];

  for (const filePath of markdownFiles) {
    const content = await fs.readFile(filePath, "utf8");
    const frontmatter = extractFrontmatter(content);
    const relativePath = displayPath(filePath, displayRoot);

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

    // This repository's own templates ship with empty fields for authors to fill in.
    const isTemplate = !targets.userMode && path.relative(repoRoot, filePath).startsWith("templates" + path.sep);
    for (const field of requiredFields) {
      if (!(field in parsed)) {
        errors.push(`${relativePath}: missing required field '${field}'`);
      } else if (!isTemplate && field !== "dependencies" && (parsed[field] === null || String(parsed[field]).trim() === "")) {
        errors.push(`${relativePath}: required field '${field}' is empty`);
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

    // Stable and beta documents require an approver — reviewed_by is mandatory.
    // Draft and deprecated documents may omit reviewed_by.
    if ((parsed.status === "stable" || parsed.status === "beta") && !parsed.reviewed_by) {
      errors.push(
        `${relativePath}: '${parsed.status}' documents require 'reviewed_by' — ` +
        `add the approver's identifier before setting status to '${parsed.status}'`
      );
    }

    // owner must be a non-empty slug (lowercase letters, numbers, hyphens).
    // Free-form strings fragment analytics grouping — see schema/owners-registry.md.
    if (parsed.owner !== undefined && parsed.owner !== "") {
      if (!/^[a-z0-9][a-z0-9-]*$/.test(String(parsed.owner))) {
        errors.push(
          `${relativePath}: 'owner' must be a lowercase slug (e.g. 'payments-eng') — ` +
          `see schema/owners-registry.md for valid identifiers`
        );
      }
    }
  }

  if (errors.length > 0) {
    console.error("Frontmatter validation failed:\n");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(`Validated frontmatter for ${markdownFiles.length} Markdown files in ${checkedLabel}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});