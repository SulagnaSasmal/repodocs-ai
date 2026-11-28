/**
 * Validator probes
 *
 * Generates docs from the Ably, Vonage and Adyen specs, checks they pass as
 * generated, then breaks copies of them the ways the fresh-agent release
 * checks did and confirms each break is caught. A check that passes broken
 * docs is worse than none.
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = (name) => path.join(repoRoot, "scripts", name);
const ablySpec = path.join(repoRoot, "tests", "fixtures", "third-party", "ably-platform.yaml");

let workDirectory;
let specsDirectory;
let generatedDirectory;

async function copyAndEdit(file, edit) {
  const target = await fs.mkdtemp(path.join(workDirectory, "probe-"));
  await fs.cp(generatedDirectory, target, { recursive: true });
  const filePath = path.join(target, "endpoints", file);
  await fs.writeFile(filePath, edit(await fs.readFile(filePath, "utf8")), "utf8");
  return target;
}

async function openApiErrors(docsDirectory) {
  try {
    await execFileAsync(process.execPath, [script("validate-openapi-examples.mjs"), docsDirectory, "--specs", specsDirectory]);
    return "";
  } catch (error) {
    return error.stderr;
  }
}

beforeAll(async () => {
  workDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "repodocs-probes-"));
  specsDirectory = path.join(workDirectory, "openapi");
  generatedDirectory = path.join(workDirectory, "generated");
  await fs.mkdir(specsDirectory);
  await fs.copyFile(ablySpec, path.join(specsDirectory, "ably-platform.yaml"));
  await execFileAsync(process.execPath, [script("generate-openapi-docs.mjs"), path.join(specsDirectory, "ably-platform.yaml"), generatedDirectory, "--owner", "realtime-team"]);
});

describe("generated Ably docs", () => {
  it("pass the OpenAPI check as generated", async () => {
    expect(await openApiErrors(generatedDirectory)).toBe("");
  });

  it("document the oneOf request body as options", async () => {
    const doc = await fs.readFile(path.join(generatedDirectory, "endpoints", "post-keys-keyname-requesttoken.md"), "utf8");
    expect(doc).toContain("The body must match exactly one of these 2 shapes.");
    expect(doc).toContain("### Option 1: TokenRequest");
    expect(doc).toContain("### Option 2: SignedTokenRequest");
    expect(doc).toContain("| mac | string | yes |");
  });

  it("say when the spec's own example leaves out a required field", async () => {
    const doc = await fs.readFile(path.join(generatedDirectory, "endpoints", "post-keys-keyname-requesttoken.md"), "utf8");
    expect(doc).toContain("The spec's own request example leaves out required field `nonce`.");
    expect(doc).toMatch(/"nonce":/);
  });

  it("use the owner passed with --owner and a title without a repeated word", async () => {
    const overview = await fs.readFile(path.join(generatedDirectory, "api-overview.md"), "utf8");
    expect(overview).toContain('owner: "realtime-team"');
    expect(overview).toContain('title: "Platform API Overview"');
    expect(overview).toContain("HTTP Basic authentication: Basic Authentication using an");
  });
});

describe("the OpenAPI check catches", () => {
  it("an undefined query parameter and a value outside its enum", async () => {
    const probe = await copyAndEdit("get-time.md", (doc) => doc.replace("?format=json", "?format=yaml&madeUp=1"));
    const errors = await openApiErrors(probe);
    expect(errors).toContain("query parameter 'madeUp', which is not defined");
    expect(errors).toContain("'format' uses 'yaml', which is not one of its allowed values");
  });

  it("a status code the spec does not define", async () => {
    const probe = await copyAndEdit("get-time.md", (doc) => doc.replace("| default | Error |", "| 418 | Teapot |"));
    expect(await openApiErrors(probe)).toContain("status code '418' is not defined for GET /time");
  });

  it("a parameter or request field marked with the wrong Required flag", async () => {
    const probe = await copyAndEdit("post-push-deviceregistrations.md", (doc) =>
      doc.replace("| formFactor | string | no |", "| formFactor | string | yes |").replace("| format | string | no |", "| format | string | yes |")
    );
    const errors = await openApiErrors(probe);
    expect(errors).toContain("request field 'formFactor' is marked Required: yes, but the spec says no");
    expect(errors).toContain("parameter 'format' is marked Required: yes, but the spec says no");
  });

  it("a readOnly field sent in a request example", async () => {
    const probe = await copyAndEdit("post-channels-channel-id-messages.md", (doc) => doc.replace(/-d '\{/, `-d '{"timestamp":1,`));
    expect(await openApiErrors(probe)).toContain("sends 'timestamp', which is readOnly");
  });
});

describe("the frontmatter check", () => {
  it("fails an empty required field", async () => {
    const probe = await copyAndEdit("get-time.md", (doc) => doc.replace('owner: "realtime-team"', 'owner: ""'));
    await expect(
      execFileAsync(process.execPath, [script("validate-frontmatter.mjs"), probe])
    ).rejects.toMatchObject({ stderr: expect.stringContaining("required field 'owner' is empty") });
  });
});

describe("init and CI", () => {
  it("init creates the openapi, generated and docs folders", async () => {
    const target = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "repodocs-init-")), "docs-repo");
    await execFileAsync(process.execPath, [script("bootstrap-docs-repo.mjs"), target]);
    for (const folder of ["openapi", "generated", "docs"]) {
      await expect(fs.access(path.join(target, folder, ".gitkeep"))).resolves.toBeUndefined();
    }
  });

  it("the CI step fails when there is nothing to check", async () => {
    const target = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "repodocs-init-")), "docs-repo");
    await execFileAsync(process.execPath, [script("bootstrap-docs-repo.mjs"), target]);
    const workflow = await fs.readFile(path.join(target, ".github", "workflows", "docs-validate.yml"), "utf8");
    const step = workflow.split("run: |\n").pop().split("\n").map((line) => line.replace(/^ {10}/, "")).join("\n");
    const pinned = step.match(/npx --yes github:SulagnaSasmal\/repodocs-ai#v[\d.]+/)[0];
    const runnable = step.replace(pinned, `node "${path.join(repoRoot, "bin", "repodocs.mjs")}"`);
    await expect(execFileAsync("bash", ["-c", runnable], { cwd: target })).rejects.toMatchObject({
      code: 1,
      stdout: expect.stringContaining("No Markdown docs in generated/ or docs/ yet. Nothing was checked.")
    });
  });
});

describe("Vonage Conversation API (v1.2.1 release check)", () => {
  const vonageSpec = path.join(repoRoot, "tests", "fixtures", "third-party", "vonage-conversation.yaml");
  let vonageDirectory;
  let vonageSpecs;
  let vonageDocs;

  async function vonageProbe(file, edit) {
    const target = await fs.mkdtemp(path.join(vonageDirectory, "probe-"));
    await fs.cp(vonageDocs, target, { recursive: true });
    const filePath = path.join(target, "endpoints", file);
    const original = await fs.readFile(filePath, "utf8");
    const edited = edit(original);
    expect(edited).not.toBe(original);
    await fs.writeFile(filePath, edited, "utf8");
    try {
      await execFileAsync(process.execPath, [script("validate-openapi-examples.mjs"), target, "--specs", vonageSpecs]);
      return "";
    } catch (error) {
      return error.stderr;
    }
  }

  beforeAll(async () => {
    vonageDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "repodocs-vonage-"));
    vonageSpecs = path.join(vonageDirectory, "openapi");
    vonageDocs = path.join(vonageDirectory, "generated");
    await fs.mkdir(vonageSpecs);
    await fs.copyFile(vonageSpec, path.join(vonageSpecs, "vonage-conversation.yaml"));
    await execFileAsync(process.execPath, [script("generate-openapi-docs.mjs"), path.join(vonageSpecs, "vonage-conversation.yaml"), vonageDocs, "--owner", "conversation-eng"], { env: { ...process.env, TZ: "Asia/Kolkata" } });
  });

  it("generates docs that pass as generated, following request body references", async () => {
    await expect(execFileAsync(process.execPath, [script("validate-openapi-examples.mjs"), vonageDocs, "--specs", vonageSpecs])).resolves.toBeTruthy();
    const doc = await fs.readFile(path.join(vonageDocs, "endpoints", "post-conversations.md"), "utf8");
    expect(doc).not.toMatch(/## Request Body\s+Not applicable\./);
    expect(doc).toContain("| display_name | string |");
  });

  it("keeps date examples as written, whatever the time zone", async () => {
    const doc = await fs.readFile(path.join(vonageDocs, "endpoints", "get-conversations.md"), "utf8");
    expect(doc).toContain("date_start=2018-01-01%2010%3A00%3A00");
    expect(doc).not.toContain("GMT");
  });

  it("does not invent a deprecation version, and shows the success status", async () => {
    const doc = await fs.readFile(path.join(vonageDocs, "endpoints", "get-conversations-conversation-id-events.md"), "utf8");
    expect(doc).toContain("The spec does not say since which version: Needs SME input.");
    expect(doc).not.toMatch(/deprecated as of 2\.0\.1/);
    expect(doc).toMatch(/## Response Example\s+Status: `200`/);
  });

  it("documents each shape of a nested oneOf field", async () => {
    const doc = await fs.readFile(path.join(vonageDocs, "endpoints", "post-conversations-conversation-id-members.md"), "utf8");
    expect(doc).toContain("| channel.from.user | string | yes | Option 1 of 5.");
    expect(doc).toContain("| channel.from.number | string | yes | Option 2 of 5.");
  });

  it("leaves out example fields the schema does not define, and says so", async () => {
    const doc = await fs.readFile(path.join(vonageDocs, "endpoints", "get-legs.md"), "utf8");
    expect(doc).toContain("The spec's own example also shows fields its schema does not define");
    expect(doc).toContain("`_embedded.legs[].end_time`");
  });

  it("shows a numeric string as the number its schema defines, and says so", async () => {
    const doc = await fs.readFile(path.join(vonageDocs, "endpoints", "get-conversations.md"), "utf8");
    expect(doc).toContain("The spec's own example gives `count` as a string, but its schema says number, so it is shown as a number here.");
    expect(doc).toMatch(/"count": 100\b/);
  });

  const members = "post-conversations-conversation-id-members.md";
  it.each([
    ["an invented table row", (doc) => doc.replace("| action | string | no |", "| email | string | yes | Contact email |\n| action | string | no |"), "request field 'email' in the Request Body table is not defined"],
    ["an invented nested table row", (doc) => doc.replace("| channel.from | one of", "| channel.region | string | no | Region |\n| channel.from | one of"), "request field 'channel.region' in the Request Body table is not defined"],
    ["a wrong enum value in the request JSON", (doc) => doc.replace('"action":"join"', '"action":"accept"'), "request example field 'action' uses 'accept', which is not one of its allowed values"],
    ["an invented value in a table's allowed values", (doc) => doc.replace("Allowed values: `invite`, `join`", "Allowed values: `invite`, `join`, `leave`"), "lists allowed values (invite, join, leave) that do not match the spec"],
    ["an invented field inside a oneOf shape", (doc) => doc.replace('"user":"jamie"}', '"user":"jamie","priority":1}'), "request example field 'channel.from.priority' is not defined"],
    ["a changed field type", (doc) => doc.replace("| action | string | no |", "| action | integer | no |"), "request field 'action' is documented as integer, but the spec says string"],
    ["a different server", (doc) => doc.replace("https://api.nexmo.com/v0.1", "https://api.example.com/v9"), "which is not under any server"],
    ["removed authentication", (doc) => doc.replace("Authentication is required.", "No authentication is required."), "Authentication says none is required, but the spec requires it"],
    ["a status the spec does not define", (doc) => doc.replace("Status: `201`", "Status: `202`"), "response status '202' is not defined"]
  ])("catches %s", async (name, edit, expected) => {
    expect(await vonageProbe(members, edit)).toContain(expected);
  });
});

describe("hand-written docs and validate options", () => {
  it("fails a doc that still contains template instructions", async () => {
    const docs = await fs.mkdtemp(path.join(os.tmpdir(), "repodocs-template-left-"));
    const template = await fs.readFile(path.join(repoRoot, "templates", "features", "feature-overview.md"), "utf8");
    await fs.writeFile(path.join(docs, "feature.md"), template.replace("{feature-name}", "Tags").replace('service: ""', 'service: "x"').replace('owner: ""', 'owner: "y"'), "utf8");
    await expect(execFileAsync(process.execPath, [script("validate-doc-quality.mjs"), docs])).rejects.toMatchObject({
      stderr: expect.stringContaining("line(s) of template instructions left in")
    });
  });

  it("fails a last_reviewed value that is not a date", async () => {
    const docs = await fs.mkdtemp(path.join(os.tmpdir(), "repodocs-date-"));
    await fs.writeFile(
      path.join(docs, "page.md"),
      '---\ntitle: "Page"\ndescription: "A page"\nservice: "x"\ncomponent: "feature"\nowner: "docs-platform"\napi_version: "n/a"\nstatus: draft\ndependencies: []\nlast_reviewed: "yesterday"\nsecurity_impact: low\n---\n# Page\n\n## Overview\n\nText.\n',
      "utf8"
    );
    await expect(execFileAsync(process.execPath, [script("validate-frontmatter.mjs"), docs])).rejects.toMatchObject({
      stderr: expect.stringContaining("last_reviewed must be a real date in YYYY-MM-DD format")
    });
  });

  it("reports SKIP, not PASS, when there are no endpoint docs to compare, and --strict fails on it", async () => {
    const docs = await fs.mkdtemp(path.join(os.tmpdir(), "repodocs-no-endpoints-"));
    await fs.writeFile(
      path.join(docs, "page.md"),
      '---\ntitle: "Page"\ndescription: "A page"\nservice: "x"\ncomponent: "feature"\nowner: "docs-platform"\napi_version: "n/a"\nstatus: draft\ndependencies: []\nlast_reviewed: 2026-01-01\nsecurity_impact: low\n---\n# Page\n\n## Overview\n\nText.\n',
      "utf8"
    );
    const { stdout } = await execFileAsync(process.execPath, [script("validate-docs.mjs"), docs, "--specs", specsDirectory]);
    expect(stdout).toContain("[SKIP] OpenAPI examples");
    await expect(execFileAsync(process.execPath, [script("validate-docs.mjs"), docs, "--specs", specsDirectory, "--strict"])).rejects.toMatchObject({ code: 1 });
  });
});

describe("Adyen Checkout API (v1.2.2 release check)", () => {
  const adyenSpec = path.join(repoRoot, "tests", "fixtures", "third-party", "adyen-checkout.yaml");
  const captures = path.join("endpoints", "post-payments-paymentpspreference-captures.md");
  const paymentLinks = path.join("endpoints", "post-paymentlinks.md");
  let adyenDirectory;
  let adyenSpecs;
  let adyenDocs;

  async function adyenProbe(file, edit, scriptName = "validate-openapi-examples.mjs") {
    const target = await fs.mkdtemp(path.join(adyenDirectory, "probe-"));
    await fs.cp(adyenDocs, target, { recursive: true });
    const filePath = path.join(target, file);
    const original = await fs.readFile(filePath, "utf8");
    const edited = edit(original);
    expect(edited).not.toBe(original);
    await fs.writeFile(filePath, edited, "utf8");
    const args = scriptName === "validate-openapi-examples.mjs" ? [target, "--specs", adyenSpecs] : [target];
    try {
      const { stderr } = await execFileAsync(process.execPath, [script(scriptName), ...args]);
      return { failed: false, output: stderr };
    } catch (error) {
      return { failed: true, output: `${error.stdout}${error.stderr}` };
    }
  }

  beforeAll(async () => {
    adyenDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "repodocs-adyen-"));
    adyenSpecs = path.join(adyenDirectory, "openapi");
    adyenDocs = path.join(adyenDirectory, "generated");
    await fs.mkdir(adyenSpecs);
    await fs.copyFile(adyenSpec, path.join(adyenSpecs, "adyen-checkout.yaml"));
    await execFileAsync(process.execPath, [script("generate-openapi-docs.mjs"), path.join(adyenSpecs, "adyen-checkout.yaml"), adyenDocs, "--owner", "payments-eng"]);
  });

  it("generates docs that pass every check as generated", async () => {
    await expect(execFileAsync(process.execPath, [script("validate-openapi-examples.mjs"), adyenDocs, "--specs", adyenSpecs])).resolves.toBeDefined();
    const { stderr } = await execFileAsync(process.execPath, [script("validate-doc-quality.mjs"), adyenDocs]);
    // Statuses in generated docs come from the spec, so the POST-200 heuristic stays quiet.
    expect(stderr).not.toContain("POST returning 200");
    // A path parameter with no example stays a visible placeholder, with a warning.
    expect(stderr).toContain("still has placeholder(s) {paymentPspReference}");
  });

  it.each([
    ["a nested Required flag flipped", captures, (doc) => doc.replace("| amount.value | integer | yes |", "| amount.value | integer | no |"), "request field 'amount.value' is marked Required: no, but the spec says yes"],
    ["a plain allowed-values list on a field with no enum", captures, (doc) => doc.replace("used to process the payment. |\n", "used to process the payment. Allowed values: ACME_EU, ACME_US |\n"), "request field 'merchantAccount' lists allowed values (ACME_EU, ACME_US) that do not match the spec (no enum)"],
    ["a changed format", captures, (doc) => doc.replace("currency-codes). Format: int64 |\n| applicationInfo", "currency-codes). Format: int32 |\n| applicationInfo"), "request field 'amount.value' says Format: int32, but the spec says int64"],
    ["a changed default", paymentLinks, (doc) => doc.replace("remove a stored payment method. Default: true |", "remove a stored payment method. Default: false |"), "request field 'showRemovePaymentMethodButton' says Default: false, but the spec says true"],
    ["a number sent as a string in the request JSON", captures, (doc) => doc.replace('"value":2000}', '"value":"2000"}'), "request example field 'amount.value' is a string, but the spec says integer"],
    ["a number shown as a string in the error body", captures, (doc) => doc.replace('  "status": 400\n}', '  "status": "400"\n}'), "error response example field 'status' is a string, but the spec says integer"],
    ["a Bearer token the spec does not use", captures, (doc) => doc.replace('-u "<username>:<password>" \\', '-H "Authorization: Bearer <token>" \\'), "the request example sends a Bearer token, but the spec's security"],
    ["a Content-Type the spec does not accept", captures, (doc) => doc.replace('-H "Content-Type: application/json"', '-H "Content-Type: application/xml"'), "the request example sends Content-Type application/xml"],
    ["an optional body described as required", captures, (doc) => doc.replace("Request body is optional.", "Request body is required."), "the Request Body says the body is required, but the spec says it is optional"],
    ["an overview that names the wrong auth", "api-overview.md", (doc) => doc.replace("API key in header `X-API-Key`. HTTP Basic authentication", "OAuth 2.0 client credentials."), "Authentication mentions OAuth, but the spec's security for the API does not use it"]
  ])("catches %s", async (name, file, edit, expected) => {
    const result = await adyenProbe(file, edit);
    expect(result.failed).toBe(true);
    expect(result.output).toContain(expected);
  });

  it.each([
    ["TBD", "TBD"],
    ["<insert description here>", "<insert description here>"],
    ["{{latency}}", "{{latency}}"],
    ["Lorem ipsum dolor", "Lorem ipsum"]
  ])("fails the placeholder %s", async (placeholder, expected) => {
    const result = await adyenProbe(captures, (doc) => doc.replace("## Request Body\n", `## Request Body\n\n${placeholder}\n`), "validate-doc-quality.mjs");
    expect(result.failed).toBe(true);
    expect(result.output).toContain(`unresolved placeholder content detected (${expected})`);
  });

  it.each([
    ["an impossible day", "2026-02-30", "last_reviewed must be a real date"],
    ["a date in the future", "2099-01-01", "is in the future"]
  ])("fails a last_reviewed of %s", async (name, date, expected) => {
    const result = await adyenProbe(captures, (doc) => doc.replace(/^last_reviewed: .*$/m, `last_reviewed: "${date}"`), "validate-frontmatter.mjs");
    expect(result.failed).toBe(true);
    expect(result.output).toContain(expected);
  });
});

describe("hand-written docs written by people", () => {
  it("reads backticked parameter names and checks the paging defaults", async () => {
    const docs = await fs.mkdtemp(path.join(os.tmpdir(), "repodocs-hand-"));
    const specs = path.join(docs, "openapi");
    await fs.mkdir(specs);
    await fs.copyFile(path.join(repoRoot, "examples", "openapi", "payments-openapi.yaml"), path.join(specs, "payments-openapi.yaml"));
    const original = await fs.readFile(path.join(repoRoot, "examples", "payments-api", "list-payments.md"), "utf8");
    await fs.writeFile(path.join(docs, "list-payments.md"), original, "utf8");
    await expect(execFileAsync(process.execPath, [script("validate-openapi-examples.mjs"), docs, "--specs", specs])).resolves.toBeDefined();

    await fs.writeFile(path.join(docs, "list-payments.md"), original.replace("Default: 20", "Default: 50"), "utf8");
    await expect(execFileAsync(process.execPath, [script("validate-openapi-examples.mjs"), docs, "--specs", specs])).rejects.toMatchObject({
      stderr: expect.stringContaining("parameter 'per_page' says Default: 50, but the spec says 20")
    });
  });

  it("warns when a doc written from a template drops some of its sections", async () => {
    const docs = await fs.mkdtemp(path.join(os.tmpdir(), "repodocs-sections-"));
    const template = await fs.readFile(path.join(repoRoot, "templates", "operations", "runbook.md"), "utf8");
    const headings = template.split("\n").filter((line) => line.startsWith("## ")).map((line) => line.slice(3).trim());
    const kept = headings.slice(0, headings.length - 1);
    const body = kept.map((heading) => `## ${heading}\n\nWritten for the payments service.\n`).join("\n");
    await fs.writeFile(
      path.join(docs, "runbook.md"),
      `---\ntitle: "Payments runbook"\ndescription: "How to run the payments service"\nservice: "payments"\ncomponent: "operations"\nowner: "docs-platform"\napi_version: "n/a"\nstatus: draft\ndependencies: []\nlast_reviewed: 2026-01-01\nsecurity_impact: low\n---\n# Payments runbook\n\n${body}`,
      "utf8"
    );
    const { stderr } = await execFileAsync(process.execPath, [script("validate-doc-quality.mjs"), docs]);
    expect(stderr).toContain(`missing section(s) from the operations template: ${headings[headings.length - 1]}`);
  });
});
