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

  it("pulls overview metadata from spec extensions", () => {
    expect(apiOverview).toContain("checkout applications");
    expect(apiOverview).toContain("60 requests per minute per client token");
    expect(apiOverview).toContain("official JavaScript and Python SDKs");
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

  it("states request body requirements and uses schema descriptions when present", () => {
    expect(postPayments).toContain("Request body is required. Fields not listed as required in the schema are optional.");
    expect(postPayments).toContain("| amount | number | yes | Total payment amount in major currency units. |");
    expect(postPayments).toContain("| currency | string | yes | ISO 4217 currency code for the payment. |");
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
describe("generate-openapi-docs header parameters and errors", () => {
  it("documents header parameters and adds them to the curl example", async () => {
    const outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "repodocs-openapi-headers-"));
    await execFileAsync(process.execPath, [
      path.join(repoRoot, "scripts", "generate-openapi-docs.mjs"),
      "examples/payments-api/payments-openapi.yaml",
      outputDirectory
    ], { cwd: repoRoot });

    const createPayment = await fs.readFile(path.join(outputDirectory, "endpoints", "post-payments.md"), "utf8");
    expect(createPayment).toContain("## Header Parameters");
    expect(createPayment).toContain("| Idempotency-Key | string | yes |");
    expect(createPayment).toContain('-H "Idempotency-Key: checkout-7f3a9c2e"');

    const retrievePayment = await fs.readFile(path.join(outputDirectory, "endpoints", "get-payments-id.md"), "utf8");
    expect(retrievePayment).not.toContain("## Header Parameters");
  });

  it("resolves $ref header parameters, skips default headers in curl, and escapes values", async () => {
    const workDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "repodocs-openapi-edge-"));
    const specPath = path.join(workDirectory, "edge.yaml");
    await fs.writeFile(specPath, [
      "openapi: 3.0.3",
      "info: {title: Edge API, version: v1}",
      "servers: [{url: https://api.edge.example}]",
      "components:",
      "  parameters:",
      "    Idem: {in: header, name: Idempotency-Key, required: true, schema: {type: string}}",
      "paths:",
      "  /things:",
      "    post:",
      "      summary: Create thing",
      "      parameters:",
      "        - $ref: '#/components/parameters/Idem'",
      "        - {in: header, name: Authorization, required: true, schema: {type: string}}",
      "        - {in: header, name: X-Note, required: false, schema: {type: string}, example: 'say \"hi\"'}",
      "      requestBody: {required: true, content: {application/json: {schema: {type: object, properties: {a: {type: string, example: x}}}}}}",
      "      responses: {'201': {description: Created}}",
      ""
    ].join("\n"), "utf8");

    const outputDirectory = path.join(workDirectory, "out");
    await execFileAsync(process.execPath, [
      path.join(repoRoot, "scripts", "generate-openapi-docs.mjs"),
      specPath,
      outputDirectory
    ], { cwd: repoRoot });

    const doc = await fs.readFile(path.join(outputDirectory, "endpoints", "post-things.md"), "utf8");
    expect(doc).toContain("| Idempotency-Key | string | yes |");
    expect(doc).toContain('-H "Idempotency-Key: <Idempotency-Key>"');
    expect(doc.match(/-H "Authorization:/g)).toHaveLength(1);
    expect(doc).toContain('-H "X-Note: say \\"hi\\""');
  });

  it("explains a missing spec file instead of printing a stack trace", async () => {
    await expect(
      execFileAsync(process.execPath, [
        path.join(repoRoot, "scripts", "generate-openapi-docs.mjs"),
        "does-not-exist/openapi.yaml"
      ], { cwd: repoRoot })
    ).rejects.toMatchObject({ stderr: expect.stringContaining("OpenAPI spec not found") });
  });
});

describe("validate-doc-quality target paths", () => {
  it("validates only the folder passed on the command line", async () => {
    const docsDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "repodocs-quality-target-"));
    await execFileAsync(process.execPath, [
      path.join(repoRoot, "scripts", "generate-openapi-docs.mjs"),
      "examples/payments-api/payments-openapi.yaml",
      docsDirectory
    ], { cwd: repoRoot });

    const { stdout } = await execFileAsync(process.execPath, [
      path.join(repoRoot, "scripts", "validate-doc-quality.mjs"),
      docsDirectory
    ], { cwd: repoRoot });

    expect(stdout).toContain("Validated documentation quality for 4 Markdown files in");
    expect(stdout).toContain(path.basename(docsDirectory));
  });

  it("fails instead of reporting a result when the folder has no Markdown files", async () => {
    const emptyDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "repodocs-quality-empty-"));
    await expect(
      execFileAsync(process.execPath, [
        path.join(repoRoot, "scripts", "validate-doc-quality.mjs"),
        emptyDirectory
      ], { cwd: repoRoot })
    ).rejects.toMatchObject({ stderr: expect.stringContaining("Nothing was checked") });
  });

  it("fails when the folder passed on the command line does not exist", async () => {
    await expect(
      execFileAsync(process.execPath, [
        path.join(repoRoot, "scripts", "validate-doc-quality.mjs"),
        path.join(os.tmpdir(), "repodocs-missing-folder")
      ], { cwd: repoRoot })
    ).rejects.toMatchObject({ stderr: expect.stringContaining("Path not found") });
  });
});
