import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPathsExist, displayPath, exitWithTargetError, parseTargets } from "./lib/cli-targets.mjs";
import { fencedBlocks, withoutFences } from "./lib/markdown-blocks.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const targetDirectories = ["examples", "generated"];

// Link targets that would run script once a renderer decodes entities and
// drops the whitespace browsers ignore: inline links, reference definitions
// and href attributes.
// The HTML tags in a piece of text, read the way a browser reads them: from
// "<" and a letter to the next ">" outside quotes. One pass, so a run of
// "<a <a <a" with no ">" cannot make every check rescan the rest of the page.
function htmlTags(text) {
  const tags = [];
  let index = text.indexOf("<");
  while (index !== -1 && index < text.length) {
    if (/[A-Za-z]/.test(text[index + 1] || "")) {
      let quote = null;
      let end = index + 1;
      for (; end < text.length; end += 1) {
        const character = text[end];
        if (quote) {
          if (character === quote) quote = null;
        } else if (character === '"' || character === "'") {
          quote = character;
        } else if (character === ">") {
          break;
        }
      }
      tags.push(text.slice(index, Math.min(end + 1, text.length)));
      index = text.indexOf("<", end + 1);
    } else {
      index = text.indexOf("<", index + 1);
    }
  }
  return tags;
}

