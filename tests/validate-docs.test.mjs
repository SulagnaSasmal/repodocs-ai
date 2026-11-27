import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = (name) => path.join(repoRoot, "scripts", name);

const petstoreSpec = `openapi: 3.0.0
info:
  version: 1.0.0
  title: Swagger Petstore
servers:
  - url: https://petstore.example/v2
paths:
  /pets:
    post:
      operationId: addPet
      requestBody:
        required: true
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/NewPet'
      responses:
        '200':
          description: pet response
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Pet'
  /pets/{id}:
    delete:
      operationId: deletePet
      parameters:
        - name: id
          in: path
          required: true
          schema:
            type: integer
            format: int64
      responses:
        '204':
          description: pet deleted
components:
  schemas:
    Pet:
      allOf:
        - $ref: '#/components/schemas/NewPet'
        - type: object
          required: [id]
          properties:
            id:
              type: integer
              format: int64
    NewPet:
      type: object
      required: [name]
      properties:
        name:
          type: string
        tag:
          type: string
`;

async function setUpPetstore() {
  const workDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "repodocs-validate-docs-"));
  const specsDirectory = path.join(workDirectory, "openapi");
  const docsDirectory = path.join(workDirectory, "generated");
  await fs.mkdir(specsDirectory);
  await fs.writeFile(path.join(specsDirectory, "petstore.yaml"), petstoreSpec, "utf8");
  await execFileAsync(process.execPath, [script("generate-openapi-docs.mjs"), path.join(specsDirectory, "petstore.yaml"), docsDirectory], { cwd: repoRoot });
  return { workDirectory, specsDirectory, docsDirectory };
}

describe("generate-openapi-docs against a third-party style spec", () => {
  it("adds no credentials when the spec defines no security", async () => {
    const { docsDirectory } = await setUpPetstore();
    const doc = await fs.readFile(path.join(docsDirectory, "endpoints", "post-pets.md"), "utf8");
    expect(doc).toContain("No authentication requirements are defined");
    expect(doc).not.toContain("Authorization: Bearer");
  });

  it("merges allOf schemas and reads required fields through $ref", async () => {
    const { docsDirectory } = await setUpPetstore();
    const doc = await fs.readFile(path.join(docsDirectory, "endpoints", "post-pets.md"), "utf8");
    expect(doc).toContain('"name": "value"');
    expect(doc).toContain('"id": 1');
    expect(doc).toContain("Fields not listed as required in the schema are optional.");
    expect(doc).not.toContain("does not declare which individual fields are required");
  });

  it("does not invent a body for a 204 response and titles endpoints from operationId", async () => {
    const { docsDirectory } = await setUpPetstore();
    const doc = await fs.readFile(path.join(docsDirectory, "endpoints", "delete-pets-id.md"), "utf8");
    expect(doc).toContain("This operation returns `204` with no response body.");
    expect(doc).not.toContain('"status": "204"');
    expect(doc).toContain("# Endpoint: Delete Pet");

    const overview = await fs.readFile(path.join(docsDirectory, "api-overview.md"), "utf8");
    expect(overview).toContain('title: "Swagger Petstore API Overview"');
  });
});

describe("validate-docs", () => {
  it("runs every check on the given docs and compares them with the given specs", async () => {
    const { docsDirectory, specsDirectory } = await setUpPetstore();
    const { stdout } = await execFileAsync(process.execPath, [script("validate-docs.mjs"), docsDirectory, "--specs", specsDirectory], { cwd: repoRoot });
    expect(stdout).toContain("[PASS] Frontmatter");
    expect(stdout).toContain("[PASS] OpenAPI examples");
    expect(stdout).toContain("Compared 2 endpoint docs in");
    expect(stdout).toContain("[WARN] Structure and quality");
    expect(stdout).toContain("4 of 4 checks passed; 1 with warnings to resolve before publishing.");
  });

  it("reports spec checks as skipped, not passed, when no specs are given", async () => {
    const { docsDirectory } = await setUpPetstore();
    const { stdout } = await execFileAsync(process.execPath, [script("validate-docs.mjs"), docsDirectory], { cwd: repoRoot });
    expect(stdout).toContain("[SKIP] OpenAPI examples");
    expect(stdout).toContain("[SKIP] API versions");
    expect(stdout).toContain("2 of 4 checks passed");
    expect(stdout).toContain("2 skipped and did not run");
  });

  it("fails a doc whose frontmatter breaks the schema", async () => {
    const docsDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "repodocs-bad-frontmatter-"));
    await fs.writeFile(
      path.join(docsDirectory, "feature.md"),
      '---\ntitle: "Pet tagging"\ndescription: "Tags"\nstatus: banana\n---\n# Pet tagging\n\n## Overview\n\nText.\n',
      "utf8"
    );
    await expect(
      execFileAsync(process.execPath, [script("validate-docs.mjs"), docsDirectory], { cwd: repoRoot })
    ).rejects.toMatchObject({ stdout: expect.stringContaining("invalid status 'banana'") });
  });

  it("asks for a docs folder instead of checking this repository", async () => {
    await expect(
      execFileAsync(process.execPath, [script("validate-docs.mjs")], { cwd: repoRoot })
    ).rejects.toMatchObject({ stderr: expect.stringContaining("Pass the docs folder to check") });
  });
});

describe("bootstrap-docs-repo CI setup", () => {
  it("writes a CI workflow and a CODEOWNERS file with no real owners", async () => {
    const target = path.join(await fs.mkdtemp(path.join(os.tmpdir(), "repodocs-bootstrap-")), "company-docs");
    await execFileAsync(process.execPath, [script("bootstrap-docs-repo.mjs"), target], { cwd: repoRoot });

    const workflow = await fs.readFile(path.join(target, ".github", "workflows", "docs-validate.yml"), "utf8");
    const { version } = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));
    expect(workflow).toContain(`npx --yes github:SulagnaSasmal/repodocs-ai#v${version} validate`);

    const codeowners = await fs.readFile(path.join(target, ".github", "CODEOWNERS"), "utf8");
    const activeRules = codeowners.split("\n").filter((line) => line.trim() && !line.trim().startsWith("#"));
    expect(activeRules).toEqual([]);
    expect(codeowners).not.toContain("@SulagnaSasmal");

    await expect(fs.access(path.join(target, ".markdownlint.json"))).resolves.toBeUndefined();
  });
});
