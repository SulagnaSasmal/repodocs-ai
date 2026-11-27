/**
 * Validator probes
 *
 * Generates docs from the Ably spec, checks they pass as generated, then
 * breaks copies of them the ways the v1.2.0 release check did and confirms
 * each break is caught. A check that passes broken docs is worse than none.
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

  const members = "post-conversations-conversation-id-members.md";
  it.each([
    ["an invented table row", (doc) => doc.replace("| action | string | no |", "| email | string | yes | Contact email |\n| action | string | no |"), "request field 'email' in the Request Body table is not defined"],
    ["an invented nested table row", (doc) => doc.replace("| channel.from | one of", "| channel.region | string | no | Region |\n| channel.from | one of"), "request field 'channel.region' in the Request Body table is not defined"],
    ["a wrong enum value in the request JSON", (doc) => doc.replace('"action":"join"', '"action":"accept"'), "request example field 'action' uses 'accept', which is not one of its allowed values"],
    ["an invented value in a table's allowed values", (doc) => doc.replace("Allowed values: invite, join", "Allowed values: invite, join, leave"), "lists allowed values (invite, join, leave) that do not match the spec"],
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
      stderr: expect.stringContaining("last_reviewed must be a date in YYYY-MM-DD format")
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
