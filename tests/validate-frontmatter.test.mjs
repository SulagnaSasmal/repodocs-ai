/**
 * Frontmatter Validation Tests
 *
 * Tests the logic in scripts/validate-frontmatter.mjs by exercising the
 * extractFrontmatter and field-check rules directly with inline fixtures.
 *
 * Test cases are derived from:
 *   - schema/metadata-frontmatter.md (required fields)
 *   - prompts/api-generation/openapi-to-api-docs.md (metadata section requirement)
 *   - validation/review-checklists/documentation-quality-checklist.md
 */

import { describe, it, expect } from "vitest";

// ---------------------------------------------------------------------------
// Inline re-implementation of extractFrontmatter for unit testing
// (mirrors scripts/validate-frontmatter.mjs without file I/O)
// ---------------------------------------------------------------------------
function extractFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  return match ? match[1] : null;
}

// Required fields per schema/metadata-frontmatter.md
const requiredFields = [
  "title", "description", "service", "component", "owner",
  "api_version", "status", "dependencies", "last_reviewed", "security_impact"
];

function validateFrontmatter(content) {
  const errors = [];
  const fm = extractFrontmatter(content);

  if (!fm) {
    errors.push("missing YAML frontmatter");
    return errors;
  }

  // Minimal YAML parse (key: value lines only — sufficient for these fixtures)
  const parsed = {};
  for (const line of fm.split("\n")) {
    const m = line.match(/^([a-z_]+):\s*(.*)$/);
    if (m) parsed[m[1]] = m[2].trim();
  }

  for (const field of requiredFields) {
    if (!(field in parsed)) {
      errors.push(`missing required field '${field}'`);
    }
  }

  const allowedStatus = new Set(["draft", "beta", "stable", "deprecated"]);
  if (parsed.status && !allowedStatus.has(parsed.status)) {
    errors.push(`invalid status '${parsed.status}'`);
  }

  const allowedSecurityImpact = new Set(["low", "medium", "high"]);
  if (parsed.security_impact && !allowedSecurityImpact.has(parsed.security_impact)) {
    errors.push(`invalid security_impact '${parsed.security_impact}'`);
  }

  if ((parsed.status === "stable" || parsed.status === "beta") && !parsed.reviewed_by) {
    errors.push(`'${parsed.status}' documents require 'reviewed_by'`);
  }

  if (parsed.owner && !/^[a-z0-9][a-z0-9-]*$/.test(parsed.owner)) {
    errors.push(`'owner' must be a lowercase slug`);
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const validEndpointDoc = `---
title: Create Payment
description: Creates a new payment transaction.
service: payments
component: payment-processor
owner: payments-eng
api_version: v1
status: draft
dependencies: []
last_reviewed: 2026-03-13
security_impact: high
---
# Create Payment
`;

const validStableDoc = `---
title: Retrieve Payment
description: Retrieves payment details by ID.
service: payments
component: payment-processor
owner: payments-eng
api_version: v1
status: stable
dependencies: []
last_reviewed: 2026-03-13
security_impact: low
reviewed_by: lead-reviewer
---
# Retrieve Payment
`;

const missingFrontmatterDoc = `# Create Payment

No frontmatter here.
`;

const missingFieldsDoc = `---
title: Create Payment
service: payments
---
# Create Payment
`;

const invalidStatusDoc = `---
title: Create Payment
description: Creates a payment.
service: payments
component: payment-processor
owner: payments-eng
api_version: v1
status: invalid-status
dependencies: []
last_reviewed: 2026-03-13
security_impact: low
---
`;

const invalidSecurityImpactDoc = `---
title: Create Payment
description: Creates a payment.
service: payments
component: payment-processor
owner: payments-eng
api_version: v1
status: draft
dependencies: []
last_reviewed: 2026-03-13
security_impact: extreme
---
`;

const stableWithoutReviewerDoc = `---
title: Create Payment
description: Creates a payment.
service: payments
component: payment-processor
owner: payments-eng
api_version: v1
status: stable
dependencies: []
last_reviewed: 2026-03-13
security_impact: low
---
`;

const invalidOwnerSlugDoc = `---
title: Create Payment
description: Creates a payment.
service: payments
component: payment-processor
owner: Payments Team
api_version: v1
status: draft
dependencies: []
last_reviewed: 2026-03-13
security_impact: low
---
`;

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe("extractFrontmatter", () => {
  it("extracts YAML block from a valid document", () => {
    const fm = extractFrontmatter(validEndpointDoc);
    expect(fm).toContain("title: Create Payment");
  });

  it("returns null when frontmatter is absent", () => {
    expect(extractFrontmatter(missingFrontmatterDoc)).toBeNull();
  });

  it("handles CRLF line endings", () => {
    const crlf = "---\r\ntitle: Test\r\n---\r\n# Body";
    expect(extractFrontmatter(crlf)).toBe("title: Test");
  });
});

describe("validateFrontmatter — valid documents", () => {
  it("passes a valid draft endpoint document with no errors", () => {
    expect(validateFrontmatter(validEndpointDoc)).toHaveLength(0);
  });

  it("passes a valid stable document with reviewed_by present", () => {
    expect(validateFrontmatter(validStableDoc)).toHaveLength(0);
  });
});

describe("validateFrontmatter — missing frontmatter", () => {
  it("reports missing YAML frontmatter block", () => {
    const errors = validateFrontmatter(missingFrontmatterDoc);
    expect(errors).toContain("missing YAML frontmatter");
  });
});

describe("validateFrontmatter — missing required fields", () => {
  it("reports each missing required field individually", () => {
    const errors = validateFrontmatter(missingFieldsDoc);
    // title and service are present; all others should be reported
    const missingFromFixture = requiredFields.filter(
      (f) => !["title", "service"].includes(f)
    );
    for (const field of missingFromFixture) {
      expect(errors.some((e) => e.includes(field)), `Expected error for field: ${field}`).toBe(true);
    }
  });
});

describe("validateFrontmatter — invalid field values", () => {
  it("rejects an invalid status value", () => {
    const errors = validateFrontmatter(invalidStatusDoc);
    expect(errors.some((e) => e.includes("invalid status"))).toBe(true);
  });

  it("rejects an invalid security_impact value", () => {
    const errors = validateFrontmatter(invalidSecurityImpactDoc);
    expect(errors.some((e) => e.includes("invalid security_impact"))).toBe(true);
  });

  it("requires reviewed_by when status is stable", () => {
    const errors = validateFrontmatter(stableWithoutReviewerDoc);
    expect(errors.some((e) => e.includes("reviewed_by"))).toBe(true);
  });

  it("rejects a non-slug owner value", () => {
    const errors = validateFrontmatter(invalidOwnerSlugDoc);
    expect(errors.some((e) => e.includes("owner"))).toBe(true);
  });
});

describe("validateFrontmatter — allowed values", () => {
  for (const status of ["draft", "beta", "stable", "deprecated"]) {
    it(`accepts status: ${status}`, () => {
      const doc = validEndpointDoc.replace("status: draft", `status: ${status}`)
        + (["stable", "beta"].includes(status) ? "\nreviewed_by: reviewer\n" : "");
      const errors = validateFrontmatter(doc);
      expect(errors.some((e) => e.includes("invalid status"))).toBe(false);
    });
  }

  for (const impact of ["low", "medium", "high"]) {
    it(`accepts security_impact: ${impact}`, () => {
      const doc = validEndpointDoc.replace("security_impact: high", `security_impact: ${impact}`);
      const errors = validateFrontmatter(doc);
      expect(errors.some((e) => e.includes("invalid security_impact"))).toBe(false);
    });
  }
});
