import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const requiredPaths = [
  "docs/product-specification.md",
  "docs/phase-1-phase-2-plan.md",
  "docs/roadmap-spec-summary.md",
  "templates/api/api-overview.md",
  "templates/api/endpoint-template.md",
  "templates/product/product-overview.md",
  "templates/product/feature-documentation.md",
  "templates/product/user-guide.md",
  "templates/product/administrator-guide.md",
  "templates/governance/documentation-review-checklist.md",
  "prompts/api-generation/openapi-to-api-docs.md",
  "prompts/product-docs/product-overview-generation.md",
  "prompts/product-docs/user-guide-generation.md",
  "prompts/product-docs/admin-guide-generation.md",
  "prompts/review/documentation-review.md",
  "validation/hallucination-guards/api-doc-guardrails.md",
  "validation/review-checklists/documentation-quality-checklist.md",
  "examples/api-docs/payments-api-overview.md",
  "examples/api-docs/payments-create-payment.md",
  "examples/api-docs/payments-retrieve-payment.md",
  "examples/openapi/payments-openapi.yaml",
  "examples/product-docs/repodocs-ai-product-overview.md",
  "examples/product-docs/repodocs-ai-user-guide.md",
  "diagrams/data-flow/payments-data-flow.mmd",
  "scripts/generate-openapi-docs.mjs",
  "scripts/validate-doc-quality.mjs",
  "scripts/validate-openapi-examples.mjs",
  "site/index.html",
  "site/roadmap.html",
  "site/automation.html",
  "site/styles.css",
  "starters/mkdocs/README.md",
  "starters/mkdocs/mkdocs.yml",
  "starters/mkdocs/docs/index.md",
  "starters/mkdocs/docs/getting-started.md",
  "starters/mkdocs/docs/api-reference.md"
];

async function exists(relativePath) {
  try {
    await fs.access(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function main() {
  const missing = [];

  for (const relativePath of requiredPaths) {
    if (!(await exists(relativePath))) {
      missing.push(relativePath);
    }
  }

  if (missing.length > 0) {
    console.error("Repository structure validation failed:\n");
    for (const item of missing) {
      console.error(`- Missing: ${item}`);
    }
    process.exit(1);
  }

  console.log(`Validated ${requiredPaths.length} required project files.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});