import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const targetDirectories = ["examples", "generated"];
const placeholderPatterns = [
  /\{endpoint-name\}/g,
  /\{feature-name\}/g,
  /GET\|POST\|PUT\|PATCH\|DELETE/g,
  /Replace with actual [^.\n]+/g
];

async function directoryExists(directory) {
  try {
    await fs.access(directory);
    return true;
  } catch {
    return false;
  }
}

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

async function main() {
  const markdownFiles = [];

  for (const relativeDirectory of targetDirectories) {
    const directory = path.join(repoRoot, relativeDirectory);
    if (await directoryExists(directory)) {
      markdownFiles.push(...(await collectMarkdownFiles(directory)));
    }
  }

  const errors = [];

  for (const filePath of markdownFiles) {
    const content = await fs.readFile(filePath, "utf8");
    const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, "/");

    for (const pattern of placeholderPatterns) {
      const matches = content.match(pattern);
      if (matches && matches.length > 0) {
        errors.push(`${relativePath}: unresolved placeholder content detected (${matches[0]})`);
      }
    }

    if (!content.includes("## ")) {
      errors.push(`${relativePath}: expected structured section headings`);
    }
  }

  if (errors.length > 0) {
    console.error("Documentation quality validation failed:\n");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
    process.exit(1);
  }

  console.log(`Validated documentation quality for ${markdownFiles.length} Markdown files.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});