/**
 * Repository Structure Tests
 *
 * Verifies that every file required by scripts/validate-structure.mjs
 * actually exists in the repository.
 *
 * This test suite acts as a canary — if a required file is accidentally
 * deleted or moved, CI fails immediately with a clear file-by-file report
 * rather than a confusing script error.
 *
 * Test cases derived from:
 *   - scripts/validate-structure.mjs (requiredPaths array)
 *   - docs/product-specification.md (Phase 1 deliverables)
 *   - docs/roadmap-spec-summary.md (Phase 1-3 implementation checklist)
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

async function exists(relativePath) {
  try {
    await fs.access(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Core repository files
// ---------------------------------------------------------------------------
describe("root trust files", () => {
  const files = ["README.md", "LICENSE", "CHANGELOG.md", "CONTRIBUTING.md",
    "CODE_OF_CONDUCT.md", "SECURITY.md", "ROADMAP.md", "TEMPLATE_VERSION"];

  for (const file of files) {
    it(`${file} exists`, async () => {
      expect(await exists(file)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Template packs — derived from Phase 2 deliverables in roadmap-spec-summary.md
// ---------------------------------------------------------------------------
describe("template packs", () => {
  const templates = [
    "templates/api/api-overview.md",
    "templates/api/endpoint-template.md",
    "templates/product/product-overview.md",
    "templates/product/feature-documentation.md",
    "templates/product/user-guide.md",
    "templates/product/administrator-guide.md",
    "templates/features/feature-overview.md",
    "templates/features/user-workflow.md",
    "templates/governance/documentation-review-checklist.md",
    "templates/operations/runbook.md",
    "templates/operations/deployment-guide.md",
    "templates/architecture/system-architecture.md",
    "templates/architecture/integration-architecture.md"
  ];

  for (const template of templates) {
    it(`${template} exists`, async () => {
      expect(await exists(template)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Prompt library — derived from Phase 2 deliverables
// ---------------------------------------------------------------------------
describe("prompt library", () => {
  const prompts = [
    "prompts/api-generation/openapi-to-api-docs.md",
    "prompts/product-docs/product-overview-generation.md",
    "prompts/product-docs/user-guide-generation.md",
    "prompts/product-docs/admin-guide-generation.md",
    "prompts/feature-docs/component-to-feature-doc.md",
    "prompts/review/documentation-review.md"
  ];

  for (const prompt of prompts) {
    it(`${prompt} exists`, async () => {
      expect(await exists(prompt)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Example documentation — payments API trust check
// ---------------------------------------------------------------------------
describe("payments API example", () => {
  const files = [
    "examples/payments-api/README.md",
    "examples/payments-api/payments-openapi.yaml",
    "examples/payments-api/api-overview.md",
    "examples/payments-api/create-payment.md",
    "examples/payments-api/retrieve-payment.md",
    "examples/payments-api/refund-payment.md",
    "examples/payments-api/list-payments.md",
    "examples/payments-api/authentication.md",
    "examples/payments-api/error-handling.md",
    "examples/payments-api/idempotency.md",
    "examples/payments-api/webhooks.md"
  ];

  for (const file of files) {
    it(`${file} exists`, async () => {
      expect(await exists(file)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Validation scripts — Phase 3 deliverables
// ---------------------------------------------------------------------------
describe("validation scripts", () => {
  const scripts = [
    "scripts/validate-frontmatter.mjs",
    "scripts/validate-structure.mjs",
    "scripts/validate-doc-quality.mjs",
    "scripts/validate-openapi-examples.mjs",
    "scripts/validate-version-compatibility.mjs",
    "scripts/detect-undocumented-endpoints.mjs"
  ];

  for (const script of scripts) {
    it(`${script} exists`, async () => {
      expect(await exists(script)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Automation scripts
// ---------------------------------------------------------------------------
describe("automation scripts", () => {
  const scripts = [
    "scripts/generate-openapi-docs.mjs",
    "scripts/generate-all-openapi-docs.mjs",
    "scripts/run-documentation-agent.mjs",
    "scripts/generate-analytics-report.mjs",
    "scripts/build-knowledge-graph.mjs",
    "scripts/export-docs.mjs",
    "scripts/control-plane-server.mjs",
    "scripts/bootstrap-docs-repo.mjs",
    "scripts/aggregate-analytics.mjs",
    "scripts/check-template-version.mjs"
  ];

  for (const script of scripts) {
    it(`${script} exists`, async () => {
      expect(await exists(script)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Site / GitHub Pages
// ---------------------------------------------------------------------------
describe("site files", () => {
  const files = [
    "site/index.html",
    "site/spec-summary.html",
    "site/roadmap.html",
    "site/automation.html",
    "site/control-plane.html",
    "site/complete-system.html",
    "site/installation.html",
    "site/styles.css"
  ];

  for (const file of files) {
    it(`${file} exists`, async () => {
      expect(await exists(file)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// CI workflows
// ---------------------------------------------------------------------------
describe("CI workflows", () => {
  const workflows = [
    ".github/workflows/validate.yml",
    ".github/workflows/deploy-site.yml",
    ".github/workflows/generate-openapi-docs.yml",
    ".github/workflows/regenerate-on-openapi-change.yml",
    ".github/workflows/export-docs.yml",
    ".github/workflows/automation-assets.yml"
  ];

  for (const workflow of workflows) {
    it(`${workflow} exists`, async () => {
      expect(await exists(workflow)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Governance
// ---------------------------------------------------------------------------
describe("governance files", () => {
  const files = [
    ".github/CODEOWNERS",
    ".github/pull_request_template.md",
    ".github/ISSUE_TEMPLATE/bug_report.yml",
    ".github/ISSUE_TEMPLATE/feature_request.yml",
    "schema/owners-registry.md",
    "schema/metadata-frontmatter.md",
    "validation/hallucination-guards/api-doc-guardrails.md",
    "validation/review-checklists/documentation-quality-checklist.md"
  ];

  for (const file of files) {
    it(`${file} exists`, async () => {
      expect(await exists(file)).toBe(true);
    });
  }
});

// ---------------------------------------------------------------------------
// Archive — former .litcoffee artifacts should be gone; archive replacements present
// ---------------------------------------------------------------------------
describe("archive cleanup", () => {
  it("doc.RepoDocs AI.litcoffee is no longer present at root", async () => {
    expect(await exists("doc.RepoDocs AI.litcoffee")).toBe(false);
  });

  it("docs/# RepoDocs AI.litcoffee is no longer present", async () => {
    expect(await exists("docs/# RepoDocs AI.litcoffee")).toBe(false);
  });

  it("docs/archive/README.md exists", async () => {
    expect(await exists("docs/archive/README.md")).toBe(true);
  });

  it("docs/archive/product-spec-overview-v1.md exists", async () => {
    expect(await exists("docs/archive/product-spec-overview-v1.md")).toBe(true);
  });

  it("docs/archive/product-spec-system-v1.md exists", async () => {
    expect(await exists("docs/archive/product-spec-system-v1.md")).toBe(true);
  });
});
