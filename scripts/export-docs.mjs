import fs from "node:fs/promises";
import path from "node:path";
import {
  buildHtmlDocument,
  buildPdfBuffer,
  ensureDirectory,
  loadMarkdownDocuments,
  markdownToPlainText,
  renderMarkdownToHtml,
  repoRoot
} from "./lib/docs-automation-utils.mjs";

const supportedFormats = new Set(["all", "confluence", "gdocs", "pdf"]);
const sourceDirectories = ["docs", "examples"];

function buildMetadataHtml(frontmatter = {}) {
  const entries = Object.entries(frontmatter || {}).filter(([, value]) => value !== undefined && value !== null && value !== "");
  if (entries.length === 0) {
    return "";
  }

  return `<section class="meta">${entries
    .map(([key, value]) => {
      const rendered = Array.isArray(value) ? value.join(", ") : String(value);
      return `<article class="meta-card"><strong>${key}</strong><div>${rendered}</div></article>`;
    })
    .join("")}</section>`;
}

function normalizeFormatArg(value) {
  const format = (value || "all").toLowerCase();
  if (!supportedFormats.has(format)) {
    console.error(`Unsupported export format '${value}'. Use one of: ${[...supportedFormats].join(", ")}`);
    process.exit(1);
  }
  return format;
}

function getFormats(formatArg) {
  return formatArg === "all" ? ["confluence", "gdocs", "pdf"] : [formatArg];
}

async function writeHtmlExport(baseDirectory, relativePath, suffix, html) {
  const outputPath = path.join(baseDirectory, relativePath.replace(/\.md$/i, suffix));
  await ensureDirectory(path.dirname(outputPath));
  await fs.writeFile(outputPath, html, "utf8");
  return path.relative(repoRoot, outputPath).replace(/\\/g, "/");
}

async function main() {
  const formatArg = normalizeFormatArg(process.argv[2]);
  const formats = getFormats(formatArg);
  const outputRoot = path.join(repoRoot, "exports");
  const documents = await loadMarkdownDocuments(sourceDirectories);
  const manifest = {
    generated_at: new Date().toISOString(),
    source_directories: sourceDirectories,
    formats,
    documents: []
  };

  for (const document of documents) {
    const title = document.frontmatter?.title || document.relativePath;
    const description = document.frontmatter?.description || `Exported document for ${document.relativePath}`;
    const metadataHtml = buildMetadataHtml(document.frontmatter);
    const bodyHtml = renderMarkdownToHtml(document.body);
    const html = buildHtmlDocument({ title, description, metadataHtml, bodyHtml });
    const exportRecord = {
      source: document.relativePath,
      formats: {}
    };

    for (const format of formats) {
      const formatRoot = path.join(outputRoot, format);
      if (format === "confluence") {
        const wrapped = html.replace("RepoDocs AI Export", "RepoDocs AI Confluence Export");
        exportRecord.formats.confluence = await writeHtmlExport(formatRoot, document.relativePath, ".storage.html", wrapped);
        continue;
      }

      if (format === "gdocs") {
        exportRecord.formats.gdocs = await writeHtmlExport(formatRoot, document.relativePath, ".html", html);
        continue;
      }

      if (format === "pdf") {
        exportRecord.formats.pdf_html = await writeHtmlExport(formatRoot, document.relativePath, ".print.html", html);
        const pdfPath = path.join(formatRoot, document.relativePath.replace(/\.md$/i, ".pdf"));
        await ensureDirectory(path.dirname(pdfPath));
        await fs.writeFile(pdfPath, buildPdfBuffer(title, markdownToPlainText(document.body)));
        exportRecord.formats.pdf = path.relative(repoRoot, pdfPath).replace(/\\/g, "/");
      }
    }

    manifest.documents.push(exportRecord);
  }

  await ensureDirectory(outputRoot);
  await fs.writeFile(path.join(outputRoot, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
  console.log(`Exported ${documents.length} Markdown files to ${formats.join(", ")} under exports/.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});