function scriptLinks(prose) {
  const tags = htmlTags(prose);
  const attributeValues = (names) => tags.flatMap((tag) => [...tag.matchAll(new RegExp(`[\\s"'/](?:${names})\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^"'>\\s]+))`, "gi"))].map((match) => match[1] ?? match[2] ?? match[3]));
  const targets = [
    ...[...prose.matchAll(/\]\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)/g)].map((match) => match[1]),
    ...[...prose.matchAll(/^\s{0,3}\[[^\]]+\]:\s*(\S+)/gm)].map((match) => match[1]),
    // Attributes on real tags (a literal "<", not the escaped "&lt;").
    // A quoted value runs to its closing quote: browsers drop tabs and newlines inside it ("java\nscript:").
    ...attributeValues("href|src|action|formaction|xlink:href|data|poster|background|srcdoc|codebase|cite|longdesc|ping|manifest|icon"),
    // srcset lists several URLs separated by commas; each one counts.
    ...attributeValues("srcset").flatMap((value) => String(value).split(",").map((entry) => entry.trim().split(/\s+/)[0])),
    // Autolinks: <javascript:...>
    ...[...prose.matchAll(/<([a-z][a-z0-9+.-]*:[^>\s]*)>/gi)].map((match) => match[1])
  ];
  return targets.filter((target) => {
    const decoded = String(target)
      .replace(/&#x([0-9a-f]+);?/gi, (match, hex) => String.fromCodePoint(parseInt(hex, 16)))
      .replace(/&#(\d+);?/g, (match, decimal) => String.fromCodePoint(Number(decimal)))
      .replace(/&colon;/gi, ":")
      .replace(/&tab;|&newline;/gi, "")
      .replace(/[\u0000- \u007f]+/g, "")
      .toLowerCase();
    return /^(javascript|vbscript|data):/.test(decoded);
  });
}

// Markdown mistakes that change what renders: an unclosed code fence (the
// rest of the page becomes code), more than one H1, and table rows that do
// not match their header.
function markdownProblems(content) {
  const problems = [];
  const body = content.replace(/^---\n[\s\S]*?\n---\n/, "");
  const lines = body.split(/\r?\n/);
  let openFence = null;
  let openLine = 0;
  let h1Count = 0;
  let table = null;
  lines.forEach((line, index) => {
    const fence = line.match(/^(`{3,}|~{3,})/);
    if (openFence) {
      if (fence && fence[1][0] === openFence[0] && fence[1].length >= openFence.length && /^(`{3,}|~{3,})\s*$/.test(line)) {
        openFence = null;
      } else if (fence && fence[1][0] === openFence[0] && fence[1].length >= openFence.length && /^(`{3,}|~{3,})[A-Za-z]/.test(line)) {
        // "```json" inside an open block is text, so the block above was
        // probably never closed and everything since renders as code.
        problems.push(`line ${index + 1} opens a code block inside the one opened on line ${openLine}; that block is probably missing its closing fence`);
      }
      return;
    }
    if (fence) {
      openFence = fence[1];
      openLine = index + 1;
      table = null;
      return;
    }
    if (/^#\s/.test(line) || (/^=+\s*$/.test(line) && index > 0 && /\S/.test(lines[index - 1]) && !/^\s*\|/.test(lines[index - 1]))) {
      h1Count += 1; // ATX "# Title" or setext "Title" underlined with ===
    }
    if (/^#{1,6}[A-Za-z]/.test(line)) {
      problems.push(`line ${index + 1} ("${line.slice(0, 30)}") needs a space after the #, or it renders as text`);
    }
    if (/^ {4,}#{1,6}\s/.test(line) && (index === 0 || !/\S/.test(lines[index - 1]))) {
      problems.push(`line ${index + 1} is a heading indented four spaces, which renders as a code block`);
    }
    if (!/^\s*\|.*\|\s*$/.test(line)) {
      table = null;
      return;
    }
    const cells = line.trim().replace(/^\||\|$/g, "").split(/(?<!\\)\|/).length;
    if (!table) {
      table = { cells, header: line.trim(), checkedSeparator: false };
      return;
    }
    if (!table.checkedSeparator) {
      table.checkedSeparator = true;
      if (!/^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line)) {
        problems.push(`the table starting "${table.header.slice(0, 40)}" has no separator row (| --- |) under its header, so it renders as plain text`);
        table.broken = true;
      } else if (cells !== table.cells) {
        problems.push(`the table starting "${table.header.slice(0, 40)}" has ${table.cells} header cells but ${cells} in its separator row, so it renders as plain text`);
        table.broken = true;
      }
      return;
    }
    if (!table.broken && cells !== table.cells) {
      problems.push(`table row ${index + 1} has ${cells} cells but its header has ${table.cells}; an unescaped "|" or a missing cell breaks the row`);
    }
  });
  if (openFence) {
    problems.push(`the code fence opened on line ${openLine} is never closed, so the rest of the page renders as code`);
  }
  // An HTML comment left open hides everything after it.
  const outsideCode = withoutFences(body).replace(/`+[^`\n]*?`+/g, "");
  const lastOpen = outsideCode.lastIndexOf("<!--");
  if (lastOpen !== -1 && outsideCode.indexOf("-->", lastOpen) === -1) {
    problems.push(`an HTML comment (<!--) is never closed, so the rest of the page does not render`);
  }
  if (h1Count > 1) {
    problems.push(`has ${h1Count} H1 headings; a page should have one`);
  }
  return problems;
}

const placeholderPatterns = [
  /\{endpoint-name\}/g,
  /\{feature-name\}/g,
  /GET\|POST\|PUT\|PATCH\|DELETE/g,
  /Replace with actual [^.\n]+/g,
  /\bTODO\b/g,
  /\bFIXME\b/g,
  /\blorem ipsum\b/gi
];

// Checked only in prose: in a code block, {{name}} is template syntax and
// <insert> may be a real tag in an example.
const prosePlaceholderPatterns = [
  /<insert[^>]*>/i,
  /<your[-_ ][^>\n]{1,40}>/i,
  /\{\{[^}]*\}\}/,
  /\binsert (?:a |an |the |your )?(?:description|text|content|value|example|details?|summary|name)(?: here)?\b/i,
  // TBD in prose only: in code it can be a real value, such as an enum member.
  /\bTBD\b/i,
  /\bT\.B\.D\b/i,
  /\bto be determined\b/i,
  /\bfill (?:me in|(?:this )?in later)\b/i,
  /\b(?:description|text|content|details|summary) goes here\b/i,
  /\?\?[^?\n]{1,40}\?\?/,
  // "Coming soon." on its own line, standing in for content.
  /^\s*coming soon\.?\s*$/im
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
      // Several templates may share a component; keep them all and match by overlap.
      headingsByComponent.set(component, [...(headingsByComponent.get(component) || []), text.split(/\r?\n/).filter((line) => /^## /.test(line)).map((line) => line.slice(3).trim())]);
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
  let ownersUnchecked = false;

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

    // Prose: the text outside frontmatter, fenced code blocks (any fence
    // length) and code spans, which are shown as text.
    const prose = withoutFences(content.replace(/^---\n[\s\S]*?\n---\n/, ""))
      .replace(/`+[^`\n]*?`+/g, "");

    // Placeholders a person leaves while drafting, in prose.
    // ("XXX" is not one: it is an ISO currency code and a common format mask.)
    for (const [pattern, label] of [[/\[(?:PLACEHOLDER|TBD|TODO|INSERT[^\]]*)\]/i, null], [/\btodo:/i, null], ...prosePlaceholderPatterns.map((pattern) => [pattern, null])]) {
      const found = prose.match(pattern);
      if (found) {
        errors.push(`${relativePath}: unresolved placeholder content detected (${label || found[0]})`);
      }
    }

    // Section structure. A short page may have none; it is worth a look, not a failure.
    if (!content.includes("## ")) {
      warnings.push(`${relativePath}: no ## section headings`);
    }
    // The page title: Docusaurus can fall back on the frontmatter title, other renderers cannot.
    const titleBody = withoutFences(content.replace(/^---\n[\s\S]*?\n---\n/, ""));
    if (!/^ {0,3}# \S/m.test(titleBody) && !/^[^\n#>|-][^\n]*\n {0,3}=+\s*$/m.test(titleBody)) {
      warnings.push(`${relativePath}: no # title heading`);
    }

    // Markdown that renders differently from how it reads.
    markdownProblems(content).forEach((problem) => errors.push(`${relativePath}: ${problem}`));

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

      // Required section headings (prefix match). The Response section is
      // needed to compare the doc with the spec; the others are warnings.
      for (const { prefix, label } of requiredEndpointSectionPrefixes) {
        const found = lines.some((line) => line.startsWith(prefix));
        if (!found) {
          (label === "Response" ? errors : warnings).push(
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
      // With --specs, the OpenAPI check compares statuses with the spec, so the heuristic stays quiet.
      for (const rule of generated || targets.specPaths?.length > 0 ? [] : suspiciousStatusRules) {
        if (rule.methodPattern.test(content) && rule.statusPattern.test(content)) {
          warnings.push(`${relativePath}: ${rule.message}`);
        }
      }
    }

    // Owner not in the docs repository's owners registry.
    const owner = content.match(/^owner:\s*"?([^"\n]+?)"?\s*$/m)?.[1];
    if (targets.userMode && owner && owner !== "unassigned") {
      const registry = (await ownersRegistryFor(filePath)) || (await ownersRegistryFor(path.join(targets.baseDirectory, "index.md")));
      if (!registry) {
        ownersUnchecked = true;
      }
      if (registry && registry.owners.size > 0 && !registry.owners.has(owner)) {
        warnings.push(`${relativePath}: owner '${owner}' is not listed in ${displayPath(registry.path, displayRoot)}`);
      }
    }

    // HTML that runs script, loads content or redirects on a docs site that
    // renders raw HTML. Code blocks and code spans are left out.
    const tags = htmlTags(prose);
    const anyTag = (pattern) => tags.some((tag) => pattern.test(tag));
    const unsafeHtml = [
      // The tag names are also matched anywhere in the text, so a split such
      // as "<scr<script>ipt>" is caught however a renderer reads it.
      [/<script\b/i.test(prose), "<script>"],
      [/<iframe\b/i.test(prose), "<iframe>"],
      [/<(?:object|embed)\b|<\/object>/i.test(prose), "<object> or <embed>"],
      [/<(?:applet|portal|frame|frameset)\b/i.test(prose), "<applet>, <portal> or <frame>"],
      [anyTag(/^<meta\b[\s\S]*http-equiv/i), "<meta http-equiv>"],
      [/<form[\s>/]/i.test(prose), "<form>"],
      [/<style[\s>/]/i.test(prose) || anyTag(/^<link\b[\s\S]*\brel\s*=/i), "<style> or <link>"],
      [/<base[\s>/]/i.test(prose), "<base>"],
      [anyTag(/[\s/"']on[a-z]+\s*=/i), "an inline event handler (on...=)"],
      [anyTag(/\sstyle\s*=\s*["'][^"']*url\s*\(/i), "a style attribute that loads a URL"]
    ].filter(([found]) => found).map(([, label]) => label);
    // An image from another site loads when the page is viewed (a tracking pixel).
    if (anyTag(/^<img\b[\s\S]*?[\s"'/]src\s*=\s*["']?(?:https?:)?\/\//i)) {
      warnings.push(`${relativePath}: an <img> loads from another site when the page is viewed; host images with the docs`);
    }
    // A Markdown image loads from another site just the same.
    if (/!\[[^\]]*\]\(\s*<?(?:https?:)?\/\//i.test(prose)) {
      warnings.push(`${relativePath}: a Markdown image loads from another site when the page is viewed; host images with the docs`);
    }
    // A block-level HTML element left open swallows the Markdown after it.
    for (const tag of ["div", "details", "table", "section", "aside", "blockquote"]) {
      const opened = tags.filter((candidate) => new RegExp(`^<${tag}(?:[\\s/>]|$)`, "i").test(candidate)).length;
      const closed = (prose.match(new RegExp(`</${tag}\\s*>`, "gi")) || []).length;
      if (opened > closed) {
        errors.push(`${relativePath}: a <${tag}> is opened ${opened} time${opened === 1 ? "" : "s"} but closed ${closed} time${closed === 1 ? "" : "s"}, so the Markdown after it may not render`);
      }
    }
    if (scriptLinks(prose).length > 0) {
      unsafeHtml.push("a javascript:, vbscript: or data: link");
    }
    // Frontmatter values end up in page titles, meta tags and links (a
    // theme may render migration_guide as one), so they carry no HTML or script URLs.
    const frontmatterText = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] || "";
    if (/<\s*(?:script|iframe|object|embed|svg|img|a)\b|<[a-z][^>]*\son[a-z]+\s*=|(?:^|[\s"':])(?:javascript|vbscript)\s*:|\bdata:[a-z]+\/[a-z0-9.+-]+/im.test(frontmatterText.replace(/^[a-z_]+:/gim, ""))) {
      unsafeHtml.push("HTML or a script URL in the frontmatter");
    }
    if (unsafeHtml.length > 0) {
      errors.push(`${relativePath}: unsafe HTML that would run script on a docs site: ${[...new Set(unsafeHtml)].join(", ")}`);
    }

    // A {name} placeholder in the example URL: the spec gave no example value.
    // <name> (or %3Cname%3E once encoded) counts too; <api-key> and <token> are credential placeholders the reader fills in.
    const curlUrl = content.match(/curl\b[^\n"]*"(https?:\/\/[^"]+)"/)?.[1] || "";
    const decodedUrl = curlUrl.replace(/%3C/gi, "<").replace(/%3E/gi, ">");
    const urlPlaceholders = [
      ...[...curlUrl.matchAll(/\{([^}]+)\}/g)].map((match) => match[1]),
      ...[...decodedUrl.matchAll(/<([A-Za-z][A-Za-z0-9_.-]*)>/g)].map((match) => match[1]).filter((name) => !/^(api-key|token|access-token|key)$/i.test(name))
    ];
    if (urlPlaceholders.length > 0) {
      warnings.push(`${relativePath}: the request example URL still has placeholder(s) ${urlPlaceholders.map((name) => `{${name}}`).join(", ")}. Add examples to the spec or edit the doc before publication`);
    }

    // Hand-written docs: the sections of the template for this component are all present.
    const component = content.match(/^component:\s*"?([^"\n]+?)"?\s*$/m)?.[1];
    const docHeadings = new Set(content.split(/\r?\n/).filter((line) => /^## /.test(line)).map((line) => line.slice(3).trim()));
    const templateHeadings = (templateText.headingsByComponent?.get(component) || [])
      .map((candidate) => ({ candidate, overlap: candidate.filter((heading) => docHeadings.has(heading)).length }))
      .sort((left, right) => right.overlap - left.overlap)[0]?.candidate;
    if (templateHeadings && !/^description:\s*"Generated /m.test(content)) {
      const headings = docHeadings;
      const missing = templateHeadings.filter((heading) => !headings.has(heading));
      // Only a doc that follows the template for at least half its sections
      // was written from it; any other doc with the same component is a
      // different kind of page.
      const followed = templateHeadings.length - missing.length;
      // At least a third of the template's sections, and two or more.
      if (missing.length > 0 && followed >= Math.max(2, Math.ceil(templateHeadings.length / 3))) {
        warnings.push(`${relativePath}: missing section(s) from the ${component} template: ${missing.join(", ")}`);
      }
    }

    // Generated frontmatter default: nobody owns this doc yet.
    if (/^owner:\s*"?unassigned"?\s*$/m.test(content)) {
      warnings.push(`${relativePath}: owner is 'unassigned'. Set it with --owner when generating, or edit the frontmatter`);
    }

    // Generated placeholder values: the spec gave no example for these fields.
    // Only in code blocks: a JSON example with "value" in it, not prose.
    const codeOnly = fencedBlocks(content).map((block) => block.body).join("\n");
    const placeholderValueCount = (codeOnly.match(/":\s*"value"/g) || []).length;
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

  if (ownersUnchecked) {
    warnings.push("owners were not checked: no schema/owners-registry.md was found above the docs. Add one to check owner names");
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

  const checksRun = "placeholders, leftover template text, required sections, examples, suspicious status codes, SME labels, placeholder example values, owners, unsafe HTML, broken Markdown";
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
