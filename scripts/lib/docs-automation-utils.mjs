import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const repoRoot = path.resolve(__dirname, "..", "..");

export async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDirectory(directory) {
  await fs.mkdir(directory, { recursive: true });
}

export async function collectFiles(directory, extensions = null) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectFiles(fullPath, extensions)));
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (extensions && !extensions.has(path.extname(entry.name).toLowerCase())) {
      continue;
    }

    files.push(fullPath);
  }

  return files;
}

export function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  return value.trim();
}

export function extractFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) {
    return { frontmatter: null, body: content };
  }

  return {
    frontmatter: yaml.load(match[1]) || null,
    body: content.slice(match[0].length)
  };
}

export async function loadMarkdownDocuments(relativeDirectories) {
  const documents = [];

  for (const relativeDirectory of relativeDirectories) {
    const directory = path.join(repoRoot, relativeDirectory);
    if (!(await pathExists(directory))) {
      continue;
    }

    const files = await collectFiles(directory, new Set([".md"]));
    for (const filePath of files) {
      const content = await fs.readFile(filePath, "utf8");
      const { frontmatter, body } = extractFrontmatter(content);
      documents.push({
        filePath,
        relativePath: path.relative(repoRoot, filePath).replace(/\\/g, "/"),
        content,
        frontmatter,
        body
      });
    }
  }

  return documents;
}

export function slugify(value) {
  return String(value || "item")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "item";
}

export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;");
}

function renderInline(value) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

