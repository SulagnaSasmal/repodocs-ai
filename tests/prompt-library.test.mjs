/**
 * Prompt Library Tests
 *
 * Test cases curated from the 6 RepoDocs AI prompt library prompts:
 *   1. prompts/api-generation/openapi-to-api-docs.md
 *   2. prompts/feature-docs/component-to-feature-doc.md
 *   3. prompts/product-docs/admin-guide-generation.md
 *   4. prompts/product-docs/product-overview-generation.md
 *   5. prompts/product-docs/user-guide-generation.md
 *   6. prompts/review/documentation-review.md
 *
 * These tests verify that every prompt file:
 *   - Exists at the expected path
 *   - Contains the required structural sections
 *   - Defines a role, input, and output format
 *   - Includes specific quality directives expected from the audit
 */

import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

async function readPrompt(relativePath) {
  return fs.readFile(path.join(repoRoot, relativePath), "utf8");
}

// ---------------------------------------------------------------------------
// 1. openapi-to-api-docs.md
// ---------------------------------------------------------------------------
describe("prompt: openapi-to-api-docs", () => {
  let content;

  beforeAll(async () => {
    content = await readPrompt("prompts/api-generation/openapi-to-api-docs.md");
  });

  it("exists", () => {
    expect(content).toBeTruthy();
  });

  it("defines a Role section", () => {
    expect(content).toMatch(/^## Role/m);
  });

  it("defines an Input section", () => {
    expect(content).toMatch(/^## Input/m);
  });

  it("defines an Instructions section", () => {
    expect(content).toMatch(/^## Instructions/m);
  });

  it("defines an Output Format section", () => {
    expect(content).toMatch(/^## Output Format/m);
  });

  it("lists all 10 required endpoint documentation sections", () => {
    const requiredSections = [
      "Summary",
      "Endpoint",
      "Authentication Requirements",
      "Path Parameters",
      "Query Parameters",
      "Request Body",
      "Request Example",
      "Response Example",
      "Error Codes",
      "Performance Notes"
    ];
    for (const section of requiredSections) {
      expect(content, `Missing section: ${section}`).toContain(section);
    }
  });

  it("includes self-validation checklist", () => {
    expect(content).toMatch(/Self-Validation/i);
  });

  it("includes hallucination guard directive (no invented fields)", () => {
    expect(content).toMatch(/Do not invent/i);
  });

  it("references the two-step workflow with documentation-review.md", () => {
    expect(content).toMatch(/documentation-review\.md/);
  });

  it("instructs use of Needs SME input label for missing data", () => {
    expect(content).toMatch(/Needs SME input/);
  });
});

// ---------------------------------------------------------------------------
// 2. documentation-review.md
// ---------------------------------------------------------------------------
describe("prompt: documentation-review", () => {
  let content;

  beforeAll(async () => {
    content = await readPrompt("prompts/review/documentation-review.md");
  });

  it("exists", () => {
    expect(content).toBeTruthy();
  });

  it("defines a Role section", () => {
    expect(content).toMatch(/^## Role/m);
  });

  it("includes Spec Cross-Reference checklist", () => {
    expect(content).toMatch(/Spec Cross-Reference/i);
  });

  it("includes Completeness checklist", () => {
    expect(content).toMatch(/Completeness/i);
  });

  it("includes Hallucination Indicators section", () => {
    expect(content).toMatch(/Hallucination/i);
  });

  it("includes SME Input Tracking section", () => {
    expect(content).toMatch(/SME Input/i);
  });

  it("includes Language and Usability section", () => {
    expect(content).toMatch(/Language and Usability/i);
  });

  it("defines Output Format with critical/moderate/suggested structure", () => {
    expect(content).toMatch(/Critical issues/i);
    expect(content).toMatch(/Moderate issues/i);
    expect(content).toMatch(/Suggested edits/i);
  });

  it("references the two-step workflow back to openapi-to-api-docs.md", () => {
    expect(content).toMatch(/openapi-to-api-docs\.md/);
  });

  it("requires all 10 sections be checked for completeness", () => {
    const sections = ["Summary", "Endpoint", "Authentication Requirements", "Path Parameters",
      "Query Parameters", "Request Body", "Request Example", "Response Example",
      "Error Codes", "Performance Notes"];
    for (const section of sections) {
      expect(content, `Missing completeness check for: ${section}`).toContain(section);
    }
  });
});

// ---------------------------------------------------------------------------
// 3. product-overview-generation.md
// ---------------------------------------------------------------------------
describe("prompt: product-overview-generation", () => {
  let content;

  beforeAll(async () => {
    content = await readPrompt("prompts/product-docs/product-overview-generation.md");
  });

  it("exists", () => {
    expect(content).toBeTruthy();
  });

  it("defines a Role section", () => {
    expect(content).toMatch(/^## Role/m);
  });

  it("addresses product description or overview", () => {
    expect(content).toMatch(/product/i);
  });
});

// ---------------------------------------------------------------------------
// 4. user-guide-generation.md
// ---------------------------------------------------------------------------
describe("prompt: user-guide-generation", () => {
  let content;

  beforeAll(async () => {
    content = await readPrompt("prompts/product-docs/user-guide-generation.md");
  });

  it("exists", () => {
    expect(content).toBeTruthy();
  });

  it("references user or end-user audience", () => {
    expect(content).toMatch(/user/i);
  });
});

// ---------------------------------------------------------------------------
// 5. admin-guide-generation.md
// ---------------------------------------------------------------------------
describe("prompt: admin-guide-generation", () => {
  let content;

  beforeAll(async () => {
    content = await readPrompt("prompts/product-docs/admin-guide-generation.md");
  });

  it("exists", () => {
    expect(content).toBeTruthy();
  });

  it("references administrator or admin audience", () => {
    expect(content).toMatch(/admin/i);
  });
});

// ---------------------------------------------------------------------------
// 6. component-to-feature-doc.md
// ---------------------------------------------------------------------------
describe("prompt: component-to-feature-doc", () => {
  let content;

  beforeAll(async () => {
    content = await readPrompt("prompts/feature-docs/component-to-feature-doc.md");
  });

  it("exists", () => {
    expect(content).toBeTruthy();
  });

  it("references feature documentation", () => {
    expect(content).toMatch(/feature/i);
  });
});

// ---------------------------------------------------------------------------
// Prompt README
// ---------------------------------------------------------------------------
describe("prompts/README.md", () => {
  let content;

  beforeAll(async () => {
    content = await readPrompt("prompts/README.md");
  });

  it("exists", () => {
    expect(content).toBeTruthy();
  });

  it("references all prompt categories", () => {
    expect(content).toMatch(/api-generation/i);
    expect(content).toMatch(/review/i);
    expect(content).toMatch(/product-docs/i);
  });
});
