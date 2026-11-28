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
    expect(getPayments).toContain("Allowed values: `pending`, `completed`, `failed`, `refunded`");
    expect(getPayments).toContain("Format: date");
    expect(getPayments).toContain("Minimum: 1");
    // The spec's description already says "Maximum 100", so no second note is added.
    expect(getPayments).toMatch(/\| per_page \|[^\n]*Maximum:? 100/);
    expect(getPayments).not.toMatch(/\| per_page \|[^\n]*Maximum 100[^\n]*Maximum: 100/);
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

    expect(stdout).toContain("Structure checks passed for 5 Markdown files in");
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
    ).rejects.toMatchObject({ stderr: expect.stringContaining("Docs path not found") });
  });
});

describe("generate-openapi-docs with a hostile spec", () => {
  let overview;
  let endpoint;
  let outputDirectory;

  beforeAll(async () => {
    outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "repodocs-hostile-"));
    await execFileAsync(process.execPath, [
      path.join(repoRoot, "scripts", "generate-openapi-docs.mjs"),
      path.join(repoRoot, "tests", "fixtures", "hostile", "html-in-spec.yaml"),
      outputDirectory
    ], { cwd: repoRoot });
    overview = await fs.readFile(path.join(outputDirectory, "api-overview.md"), "utf8");
    endpoint = await fs.readFile(path.join(outputDirectory, "endpoints", "get-items-id.md"), "utf8");
  });

  // Outside code, as rendered text: a docs site that renders raw HTML must not run any of it.
  function prose(markdown) {
    return markdown
      .replace(/^---\n[\s\S]*?\n---\n/, "")
      .replace(/^```[^\n]*\n[\s\S]*?^```[ \t]*$/gm, "")
      .replace(/`+[^`\n]*?`+/g, "");
  }

  it("escapes HTML from the spec so it shows as text instead of running", () => {
    for (const doc of [overview, endpoint]) {
      expect(prose(doc)).not.toMatch(/<(script|img|iframe|svg)\b/i);
    }
    expect(overview).toContain("&lt;script>alert(1)&lt;/script>");
    expect(endpoint).toContain("# Endpoint: Get &lt;script>");
  });

  it("removes javascript: links, including ones with parentheses", () => {
    expect(overview).not.toMatch(/javascript:/i);
    expect(overview).toMatch(/\[click\]\(#unsafe-link-removed\)$/m);
  });

  it("keeps spec text that tries to add frontmatter keys inside the quoted title", () => {
    const frontmatter = overview.match(/^---\n([\s\S]*?)\n---/)[1];
    expect(frontmatter).not.toMatch(/^owner: attacker/m);
    expect(frontmatter).toMatch(/^owner: "unassigned"$/m);
  });

  it("names files from the method and path only, so operationId cannot escape the folder", async () => {
    expect(await fs.readdir(path.join(outputDirectory, "endpoints"))).toEqual(["get-items-id.md"]);
  });

  it("leaves code blocks untouched", () => {
    expect(endpoint).toContain('"name": "</code><script>alert(5)</script>"');
  });

  it("passes the quality check's unsafe-HTML rule, which fails the same text unescaped", async () => {
    const { stderr } = await execFileAsync(process.execPath, [path.join(repoRoot, "scripts", "validate-doc-quality.mjs"), outputDirectory]).catch((error) => error);
    expect(stderr || "").not.toContain("unsafe HTML");

    const handWritten = await fs.mkdtemp(path.join(os.tmpdir(), "repodocs-unsafe-"));
    await fs.writeFile(path.join(handWritten, "page.md"), "---\ntitle: \"x\"\n---\n# Page\n\n<img src=x onerror=alert(1)>\n\n[a](javascript:alert(1))\n\nThe tag `<script>` is fine in code.\n", "utf8");
    const result = await execFileAsync(process.execPath, [path.join(repoRoot, "scripts", "validate-doc-quality.mjs"), handWritten]).catch((error) => error);
    expect(result.code).toBe(1);
    expect(result.stderr).toContain("unsafe HTML that would run script on a docs site: an inline event handler (on...=), a javascript:, vbscript: or data: link");
  });
});

describe("generate-openapi-docs with a spec that tries to inject shell commands", () => {
  let outputDirectory;

  beforeAll(async () => {
    outputDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "repodocs-shell-"));
    await execFileAsync(process.execPath, [
      path.join(repoRoot, "scripts", "generate-openapi-docs.mjs"),
      path.join(repoRoot, "tests", "fixtures", "hostile", "shell-in-spec.yaml"),
      path.join(outputDirectory, "docs")
    ], { cwd: repoRoot });
  });

  it.skipIf(process.platform === "win32")("writes curl examples that run no command when copied into a shell", async () => {
    const doc = await fs.readFile(path.join(outputDirectory, "docs", "endpoints", "post-items.md"), "utf8");
    const curl = doc.match(/^(`{3,})bash\n([\s\S]*?)^\1/m)[2];
    // Run the example exactly as a reader would paste it, with curl replaced by a no-op.
    const bin = path.join(outputDirectory, "bin");
    await fs.mkdir(bin);
    await fs.writeFile(path.join(bin, "curl"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await execFileAsync("bash", ["-c", curl], { cwd: outputDirectory, env: { ...process.env, PATH: `${bin}:${process.env.PATH}` } });
    const created = (await fs.readdir(outputDirectory)).filter((name) => name.startsWith("PWNED"));
    expect(created).toEqual([]);
  });

  it("removes script links in every form and keeps the heading on one line", async () => {
    const overview = await fs.readFile(path.join(outputDirectory, "docs", "api-overview.md"), "utf8");
    const prose = overview.replace(/^---\n[\s\S]*?\n---\n/, "").replace(/`+[^`\n]*?`+/g, "");
    expect(prose).not.toMatch(/\]\(\s*(java|&#)/i);
    expect(prose).not.toMatch(/^\s*\[r\]:\s*javascript/im);
    expect((prose.match(/#unsafe-link-removed/g) || []).length).toBe(4);
    const endpoint = await fs.readFile(path.join(outputDirectory, "docs", "endpoints", "post-items.md"), "utf8");
    expect(endpoint).toContain("# Endpoint: Create an item\n");
  });
});