function renderTable(lines) {
  const rows = lines.map((line) => line.split("|").slice(1, -1).map((cell) => renderInline(cell.trim())));
  const [header, , ...body] = rows;

  return [
    "<table>",
    "<thead>",
    `<tr>${header.map((cell) => `<th>${cell}</th>`).join("")}</tr>`,
    "</thead>",
    "<tbody>",
    ...body.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`),
    "</tbody>",
    "</table>"
  ].join("\n");
}

export function renderMarkdownToHtml(markdown) {
  const lines = markdown.replace(/\r/g, "").split("\n");
  const html = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (!line.trim()) {
      continue;
    }

    const codeFence = line.match(/^```(.*)$/);
    if (codeFence) {
      const language = codeFence[1].trim();
      const buffer = [];
      index += 1;
      while (index < lines.length && !lines[index].startsWith("```")) {
        buffer.push(lines[index]);
        index += 1;
      }
      const className = language ? ` class="language-${escapeHtml(language)}"` : "";
      html.push(`<pre><code${className}>${escapeHtml(buffer.join("\n"))}</code></pre>`);
      continue;
    }

    const heading = line.match(/^(#{1,6})\s+(.*)$/);
    if (heading) {
      const level = heading[1].length;
      html.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
      continue;
    }

    if (line.startsWith("|") && index + 1 < lines.length && /^\|(?:\s*---\s*\|)+\s*$/.test(lines[index + 1])) {
      const tableLines = [line, lines[index + 1]];
      index += 2;
      while (index < lines.length && lines[index].startsWith("|")) {
        tableLines.push(lines[index]);
        index += 1;
      }
      index -= 1;
      html.push(renderTable(tableLines));
      continue;
    }

    const listMatch = line.match(/^(-|\d+\.)\s+(.*)$/);
    if (listMatch) {
      const ordered = /\d+\./.test(listMatch[1]);
      const tag = ordered ? "ol" : "ul";
      const items = [renderInline(listMatch[2])];
      while (index + 1 < lines.length) {
        const nextLine = lines[index + 1];
        const nextMatch = nextLine.match(/^(-|\d+\.)\s+(.*)$/);
        if (!nextMatch) {
          break;
        }
        items.push(renderInline(nextMatch[2]));
        index += 1;
      }
      html.push(`<${tag}>${items.map((item) => `<li>${item}</li>`).join("")}</${tag}>`);
      continue;
    }

    const paragraph = [line.trim()];
    while (index + 1 < lines.length) {
      const nextLine = lines[index + 1];
      if (
        !nextLine.trim() ||
        nextLine.startsWith("#") ||
        nextLine.startsWith("|") ||
        nextLine.startsWith("```") ||
        /^(-|\d+\.)\s+/.test(nextLine)
      ) {
        break;
      }
      paragraph.push(nextLine.trim());
      index += 1;
    }
    html.push(`<p>${renderInline(paragraph.join(" "))}</p>`);
  }

  return html.join("\n");
}

export function markdownToPlainText(markdown) {
  return markdown
    .replace(/```[\s\S]*?```/g, (block) => block.replace(/```/g, ""))
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\|/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1 ($2)")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function wrapText(text, width = 92) {
  const paragraphs = text.split(/\n\n+/);
  const lines = [];

  for (const paragraph of paragraphs) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }

    let current = "";
    for (const word of words) {
      if (!current) {
        current = word;
        continue;
      }

      if (`${current} ${word}`.length > width) {
        lines.push(current);
        current = word;
      } else {
        current = `${current} ${word}`;
      }
    }

    if (current) {
      lines.push(current);
    }

    lines.push("");
  }

  while (lines.length > 0 && !lines[lines.length - 1]) {
    lines.pop();
  }

  return lines;
}

function escapePdfText(value) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

export function buildPdfBuffer(title, text) {
  const contentLines = wrapText(`${title}\n\n${text}`);
  const linesPerPage = 48;
  const objects = [];
  let nextId = 1;

  function addObject(content, explicitId = null) {
    const id = explicitId ?? nextId;
    nextId = Math.max(nextId, id + 1);
    objects.push({ id, content });
    return id;
  }

  const fontId = addObject("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  const pagesId = nextId;
  nextId += 1;
  const pageIds = [];

  for (let index = 0; index < contentLines.length || index === 0; index += linesPerPage) {
    const pageLines = contentLines.slice(index, index + linesPerPage);
    const streamLines = ["BT", "/F1 11 Tf", "14 TL", "54 738 Td"];

    pageLines.forEach((line, lineIndex) => {
      if (lineIndex > 0) {
        streamLines.push("0 -14 Td");
      }
      streamLines.push(`(${escapePdfText(line)}) Tj`);
    });

    streamLines.push("ET");
    const stream = streamLines.join("\n");
    const contentId = addObject(`<< /Length ${Buffer.byteLength(stream, "utf8")} >>\nstream\n${stream}\nendstream`);
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 612 792] /Contents ${contentId} 0 R /Resources << /Font << /F1 ${fontId} 0 R >> >> >>`);
    pageIds.push(pageId);
  }

  addObject(`<< /Type /Pages /Count ${pageIds.length} /Kids [${pageIds.map((pageId) => `${pageId} 0 R`).join(" ")}] >>`, pagesId);
  const catalogId = addObject(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
  objects.sort((left, right) => left.id - right.id);

  let pdf = "%PDF-1.4\n";
  const offsets = [0];

  for (const object of objects) {
    offsets[object.id] = Buffer.byteLength(pdf, "utf8");
    pdf += `${object.id} 0 obj\n${object.content}\nendobj\n`;
  }

  const xrefOffset = Buffer.byteLength(pdf, "utf8");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const object of objects) {
    pdf += `${String(offsets[object.id]).padStart(10, "0")} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, "utf8");
}

export function buildHtmlDocument({ title, description, metadataHtml = "", bodyHtml }) {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <style>
      :root {
        color-scheme: light;
        font-family: "Segoe UI", Helvetica, Arial, sans-serif;
      }
      body {
        margin: 0;
        background: #f5f1ea;
        color: #1d1a16;
      }
      main {
        max-width: 920px;
        margin: 0 auto;
        padding: 48px 24px 72px;
      }
      header {
        margin-bottom: 32px;
      }
      h1, h2, h3, h4 {
        font-family: Georgia, "Times New Roman", serif;
        line-height: 1.15;
      }
      p, li, td, th, code {
        line-height: 1.6;
      }
      .eyebrow {
        text-transform: uppercase;
        letter-spacing: 0.12em;
        font-size: 12px;
        color: #7a5c2f;
        font-weight: 700;
      }
      .meta {
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
        gap: 12px;
        margin: 24px 0 32px;
      }
      .meta-card {
        padding: 14px 16px;
        border-radius: 16px;
        background: #fffaf1;
        border: 1px solid #e7d8be;
      }
      pre {
        padding: 16px;
        border-radius: 16px;
        background: #1d1a16;
        color: #f6eee0;
        overflow-x: auto;
      }
      table {
        width: 100%;
        border-collapse: collapse;
        margin: 20px 0;
      }
      th, td {
        padding: 10px 12px;
        border: 1px solid #d7c6aa;
        text-align: left;
      }
      th {
        background: #ede1ce;
      }
      a {
        color: #945d10;
      }
      .format-note {
        margin-top: 40px;
        padding-top: 20px;
        border-top: 1px solid #d7c6aa;
        color: #6d6254;
        font-size: 14px;
      }
    </style>
  </head>
  <body>
    <main>
      <header>
        <p class="eyebrow">RepoDocs AI Export</p>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(description)}</p>
      </header>
      ${metadataHtml}
      ${bodyHtml}
      <p class="format-note">Generated by RepoDocs AI export automation.</p>
    </main>
  </body>
</html>`;
}