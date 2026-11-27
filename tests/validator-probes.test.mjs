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
