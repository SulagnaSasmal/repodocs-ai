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
  "templates/operations/runbook.md",
  "templates/operations/deployment-guide.md",
  "templates/architecture/system-architecture.md",
  "templates/architecture/integration-architecture.md",
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
  "examples/payments-api/README.md",
  "examples/payments-api/payments-openapi.yaml",
  "examples/payments-api/api-overview.md",
  "examples/payments-api/create-payment.md",
  "examples/payments-api/retrieve-payment.md",
  "examples/payments-api/refund-payment.md",
  "examples/product-docs/repodocs-ai-product-overview.md",
  "examples/product-docs/repodocs-ai-user-guide.md",
  "diagrams/data-flow/payments-data-flow.mmd",
  "scripts/generate-all-openapi-docs.mjs",
  "scripts/generate-openapi-docs.mjs",
  "scripts/export-docs.mjs",
  "scripts/run-documentation-agent.mjs",
  "scripts/generate-analytics-report.mjs",
  "scripts/build-knowledge-graph.mjs",
  "scripts/control-plane-server.mjs",
  "scripts/validate-doc-quality.mjs",
  "scripts/validate-openapi-examples.mjs",
  "scripts/validate-version-compatibility.mjs",
  "site/index.html",
  "site/roadmap.html",
  "site/automation.html",
  "site/control-plane.html",
  "site/complete-system.html",
  "site/styles.css",
  ".github/workflows/regenerate-on-openapi-change.yml",
  ".github/workflows/export-docs.yml",
  ".github/workflows/automation-assets.yml",
  "starters/mkdocs/README.md",
  "starters/mkdocs/mkdocs.yml",
  "starters/mkdocs/docs/index.md",
  "starters/mkdocs/docs/getting-started.md",
  "starters/mkdocs/docs/api-reference.md",
  "starters/docusaurus/README.md",
  "starters/docusaurus/package.json",
  "starters/docusaurus/docusaurus.config.ts",
  "starters/docusaurus/sidebars.ts",
  "starters/docusaurus/docs/intro.md",
  "starters/docusaurus/docs/adoption-workflow.md",
  "starters/docusaurus/docs/api-docs-workflow.md",
  "starters/gitbook/README.md",
  "starters/gitbook/README.md.md",
  "starters/gitbook/SUMMARY.md",
  "starters/gitbook/getting-started.md",
  "starters/gitbook/api-docs-workflow.md",
  "starters/nextjs-docs/README.md",
  "starters/nextjs-docs/package.json",
  "starters/nextjs-docs/next.config.ts",
  "starters/nextjs-docs/src/app/page.tsx",
  "starters/nextjs-docs/src/app/docs/page.tsx",
  "starters/nextjs-docs/src/app/globals.css",
  "platforms/gitlab/README.md",
  "platforms/gitlab/.gitlab-ci.yml",
  "platforms/bitbucket/README.md",
  "platforms/bitbucket/bitbucket-pipelines.yml",
  "bundle/pricing-and-packaging.md",
  "bundle/bundle-manifest.json",
  "agents/documentation-agent.md",
  "knowledge-graph/entity-model.md",
  "analytics/metrics-framework.md",
  "docs/migration-guides/payments-retrieve-status.md",
  "docs/hosted-control-plane.md",
  "examples/complete-system/product-overview.md",
  "examples/complete-system/feature-payment-links.md",
  "examples/complete-system/api-overview.md",
  "examples/complete-system/endpoint-create-payment.md",
  "examples/complete-system/endpoint-retrieve-payment.md",
  "examples/complete-system/review-report.md",
  "examples/complete-system/architecture-system-context.mmd",
  "examples/complete-system/data-flow-payments.mmd",
  ".github/pull_request_template.md",
  ".github/CODEOWNERS",
  "scripts/detect-undocumented-endpoints.mjs",
  "schema/owners-registry.md",
  "docs/multi-repo-guide.md"
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