import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const execFileAsync = promisify(execFile);
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");
const specsRoot = path.join(repoRoot, "examples", "openapi");
const defaultOutputRoot = path.join(repoRoot, "generated");
const allowedExtensions = new Set([".yaml", ".yml", ".json"]);

async function collectSpecFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSpecFiles(fullPath)));
      continue;
    }

    if (entry.isFile() && allowedExtensions.has(path.extname(entry.name).toLowerCase())) {
      files.push(fullPath);
    }
  }

  return files;
}

function toSlug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "generated-api";
}

async function parseSpecTitle(filePath) {
  const raw = await fs.readFile(filePath, "utf8");
  const parsed = path.extname(filePath).toLowerCase() === ".json" ? JSON.parse(raw) : yaml.load(raw);
  const title = typeof parsed?.info?.title === "string" ? parsed.info.title : path.basename(filePath, path.extname(filePath));
  return toSlug(title);
}

async function main() {
  const outputRoot = process.argv[2] ? path.resolve(repoRoot, process.argv[2]) : defaultOutputRoot;
  const files = await collectSpecFiles(specsRoot);

  if (files.length === 0) {
    console.log("No OpenAPI specs found.");
    return;
  }

  for (const filePath of files) {
    const slug = await parseSpecTitle(filePath);
    const relativeInput = path.relative(repoRoot, filePath).replace(/\\/g, "/");
    const relativeOutput = path.relative(repoRoot, path.join(outputRoot, slug)).replace(/\\/g, "/");

    await execFileAsync(
      process.execPath,
      [path.join(repoRoot, "scripts", "generate-openapi-docs.mjs"), relativeInput, relativeOutput],
      { cwd: repoRoot }
    );

    console.log(`Generated docs for ${relativeInput} -> ${relativeOutput}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});