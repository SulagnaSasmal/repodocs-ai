# Export Integrations

RepoDocs AI generates export artifacts for four targets: **Confluence**, **Google Docs**, **Notion**, and **PDF-ready HTML**.

The export pipeline converts every Markdown document in `docs/` and `examples/` into the target format. Run one command and get a complete exports directory ready to upload.

## Quick Start

```bash
# Export to all four formats
npm run export

# Export to a specific format
npm run export:notion
npm run export:confluence
npm run export:gdocs
npm run export:pdf
```

Output is written to `exports/<format>/` mirroring the source directory structure.

---

## Notion Export — Verified Example

The Notion exporter generates `.notion.md` files that are ready for Notion's Markdown import feature.

### How It Works

1. Each Markdown document is read with its YAML frontmatter.
2. Frontmatter fields are converted to a `## Metadata` block (Notion renders this as a visible section).
3. The document body is written as clean Markdown.
4. The output file is saved to `exports/notion/<original-path>.notion.md`.

### Verified Output

Running `npm run export:notion` on `examples/payments-api/create-payment.md` produces:

**Input** (`examples/payments-api/create-payment.md`):

```markdown
---
title: Create Payment
description: Creates a new payment transaction.
service: payments
owner: payments-eng
api_version: v1
status: stable
reviewed_by: lead-reviewer
dependencies: []
last_reviewed: 2026-03-13
security_impact: high
---

# Create Payment

## Summary

Create a payment for a customer checkout session...
```

**Output** (`exports/notion/examples/payments-api/create-payment.notion.md`):

```markdown
# Create Payment

## Metadata

- title: Create Payment
- description: Creates a new payment transaction.
- service: payments
- owner: payments-eng
- api_version: v1
- status: stable
- reviewed_by: lead-reviewer
- last_reviewed: 2026-03-13
- security_impact: high

## Summary

Create a payment for a customer checkout session...
```

### Importing Into Notion

1. Run `npm run export:notion`.
2. Open Notion and navigate to the target page.
3. Click the `...` menu → **Import** → **Markdown & CSV**.
4. Upload the `.notion.md` file from `exports/notion/`.
5. Notion renders the Markdown including the Metadata section and all headings.

> **Note:** Notion's Markdown import does not preserve frontmatter YAML. The exporter intentionally converts frontmatter to a visible `## Metadata` block so the document context is not lost on import.

---

## Confluence Export

The Confluence exporter generates `.storage.html` files using Confluence Storage Format HTML.

These files can be imported into Confluence using **Space Tools → Content Tools → Import** or via the Confluence REST API:

```bash
curl -X POST "https://your-domain.atlassian.net/wiki/rest/api/content" \
  -H "Authorization: Basic $(echo -n 'user@example.com:API_TOKEN' | base64)" \
  -H "Content-Type: application/json" \
  -d '{
    "type": "page",
    "title": "Create Payment",
    "space": {"key": "DEV"},
    "body": {
      "storage": {
        "value": "<html content from exports/confluence/...>",
        "representation": "storage"
      }
    }
  }'
```

Output files: `exports/confluence/<path>.storage.html`

---

## Google Docs Export

The Google Docs exporter generates `.html` files that can be imported via **File → Open → Upload** in Google Docs.

Google Docs renders the HTML including headings, tables, and code blocks. After import, apply the RepoDocs AI heading styles manually if needed.

Output files: `exports/gdocs/<path>.html`

---

## PDF Export

The PDF exporter generates two artifacts per document:

1. `.print.html` — a print-optimized HTML file styled for PDF conversion
2. `.pdf` — a plain-text PDF suitable for distribution

For high-fidelity PDF output with full Markdown rendering, convert the `.print.html` file using a headless browser:

```bash
# Using Chrome headless
google-chrome --headless --print-to-pdf="doc.pdf" exports/pdf/docs/installation.print.html

# Using Puppeteer (Node.js)
node -e "
const puppeteer = require('puppeteer');
(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  await page.goto('file://$(pwd)/exports/pdf/docs/installation.print.html');
  await page.pdf({ path: 'output.pdf', format: 'A4' });
  await browser.close();
})();
"
```

Output files: `exports/pdf/<path>.print.html` and `exports/pdf/<path>.pdf`

---

## Audience Routing

Use the `audience` frontmatter field to control which export formats receive each document:

| Value | Formats |
|-------|---------|
| `internal` (or omitted) | All formats (Confluence, Notion, Google Docs, PDF) |
| `external` | PDF only |
| `both` | All formats |

Example:

```yaml
---
title: Internal Architecture Guide
audience: internal
---
```

This prevents internal architecture documents from appearing in PDF exports sent to external consumers.

---

## Export Manifest

Every export run writes `exports/manifest.json` — a structured record of every source document, the formats it was exported to, and the output file paths.

```json
{
  "generated_at": "2026-03-13T10:00:00.000Z",
  "source_directories": ["docs", "examples"],
  "formats": ["confluence", "gdocs", "notion", "pdf"],
  "documents": [
    {
      "source": "examples/payments-api/create-payment.md",
      "formats": {
        "confluence": "exports/confluence/examples/payments-api/create-payment.storage.html",
        "gdocs": "exports/gdocs/examples/payments-api/create-payment.html",
        "notion": "exports/notion/examples/payments-api/create-payment.notion.md",
        "pdf_html": "exports/pdf/examples/payments-api/create-payment.print.html",
        "pdf": "exports/pdf/examples/payments-api/create-payment.pdf"
      }
    }
  ]
}
```

The manifest is also surfaced in the control plane dashboard under **Automation Artifacts**.
