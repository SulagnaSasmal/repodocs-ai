/**
 * Example Documentation Content Tests
 *
 * Verifies that the payments API example documents have the required sections
 * defined by the prompts/api-generation/openapi-to-api-docs.md prompt.
 *
 * These tests catch regressions where example content is accidentally
 * truncated, restructured, or loses required sections.
 *
 * Test cases are derived from:
 *   - prompts/api-generation/openapi-to-api-docs.md (10 required sections)
 *   - prompts/review/documentation-review.md (completeness checklist)
 *   - examples/payments-api/ (trust-proof payment documentation system)
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

async function readExample(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

// 10 required sections per openapi-to-api-docs.md prompt
const REQUIRED_ENDPOINT_SECTIONS = [
  "## Summary",
  "## Endpoint",
  "## Authentication Requirements",
  "## Request",
  "## Response",
  "## Error Codes"
];

// Required frontmatter fields per schema/metadata-frontmatter.md
const REQUIRED_FRONTMATTER_FIELDS = [
  "title:",
  "description:",
  "service:",
  "owner:",
  "status:"
];

function checkSections(content, sections) {
  const missing = [];
  for (const section of sections) {
    if (!content.includes(section)) {
      missing.push(section);
    }
  }
  return missing;
}

function hasFrontmatter(content) {
  return content.startsWith("---");
}

// ---------------------------------------------------------------------------
// Create Payment — the primary trust-check document
// ---------------------------------------------------------------------------
describe("examples/payments-api/create-payment.md", () => {
  let content;

  beforeAll(async () => {
    content = await readExample("examples/payments-api/create-payment.md");
  });

  it("exists and is non-empty", () => {
    expect(content.length).toBeGreaterThan(200);
  });

  it("has YAML frontmatter", () => {
    expect(hasFrontmatter(content)).toBe(true);
  });

  it("includes required frontmatter fields", () => {
    for (const field of REQUIRED_FRONTMATTER_FIELDS) {
      expect(content, `Missing frontmatter field: ${field}`).toContain(field);
    }
  });

  it("includes Summary section", () => {
    expect(content).toMatch(/## Summary/i);
  });

  it("includes Endpoint section with Method and URL", () => {
    expect(content).toMatch(/## Endpoint/i);
    expect(content).toMatch(/Method:/i);
    expect(content).toMatch(/URL:|`\/payments`|POST/i);
  });

  it("includes Authentication Requirements section", () => {
    expect(content).toMatch(/## Authentication/i);
  });

  it("includes Request Body or Request Example", () => {
    expect(content).toMatch(/## Request/i);
  });

  it("includes Response Example", () => {
    expect(content).toMatch(/## Response/i);
  });

  it("includes Error Codes table", () => {
    expect(content).toMatch(/## Error Codes/i);
    // Should have at least 401 (Unauthorized) as per the prompt spec
    expect(content).toMatch(/401/);
  });

  it("does not contain Needs SME input placeholders (example should be complete)", () => {
    expect(content).not.toMatch(/Needs SME input/);
  });
});

// ---------------------------------------------------------------------------
// API Overview
// ---------------------------------------------------------------------------
describe("examples/payments-api/api-overview.md", () => {
  let content;

  beforeAll(async () => {
    content = await readExample("examples/payments-api/api-overview.md");
  });

  it("exists and is non-empty", () => {
    expect(content.length).toBeGreaterThan(200);
  });

  it("has YAML frontmatter", () => {
    expect(hasFrontmatter(content)).toBe(true);
  });

  it("describes authentication mechanisms", () => {
    expect(content).toMatch(/auth|bearer|token/i);
  });

  it("includes base URL or versioning information", () => {
    expect(content).toMatch(/base.?url|version|v1/i);
  });
});

// ---------------------------------------------------------------------------
// Authentication document
// ---------------------------------------------------------------------------
describe("examples/payments-api/authentication.md", () => {
  let content;

  beforeAll(async () => {
    content = await readExample("examples/payments-api/authentication.md");
  });

  it("exists and is non-empty", () => {
    expect(content.length).toBeGreaterThan(100);
  });

  it("covers bearer token authentication", () => {
    expect(content).toMatch(/bearer|token|Authorization/i);
  });
});

// ---------------------------------------------------------------------------
// Error handling document
// ---------------------------------------------------------------------------
describe("examples/payments-api/error-handling.md", () => {
  let content;

  beforeAll(async () => {
    content = await readExample("examples/payments-api/error-handling.md");
  });

  it("exists and is non-empty", () => {
    expect(content.length).toBeGreaterThan(100);
  });

  it("documents at least one HTTP error code", () => {
    expect(content).toMatch(/4\d{2}|5\d{2}/);
  });
});

// ---------------------------------------------------------------------------
// Webhooks document
// ---------------------------------------------------------------------------
describe("examples/payments-api/webhooks.md", () => {
  let content;

  beforeAll(async () => {
    content = await readExample("examples/payments-api/webhooks.md");
  });

  it("exists and is non-empty", () => {
    expect(content.length).toBeGreaterThan(100);
  });

  it("references webhook events or payload structure", () => {
    expect(content).toMatch(/event|payload|webhook/i);
  });
});

// ---------------------------------------------------------------------------
// OpenAPI spec presence
// ---------------------------------------------------------------------------
describe("examples/payments-api/payments-openapi.yaml", () => {
  let content;

  beforeAll(async () => {
    content = await readExample("examples/payments-api/payments-openapi.yaml");
  });

  it("exists and is non-empty", () => {
    expect(content.length).toBeGreaterThan(100);
  });

  it("starts with openapi: declaration", () => {
    expect(content).toMatch(/^openapi:/m);
  });

  it("defines at least one path", () => {
    expect(content).toMatch(/^paths:/m);
  });
});

// ---------------------------------------------------------------------------
// Complete system example
// ---------------------------------------------------------------------------
describe("examples/complete-system/endpoint-create-payment.md", () => {
  let content;

  beforeAll(async () => {
    content = await readExample("examples/complete-system/endpoint-create-payment.md");
  });

  it("exists and is non-empty", () => {
    expect(content.length).toBeGreaterThan(200);
  });

  it("includes required endpoint sections", () => {
    const missing = checkSections(content, REQUIRED_ENDPOINT_SECTIONS);
    expect(missing, `Missing sections: ${missing.join(", ")}`).toHaveLength(0);
  });
});
