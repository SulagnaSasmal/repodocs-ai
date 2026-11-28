import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPathsExist, displayPath, exitWithTargetError, parseTargets } from "./lib/cli-targets.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const targetDirectories = ["examples", "generated"];

const placeholderPatterns = [
  /\{endpoint-name\}/g,
  /\{feature-name\}/g,
  /GET\|POST\|PUT\|PATCH\|DELETE/g,
  /Replace with actual [^.\n]+/g,
  /\bTODO\b/g,
  /\bTBD\b/g,
  /\bFIXME\b/g,
  /<insert[^>]*>/gi,
  /\{\{[^}]*\}\}/g,
  /\blorem ipsum\b/gi
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

// Instruction lines from the shipped templates, such as "Summarize the feature
// in plain language." A doc that still contains one was not finished.
async function loadTemplateText() {
  const templateFiles = await directoryExists(path.join(repoRoot, "templates"))
    ? await collectMarkdownFiles(path.join(repoRoot, "templates"))
    : [];
  const instructionLines = new Set();
  const descriptions = new Set();
  const headingsByComponent = new Map();
  for (const file of templateFiles) {
    const text = await fs.readFile(file, "utf8");
    const frontmatter = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    const description = frontmatter?.[1].match(/^description:\s*"?(.+?)"?\s*$/m)?.[1];
    const component = frontmatter?.[1].match(/^component:\s*"?([^"\n]+?)"?\s*$/m)?.[1];
    if (component && component !== "endpoint" && component !== "api") {
      // A component two templates share says nothing about which one a doc used.
      headingsByComponent.set(component, headingsByComponent.has(component) ? null : text.split(/\r?\n/).filter((line) => /^## /.test(line)).map((line) => line.slice(3).trim()));
    }
    if (description) {
      descriptions.add(description.trim());
    }
    const body = frontmatter ? text.slice(frontmatter[0].length) : text;
    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.length >= 25 && /^[A-Z]/.test(trimmed) && !/^[#|>`-]/.test(trimmed) && !trimmed.includes("{")) {
        instructionLines.add(trimmed);
      }
    }
  }
  return { instructionLines, descriptions, headingsByComponent };
}

// The owners listed in the nearest schema/owners-registry.md above a doc.
const registryCache = new Map();
async function ownersRegistryFor(filePath) {
  let directory = path.dirname(filePath);
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(directory, "schema", "owners-registry.md");
    if (registryCache.has(candidate)) {
      return registryCache.get(candidate);
    }
    try {
      const text = await fs.readFile(candidate, "utf8");
      const owners = new Set([...text.matchAll(/^\|\s*`([a-z0-9][a-z0-9-]*)`\s*\|/gm)].map((match) => match[1]));
      const registry = { path: candidate, owners };
      registryCache.set(candidate, registry);
      return registry;
    } catch {
      const parent = path.dirname(directory);
      if (parent === directory) {
        return null;
      }
      directory = parent;
    }
  }
  return null;
}

