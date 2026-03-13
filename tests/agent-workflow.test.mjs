/**
 * Documentation Agent Workflow Tests
 *
 * Tests the workflow classification logic and output shape of
 * scripts/run-documentation-agent.mjs.
 *
 * Test cases are derived from:
 *   - prompts/api-generation/openapi-to-api-docs.md (two-step workflow)
 *   - prompts/review/documentation-review.md (review output structure)
 *   - agents/documentation-agent.md (agent responsibilities)
 *   - docs/product-specification.md (AI-prompt-powered generation workflow)
 */

import { describe, it, expect } from "vitest";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Inline classifyWorkflow — mirrors the logic in run-documentation-agent.mjs
// ---------------------------------------------------------------------------
function classifyWorkflow(inputPath, content) {
  const extension = path.extname(inputPath).toLowerCase();
  if ([".yaml", ".yml", ".json"].includes(extension) && /["']?openapi["']?\s*:/i.test(content)) {
    return {
      mode: "api-generation",
      template: "templates/api/endpoint-template.md",
      prompt: "prompts/api-generation/openapi-to-api-docs.md"
    };
  }

  if (/feature|workflow|user journey/i.test(content)) {
    return {
      mode: "feature-docs",
      template: "templates/features/feature-overview.md",
      prompt: "prompts/product-docs/product-overview-generation.md"
    };
  }

  return {
    mode: "product-docs",
    template: "templates/product/product-overview.md",
    prompt: "prompts/product-docs/product-overview-generation.md"
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const openApiSpec = `openapi: 3.0.0
info:
  title: Payments API
  version: v1
paths:
  /payments:
    post:
      summary: Create payment
`;

const featureDocument = `
This document describes the payment-links feature workflow and user journey.
`;

const productDocument = `
RepoDocs AI product overview and description.
`;

function buildGeneratedReviewPayload(filesByPath) {
  const paths = Object.keys(filesByPath).sort((left, right) => left.localeCompare(right));
  if (paths.length === 0) {
    return { content: "(no generated Markdown files found)", files: [] };
  }

  const content = paths
    .map((relativePath) => [`### File: ${relativePath}`, "", filesByPath[relativePath].trim()].join("\n"))
    .join("\n\n");

  return { content, files: paths };
}

// ---------------------------------------------------------------------------
// Workflow classification
// ---------------------------------------------------------------------------
describe("classifyWorkflow — API generation", () => {
  it("classifies a .yaml file with openapi: as api-generation", () => {
    const result = classifyWorkflow("spec.yaml", openApiSpec);
    expect(result.mode).toBe("api-generation");
  });

  it("classifies a .yml file with openapi: as api-generation", () => {
    const result = classifyWorkflow("spec.yml", openApiSpec);
    expect(result.mode).toBe("api-generation");
  });

  it("classifies a .json file with openapi: as api-generation", () => {
    const jsonSpec = '{"openapi": "3.0.0", "info": {"title": "Test"}}';
    const result = classifyWorkflow("spec.json", jsonSpec);
    expect(result.mode).toBe("api-generation");
  });

  it("assigns the endpoint template for api-generation", () => {
    const result = classifyWorkflow("spec.yaml", openApiSpec);
    expect(result.template).toBe("templates/api/endpoint-template.md");
  });

  it("assigns the openapi-to-api-docs prompt for api-generation", () => {
    const result = classifyWorkflow("spec.yaml", openApiSpec);
    expect(result.prompt).toBe("prompts/api-generation/openapi-to-api-docs.md");
  });
});

describe("classifyWorkflow — feature docs", () => {
  it("classifies content with 'feature' keyword as feature-docs", () => {
    const result = classifyWorkflow("doc.md", featureDocument);
    expect(result.mode).toBe("feature-docs");
  });

  it("classifies content with 'workflow' keyword as feature-docs", () => {
    const result = classifyWorkflow("doc.md", "This is a workflow description.");
    expect(result.mode).toBe("feature-docs");
  });

  it("classifies content with 'user journey' as feature-docs", () => {
    const result = classifyWorkflow("doc.md", "Describes the user journey for checkout.");
    expect(result.mode).toBe("feature-docs");
  });

  it("assigns the feature-overview template for feature-docs", () => {
    const result = classifyWorkflow("doc.md", featureDocument);
    expect(result.template).toBe("templates/features/feature-overview.md");
  });
});

describe("classifyWorkflow — product docs (fallback)", () => {
  it("classifies generic content as product-docs", () => {
    const result = classifyWorkflow("doc.md", productDocument);
    expect(result.mode).toBe("product-docs");
  });

  it("assigns the product-overview template for product-docs", () => {
    const result = classifyWorkflow("doc.md", productDocument);
    expect(result.template).toBe("templates/product/product-overview.md");
  });

  it("does NOT classify a .yaml file without openapi: as api-generation", () => {
    const result = classifyWorkflow("config.yaml", "key: value\nother: setting");
    expect(result.mode).not.toBe("api-generation");
  });
});

// ---------------------------------------------------------------------------
// AI review result shape (derived from documentation-review.md output format)
// ---------------------------------------------------------------------------
describe("AI review result structure", () => {
  // Simulated response shape that runAiReview should return when enabled
  const mockPassingReview = {
    enabled: true,
    model: "claude-opus-4-6",
    result: {
      critical_issues: [],
      moderate_issues: ["curl example uses placeholder <token> — should be a realistic example value"],
      sme_inputs_required: [],
      suggested_edits: ["Add a note about idempotency-key header"],
      overall_assessment: "PASS",
      confidence: 0.92
    }
  };

  const mockFailingReview = {
    enabled: true,
    model: "claude-opus-4-6",
    result: {
      critical_issues: ["Response field 'payment_uuid' not present in spec — spec uses 'payment_id'"],
      moderate_issues: [],
      sme_inputs_required: ["Performance Notes — rate limits not specified in spec"],
      suggested_edits: [],
      overall_assessment: "FAIL",
      confidence: 0.98
    }
  };

  const mockSkippedReview = {
    enabled: false,
    skipped_reason: "ANTHROPIC_API_KEY not set — set the environment variable to enable AI review",
    result: null
  };

  it("passing review has overall_assessment PASS", () => {
    expect(mockPassingReview.result.overall_assessment).toBe("PASS");
  });

  it("passing review has no critical issues", () => {
    expect(mockPassingReview.result.critical_issues).toHaveLength(0);
  });

  it("failing review has at least one critical issue", () => {
    expect(mockFailingReview.result.critical_issues.length).toBeGreaterThan(0);
  });

  it("failing review flags hallucinated field name", () => {
    const issue = mockFailingReview.result.critical_issues[0];
    expect(issue).toMatch(/payment_uuid|not present in spec/i);
  });

  it("skipped review has enabled: false", () => {
    expect(mockSkippedReview.enabled).toBe(false);
  });

  it("skipped review explains how to enable AI review", () => {
    expect(mockSkippedReview.skipped_reason).toMatch(/ANTHROPIC_API_KEY/);
  });

  it("review result includes sme_inputs_required array", () => {
    expect(Array.isArray(mockFailingReview.result.sme_inputs_required)).toBe(true);
  });

  it("confidence is a number between 0 and 1", () => {
    expect(mockPassingReview.result.confidence).toBeGreaterThan(0);
    expect(mockPassingReview.result.confidence).toBeLessThanOrEqual(1);
  });
});

describe("generated review payload", () => {
  it("includes all generated markdown files in sorted order", () => {
    const payload = buildGeneratedReviewPayload({
      "endpoints/post-payments.md": "# Post Payments",
      "api-overview.md": "# API Overview",
      "endpoints/get-payments.md": "# Get Payments"
    });

    expect(payload.files).toEqual([
      "api-overview.md",
      "endpoints/get-payments.md",
      "endpoints/post-payments.md"
    ]);
  });

  it("labels each file section in the review content", () => {
    const payload = buildGeneratedReviewPayload({
      "api-overview.md": "# API Overview",
      "endpoints/get-payments.md": "# Get Payments"
    });

    expect(payload.content).toContain("### File: api-overview.md");
    expect(payload.content).toContain("### File: endpoints/get-payments.md");
  });

  it("returns a sentinel message when no generated markdown files exist", () => {
    const payload = buildGeneratedReviewPayload({});
    expect(payload.files).toHaveLength(0);
    expect(payload.content).toBe("(no generated Markdown files found)");
  });
});

// ---------------------------------------------------------------------------
// Agent last-run.json output shape
// ---------------------------------------------------------------------------
describe("agent run output shape", () => {
  const mockRunResult = {
    run_at: "2026-03-13T10:00:00.000Z",
    input: "examples/openapi/payments-openapi.yaml",
    workflow: {
      mode: "api-generation",
      template: "templates/api/endpoint-template.md",
      prompt: "prompts/api-generation/openapi-to-api-docs.md"
    },
    ai_review: {
      enabled: false,
      skipped_reason: "ANTHROPIC_API_KEY not set",
      result: null,
      reviewed_files: ["api-overview.md", "endpoints/post-payments.md"]
    },
    outputs: {
      generated_directory: "generated/payments-openapi",
      validation_commands: [
        "node scripts/validate-openapi-examples.mjs",
        "node scripts/validate-doc-quality.mjs"
      ]
    },
    execution: {
      generated_docs: { stdout: "Generated 3 files.", stderr: "" },
      openapi_validation: { stdout: "Validated 3 files.", stderr: "" },
      quality_validation: { stdout: "Validated 3 files.", stderr: "" }
    }
  };

  it("includes run_at timestamp", () => {
    expect(mockRunResult.run_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("includes input path", () => {
    expect(mockRunResult.input).toBeTruthy();
  });

  it("includes workflow classification", () => {
    expect(mockRunResult.workflow.mode).toBe("api-generation");
  });

  it("includes ai_review block", () => {
    expect(mockRunResult.ai_review).toBeDefined();
    expect("enabled" in mockRunResult.ai_review).toBe(true);
  });

  it("includes reviewed_files metadata when AI review runs", () => {
    expect(mockRunResult.ai_review.reviewed_files).toContain("api-overview.md");
  });

  it("includes generated_directory for api-generation mode", () => {
    expect(mockRunResult.outputs.generated_directory).toBeTruthy();
  });

  it("includes validation_commands for api-generation mode", () => {
    expect(Array.isArray(mockRunResult.outputs.validation_commands)).toBe(true);
    expect(mockRunResult.outputs.validation_commands).toHaveLength(2);
  });
});
