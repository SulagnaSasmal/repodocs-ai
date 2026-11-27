/**
 * Adopter path tests
 *
 * Runs the path a new user follows, end to end, against OpenAPI specs that
 * other people wrote (tests/fixtures/third-party):
 *   bootstrap a docs repo -> add the spec -> generate docs -> validate:docs
 *   -> run the CI step the bootstrap wrote
 * Then checks the generated docs against the spec, so a check that "passes"
 * cannot hide output that is wrong.
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";
import { beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const fixturesDirectory = path.join(repoRoot, "tests", "fixtures", "third-party");
const script = (name) => path.join(repoRoot, "scripts", name);
const httpMethods = ["get", "put", "post", "delete", "patch", "head", "options"];

function resolveRef(spec, value) {
  let current = value;
  for (let depth = 0; current?.$ref && depth < 20; depth += 1) {
    current = current.$ref.slice(2).split("/").reduce((node, key) => node?.[key], spec);
  }
  return current;
}

function requiredFields(spec, schema) {
  const resolved = resolveRef(spec, schema);
  if (!resolved) return [];
  const own = resolved.required || [];
  const fromAllOf = (resolved.allOf || []).flatMap((part) => requiredFields(spec, part));
  return [...new Set([...own, ...fromAllOf])];
}

function operationsOf(spec) {
  const operations = [];
  for (const [route, pathItem] of Object.entries(spec.paths || {})) {
    for (const method of httpMethods) {
      if (pathItem?.[method]) {
        operations.push({ route, method, operation: pathItem[method] });
      }
    }
  }
  return operations;
}

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "endpoint";
}

function section(doc, heading) {
  const start = doc.indexOf(`## ${heading}`);
  if (start === -1) return "";
  const next = doc.indexOf("\n## ", start + 3);
  return doc.slice(start, next === -1 ? undefined : next);
}

function codeBlocks(text, lang) {
  return [...text.matchAll(new RegExp("```" + lang + "\\n([\\s\\S]*?)\\n```", "g"))].map((match) => match[1]);
}

const fixtures = (await fs.readdir(fixturesDirectory)).filter((file) => file.endsWith(".yaml"));

describe.each(fixtures)("adopter path with %s", (fixture) => {
  let workDirectory;
  let docsRepo;
  let spec;
  let validateOutput;

  beforeAll(async () => {
    workDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "repodocs-adopter-"));
    docsRepo = path.join(workDirectory, "docs-repo");
    spec = yaml.load(await fs.readFile(path.join(fixturesDirectory, fixture), "utf8"));

    await execFileAsync(process.execPath, [script("bootstrap-docs-repo.mjs"), docsRepo], { cwd: repoRoot });
    await fs.mkdir(path.join(docsRepo, "openapi"));
    await fs.copyFile(path.join(fixturesDirectory, fixture), path.join(docsRepo, "openapi", fixture));
    await execFileAsync(process.execPath, [script("generate-openapi-docs.mjs"), path.join(docsRepo, "openapi", fixture), path.join(docsRepo, "generated")], { cwd: repoRoot });

    const result = await execFileAsync(
      process.execPath,
      [script("validate-docs.mjs"), path.join(docsRepo, "generated"), "--specs", path.join(docsRepo, "openapi")],
      { cwd: repoRoot }
    );
    validateOutput = result.stdout;
  });

  it("passes validate:docs with every check run and none skipped or failed", () => {
    expect(validateOutput).not.toContain("[FAIL]");
    expect(validateOutput).not.toContain("[SKIP]");
    expect(validateOutput).toMatch(/4 of 4 checks passed/);
  });

  it("writes one endpoint doc per operation in the spec", async () => {
    const files = await fs.readdir(path.join(docsRepo, "generated", "endpoints"));
    expect(files.length).toBe(operationsOf(spec).length);
  });

  it("keeps every JSON example valid and every server variable resolved", async () => {
    for (const { route, method } of operationsOf(spec)) {
      const doc = await fs.readFile(path.join(docsRepo, "generated", "endpoints", `${slug(`${method}-${route}`)}.md`), "utf8");
      for (const block of codeBlocks(doc, "json")) {
        expect(() => JSON.parse(block)).not.toThrow();
      }
      const curl = codeBlocks(section(doc, "Request Example"), "bash")[0] || "";
      const url = curl.match(/curl -X \w+ "([^"]+)"/)?.[1] || "";
      expect(url).toMatch(/^https?:\/\//);
      expect(new URL(url).host).not.toMatch(/[{}]/);
    }
  });

  it("adds credentials only when the spec defines security", async () => {
    for (const { route, method, operation } of operationsOf(spec)) {
      const doc = await fs.readFile(path.join(docsRepo, "generated", "endpoints", `${slug(`${method}-${route}`)}.md`), "utf8");
      const curl = codeBlocks(section(doc, "Request Example"), "bash")[0] || "";
      const security = operation.security ?? spec.security ?? [];
      if (security.length === 0) {
        expect(curl).not.toMatch(/Authorization: Bearer|-u "|<api-key>/);
      }
    }
  });

  it("includes every required request field in the request example", async () => {
    for (const { route, method, operation } of operationsOf(spec)) {
      const content = resolveRef(spec, operation.requestBody)?.content;
      if (!content) continue;
      const media = content["application/json"] || content["application/x-www-form-urlencoded"] || Object.values(content)[0];
      const doc = await fs.readFile(path.join(docsRepo, "generated", "endpoints", `${slug(`${method}-${route}`)}.md`), "utf8");
      const curl = codeBlocks(section(doc, "Request Example"), "bash")[0] || "";
      for (const field of requiredFields(spec, media?.schema)) {
        expect(curl, `${method.toUpperCase()} ${route} is missing required field ${field}`).toContain(field);
      }
    }
  });

  it("describes responses with no body instead of inventing one", async () => {
    for (const { route, method, operation } of operationsOf(spec)) {
      const success = Object.entries(operation.responses || {}).find(([code]) => code.startsWith("2"));
      const response = success && resolveRef(spec, success[1]);
      if (!response || response.content) continue;
      const doc = await fs.readFile(path.join(docsRepo, "generated", "endpoints", `${slug(`${method}-${route}`)}.md`), "utf8");
      expect(section(doc, "Response Example")).toContain("with no response body");
    }
  });

  it("uses examples the spec provides instead of placeholders", async () => {
    for (const { route, method, operation } of operationsOf(spec)) {
      const success = Object.entries(operation.responses || {}).find(([code]) => code.startsWith("2"));
      const media = success && resolveRef(spec, success[1])?.content?.["application/json"];
      const provided = media?.example ?? (media?.examples ? resolveRef(spec, Object.values(media.examples)[0])?.value : undefined);
      if (provided === undefined) continue;
      const doc = await fs.readFile(path.join(docsRepo, "generated", "endpoints", `${slug(`${method}-${route}`)}.md`), "utf8");
      const shown = JSON.parse(codeBlocks(section(doc, "Response Example"), "json")[0]);
      expect(shown).toEqual(provided);
    }
  });

  it("runs the CI step the bootstrap wrote, and it passes", async () => {
    const workflow = await fs.readFile(path.join(docsRepo, ".github", "workflows", "docs-validate.yml"), "utf8");
    const step = workflow.split("run: |\n").pop().split("\n").map((line) => line.replace(/^ {10}/, "")).join("\n");
    // The workflow checks out the docs next to RepoDocs AI as ../docs-repo.
    const script = step.replaceAll("../docs-repo", docsRepo);
    const { stdout } = await execFileAsync("bash", ["-c", script], { cwd: repoRoot });
    expect(stdout).toMatch(/4 of 4 checks passed/);
  });
});
