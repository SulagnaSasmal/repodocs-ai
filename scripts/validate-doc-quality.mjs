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

const validHttpMethods = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]);

// Required sections for endpoint docs — use prefix matching to allow naming variants.
// "## Authentication" catches both "## Authentication" and "## Authentication Requirements".
// "## Response" catches "## Response Schema", "## Response Example", etc.
// "## Error" catches "## Error Codes", "## Error Responses", "## Error Handling".
const requiredEndpointSectionPrefixes = [
  { prefix: "## Authentication", label: "Authentication" },
  { prefix: "## Response", label: "Response" },
  { prefix: "## Error", label: "Error Codes / Error Responses" }
];

// Suspicious status code combinations — logged as warnings, not errors.
const suspiciousStatusRules = [
  {
    methodPattern: /- Method: `POST`/,
    statusPattern: /`200`/,
    message: "POST returning 200 — expected 201 for resource creation. Verify this is intentional."
  },
  {
    methodPattern: /- Method: `GET`/,
    statusPattern: /`201`/,
    message: "GET returning 201 — unexpected for a read operation."
  },
  {
    methodPattern: /- Method: `DELETE`/,
    statusPattern: /`201`/,
    message: "DELETE returning 201 — unexpected for a delete operation."
  }
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

function extractLines(content) {
  return content.split("\n");
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
  const warnings = [];

  for (const filePath of markdownFiles) {
    const content = await fs.readFile(filePath, "utf8");
    const relativePath = path.relative(repoRoot, filePath).replace(/\\/g, "/");
    const lines = extractLines(content);

    // Placeholder patterns
    for (const pattern of placeholderPatterns) {
      const matches = content.match(pattern);
      if (matches && matches.length > 0) {
        errors.push(`${relativePath}: unresolved placeholder content detected (${matches[0]})`);
      }
    }

    // Section structure
    if (!content.includes("## ")) {
      errors.push(`${relativePath}: expected structured section headings`);
    }

    // Endpoint-specific checks — only run when the doc identifies an HTTP method
    const isEndpointDoc = /- Method: `[A-Z]+`/.test(content);

    if (isEndpointDoc) {
      // HTTP method validity
      const methodMatch = content.match(/- Method: `([^`]+)`/);
      if (methodMatch && !validHttpMethods.has(methodMatch[1])) {
        errors.push(
          `${relativePath}: invalid HTTP method '${methodMatch[1]}' — ` +
          `expected one of ${[...validHttpMethods].join(", ")}`
        );
      }

      // Required section headings (prefix match)
      for (const { prefix, label } of requiredEndpointSectionPrefixes) {
        const found = lines.some((line) => line.startsWith(prefix));
        if (!found) {
          errors.push(
            `${relativePath}: missing required section '${label}' ` +
            `(expected a heading starting with '${prefix}')`
          );
        }
      }

      // Example section — accepts multiple naming conventions
      const hasExample = lines.some(
        (line) =>
          line.startsWith("## Code Example") ||
          line.startsWith("## Example") ||
          line.startsWith("## Request Example") ||
          line.startsWith("## Examples")
      );
      if (!hasExample) {
        errors.push(
          `${relativePath}: missing required section 'Code Example' ` +
          `(expected '## Code Example', '## Example', or '## Request Example')`
        );
      }

      // Suspicious status code warnings
      for (const rule of suspiciousStatusRules) {
        if (rule.methodPattern.test(content) && rule.statusPattern.test(content)) {
          warnings.push(`${relativePath}: ${rule.message}`);
        }
      }
    }

    // Needs SME input tracking (warning — must be zero before publication)
    const smeCount = (content.match(/Needs SME input/g) || []).length;
    if (smeCount > 0) {
      warnings.push(
        `${relativePath}: ${smeCount} 'Needs SME input' label(s) — resolve before publication`
      );
    }
  }

  if (errors.length > 0) {
    console.error("Documentation quality validation failed:\n");
    for (const error of errors) {
      console.error(`- ${error}`);
    }
  }

  if (warnings.length > 0) {
    console.warn("\nDocumentation quality warnings:\n");
    for (const warning of warnings) {
      console.warn(`- ${warning}`);
    }
  }

  if (errors.length > 0) {
    process.exit(1);
  }

  if (warnings.length > 0) {
    console.log(
      `\nQuality check: ${markdownFiles.length} files — MERGE-SAFE (0 errors), ` +
      `NOT PUBLICATION-READY (${warnings.length} warning(s) above must be resolved before publishing).`
    );
  } else {
    console.log(
      `Validated documentation quality for ${markdownFiles.length} Markdown files. ` +
      `MERGE-SAFE and PUBLICATION-READY.`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
