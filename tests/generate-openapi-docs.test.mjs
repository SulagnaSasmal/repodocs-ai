import { beforeAll, describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

describe("generate-openapi-docs", () => {
  let outputDirectory;
  let apiOverview;
  let getPayments;
  let postPayments;
  let getPaymentStatus;

  beforeAll(async () => {
    outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "repodocs-openapi-gen-"));
    await execFileAsync(process.execPath, [
      path.join(repoRoot, "scripts", "generate-openapi-docs.mjs"),
      "examples/openapi/payments-openapi.yaml",
      outputDirectory
    ], { cwd: repoRoot });

    apiOverview = await fs.readFile(path.join(outputDirectory, "api-overview.md"), "utf8");
    getPayments = await fs.readFile(path.join(outputDirectory, "endpoints", "get-payments.md"), "utf8");
    postPayments = await fs.readFile(path.join(outputDirectory, "endpoints", "post-payments.md"), "utf8");
    getPaymentStatus = await fs.readFile(path.join(outputDirectory, "endpoints", "get-payments-payment-id-status.md"), "utf8");
  });

  it("documents the concrete bearer auth scheme in the overview", () => {
    expect(apiOverview).toContain("HTTP Bearer token (JWT)");
  });

  it("expands response examples from nested schemas", () => {
    expect(getPayments).toContain('"payment_id": "pay_123"');
    expect(getPayments).toContain('"pagination": {');
    expect(getPayments).not.toContain('"data": "array"');
  });

  it("includes query parameter constraints from the OpenAPI schema", () => {
    expect(getPayments).toContain("Allowed values: pending, completed, failed, refunded");
    expect(getPayments).toContain("Format: date");
    expect(getPayments).toContain("Minimum: 1");
    expect(getPayments).toContain("Maximum: 100");
  });

  it("states request body requirements and uses example values when descriptions are absent", () => {
    expect(postPayments).toContain("Request body is required. Fields not listed as required in the schema are optional.");
    expect(postPayments).toContain("Example value: `125.5`");
    expect(postPayments).toContain("Example value: `USD`");
  });

  it("uses concrete example identifiers and query values in curl examples", () => {
    expect(getPayments).toContain("status=completed");
    expect(getPayments).toContain("page=1");
    expect(getPaymentStatus).toContain("/payments/pay_123/status");
  });

  it("documents the concrete bearer auth scheme at endpoint level", () => {
    expect(getPayments).toContain("Authentication is required. Use HTTP Bearer token (JWT).");
    expect(postPayments).toContain("Authentication is required. Use HTTP Bearer token (JWT).");
  });
});