async function main() {
  const markdownFiles = [];
  let targets;
  try {
    targets = parseTargets();
    await assertPathsExist(targets.docPaths, "Docs path");
  } catch (error) {
    exitWithTargetError(error);
  }

  // With path arguments, validate exactly those paths. Without arguments,
  // validate this repository's own examples/ and generated/ folders.
  const directoriesToCheck = targets.userMode
    ? targets.docPaths
    : targetDirectories.map((relativeDirectory) => path.join(repoRoot, relativeDirectory));

  for (const directory of directoriesToCheck) {
    if (!(await directoryExists(directory))) {
      continue;
    }

    const stats = await fs.stat(directory);
    if (stats.isFile()) {
      if (directory.endsWith(".md")) {
        markdownFiles.push(directory);
      }
      continue;
    }

    markdownFiles.push(...(await collectMarkdownFiles(directory)));
  }

  const displayRoot = targets.userMode ? targets.baseDirectory : repoRoot;
  const checkedLabel = directoriesToCheck.map((directory) => displayPath(directory, displayRoot)).join(", ");

  if (markdownFiles.length === 0) {
    console.error(`No Markdown files found in ${checkedLabel}. Nothing was checked, so no result is reported.`);
    process.exitCode = 1;
    return;
  }

  const errors = [];
  const warnings = [];

  const templateText = targets.userMode ? await loadTemplateText() : { instructionLines: new Set(), descriptions: new Set(), headingsByComponent: new Map() };

  for (const filePath of markdownFiles) {
    const content = await fs.readFile(filePath, "utf8");
    const relativePath = displayPath(filePath, displayRoot);
    const lines = extractLines(content);

    // Unfinished template text: the instructions are still in the doc.
    const leftover = content.split(/\r?\n/).map((line) => line.trim()).filter((line) => templateText.instructionLines.has(line));
    if (leftover.length > 0) {
      errors.push(`${relativePath}: ${leftover.length} line(s) of template instructions left in, for example "${leftover[0]}"`);
    }
    const docDescription = content.match(/^---\r?\n[\s\S]*?^description:\s*"?(.+?)"?\s*$/m)?.[1]?.trim();
    if (docDescription && templateText.descriptions.has(docDescription)) {
      errors.push(`${relativePath}: the description is still the template's ("${docDescription}")`);
    }

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
      // Generated docs take their statuses from the spec, which the OpenAPI
      // check compares; this heuristic is for hand-written docs.
      const generated = /^description:\s*"Generated endpoint documentation for /m.test(content);
      for (const rule of generated ? [] : suspiciousStatusRules) {
        if (rule.methodPattern.test(content) && rule.statusPattern.test(content)) {
          warnings.push(`${relativePath}: ${rule.message}`);
        }
      }
    }

    // Owner not in the docs repository's owners registry.
    const owner = content.match(/^owner:\s*"?([^"\n]+?)"?\s*$/m)?.[1];
    if (targets.userMode && owner && owner !== "unassigned") {
      const registry = (await ownersRegistryFor(filePath)) || (await ownersRegistryFor(path.join(targets.baseDirectory, "index.md")));
      if (registry && registry.owners.size > 0 && !registry.owners.has(owner)) {
        warnings.push(`${relativePath}: owner '${owner}' is not listed in ${displayPath(registry.path, displayRoot)}`);
      }
    }

    // HTML that runs script on a docs site that renders raw HTML. Code blocks
    // and code spans are left out, since they are shown as text.
    const prose = content
      .replace(/^---\n[\s\S]*?\n---\n/, "")
      .replace(/^```[^\n]*\n[\s\S]*?^```[ \t]*$/gm, "")
      .replace(/`+[^`\n]*?`+/g, "");
    const unsafeHtml = [
      [/<script\b/i, "<script>"],
      [/<iframe\b/i, "<iframe>"],
      [/<[a-z][^>\n]*\son[a-z]+\s*=/i, "an inline event handler (on...=)"],
      [/\]\(\s*(?:javascript|vbscript|data):/i, "a javascript:, vbscript: or data: link"],
      [/<a\b[^>\n]*href\s*=\s*["']?\s*(?:javascript|vbscript|data):/i, "a javascript:, vbscript: or data: link"]
    ].filter(([pattern]) => pattern.test(prose)).map(([, label]) => label);
    if (unsafeHtml.length > 0) {
      errors.push(`${relativePath}: unsafe HTML that would run script on a docs site: ${[...new Set(unsafeHtml)].join(", ")}`);
    }

    // A {name} placeholder in the example URL: the spec gave no example value.
    const curlUrl = content.match(/curl -X \w+ "([^"]+)"/)?.[1] || "";
    const urlPlaceholders = [...curlUrl.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]);
    if (urlPlaceholders.length > 0) {
      warnings.push(`${relativePath}: the request example URL still has placeholder(s) ${urlPlaceholders.map((name) => `{${name}}`).join(", ")}. Add examples to the spec or edit the doc before publication`);
    }

    // Hand-written docs: the sections of the template for this component are all present.
    const component = content.match(/^component:\s*"?([^"\n]+?)"?\s*$/m)?.[1];
    const templateHeadings = templateText.headingsByComponent?.get(component);
    if (templateHeadings && !/^description:\s*"Generated /m.test(content)) {
      const headings = new Set(content.split(/\r?\n/).filter((line) => /^## /.test(line)).map((line) => line.slice(3).trim()));
      const missing = templateHeadings.filter((heading) => !headings.has(heading));
      // Only a doc that follows the template for at least half its sections
      // was written from it; any other doc with the same component is a
      // different kind of page.
      const followed = templateHeadings.length - missing.length;
      if (missing.length > 0 && followed >= Math.ceil(templateHeadings.length / 2)) {
        warnings.push(`${relativePath}: missing section(s) from the ${component} template: ${missing.join(", ")}`);
      }
    }

    // Generated frontmatter default: nobody owns this doc yet.
    if (/^owner:\s*"?unassigned"?\s*$/m.test(content)) {
      warnings.push(`${relativePath}: owner is 'unassigned'. Set it with --owner when generating, or edit the frontmatter`);
    }

    // Generated placeholder values: the spec gave no example for these fields.
    const placeholderValueCount = (content.match(/":\s*"value"/g) || []).length;
    if (placeholderValueCount > 0) {
      warnings.push(
        `${relativePath}: ${placeholderValueCount} example value(s) are the placeholder "value". Add examples to the spec or edit the doc before publication`
      );
    }

    // Needs SME input tracking (warning — must be zero before publication)
    const smeCount = (content.match(/Needs SME input/g) || []).length;
    if (smeCount > 0) {
      warnings.push(
        `${relativePath}: ${smeCount} 'Needs SME input' label(s) — resolve before publication`
      );
    }
  }

  // One write per stream, then let Node exit on its own, so no line is lost
  // when the output is a pipe.
  if (errors.length > 0) {
    let report = "";
    if (errors.length > 0) {
      report += `Documentation quality validation failed:\n\n${errors.map((error) => `- ${error}`).join("\n")}\n`;
    }
    if (warnings.length > 0) {
      report += `\nDocumentation quality warnings:\n\n${warnings.map((warning) => `- ${warning}`).join("\n")}\n`;
    }
    process.stderr.write(report);
    process.exitCode = 1;
    return;
  }

  if (warnings.length > 0) {
    process.stderr.write(`\nDocumentation quality warnings:\n\n${warnings.map((warning) => `- ${warning}`).join("\n")}\n`);
  }

  const checksRun = "placeholders, leftover template text, required sections, examples, suspicious status codes, SME labels, placeholder example values, owners";
  if (warnings.length > 0) {
    console.log(
      `\nStructure checks passed for ${markdownFiles.length} Markdown files in ${checkedLabel} (${checksRun}), ` +
      `with ${warnings.length} warning(s) to resolve before publishing. Accuracy against the OpenAPI spec is checked separately.`
    );
  } else {
    console.log(
      `Structure checks passed for ${markdownFiles.length} Markdown files in ${checkedLabel} (${checksRun}). ` +
      `Accuracy against the OpenAPI spec is checked separately.`
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
