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
import * as yaml from "js-yaml";
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

// Numbers and numeric strings compared as text.
function numbersAsText(value) {
  if (Array.isArray(value)) return value.map(numbersAsText);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, numbersAsText(child)]));
  return typeof value === "number" ? String(value) : value;
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
    spec = yaml.load(await fs.readFile(path.join(fixturesDirectory, fixture), "utf8"), { schema: yaml.CORE_SCHEMA });

    await execFileAsync(process.execPath, [script("bootstrap-docs-repo.mjs"), docsRepo], { cwd: repoRoot });
    await fs.mkdir(path.join(docsRepo, "openapi"), { recursive: true });
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
    expect(validateOutput).toMatch(/^4 checks: (?!.*(?:skipped|failed)).*passed.*\.$/m);
  });

  it("writes docs that pass the markdownlint step of the CI workflow init writes", async () => {
    await expect(execFileAsync(process.execPath, [path.join(repoRoot, "node_modules", "markdownlint-cli", "markdownlint.js"), "--config", path.join(docsRepo, ".markdownlint.json"), path.join(docsRepo, "generated")])).resolves.toBeDefined();
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
      const responseSection = section(doc, "Response Example");
      const shown = JSON.parse(codeBlocks(responseSection, "json")[0]);
      if (/its schema does not define|so (?:it is|they are) shown as/.test(responseSection)) {
        // Fields the schema does not define are left out, and numeric strings
        // are shown as the numbers their schema defines; the doc says so.
        expect(numbersAsText(provided)).toMatchObject(numbersAsText(shown));
      } else {
        expect(shown).toEqual(provided);
      }
    }
  });

  it("documents every request body, without readOnly fields and with body enums", async () => {
    for (const { route, method, operation } of operationsOf(spec)) {
      const content = resolveRef(spec, operation.requestBody)?.content;
      if (!content) continue;
      const doc = await fs.readFile(path.join(docsRepo, "generated", "endpoints", `${slug(`${method}-${route}`)}.md`), "utf8");
      const body = section(doc, "Request Body");
      expect(body, `${method.toUpperCase()} ${route}`).not.toContain("Not applicable.");

      const schema = resolveRef(spec, (content["application/json"] || Object.values(content)[0])?.schema);
      const shapes = schema && !schema.properties && (schema.oneOf || schema.anyOf) ? (schema.oneOf || schema.anyOf).map((shape) => resolveRef(spec, shape)) : [schema];
      const curl = codeBlocks(section(doc, "Request Example"), "bash")[0] || "";
      const sent = curl.match(/-d '(.*)'$/m)?.[1];
      const sentKeys = sent ? Object.keys(JSON.parse(sent.replace(/'\\''/g, "'"))) : [];
      for (const shape of shapes) {
        for (const [name, property] of Object.entries(shape?.properties || {})) {
          const resolved = resolveRef(spec, property);
          if (resolved?.readOnly) {
            expect(sentKeys, `${route} sends readOnly ${name}`).not.toContain(name);
            expect(body, `${route} lists readOnly ${name}`).not.toMatch(new RegExp(`^\\| ${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} \\|`, "m"));
          } else if (Array.isArray(resolved?.enum)) {
            const row = body.split("\n").find((line) => line.startsWith(`| ${name} |`));
            expect(row, `${route} ${name} row`).toContain("Allowed values");
          }
        }
      }
    }
  });

  it("leaves writeOnly fields out of response examples", async () => {
    for (const { route, method, operation } of operationsOf(spec)) {
      const success = Object.entries(operation.responses || {}).find(([code]) => code.startsWith("2"));
      const schema = success && resolveRef(spec, resolveRef(spec, success[1])?.content?.["application/json"]?.schema);
      const writeOnly = Object.entries(schema?.properties || {}).filter(([, property]) => resolveRef(spec, property)?.writeOnly).map(([name]) => name);
      if (writeOnly.length === 0) continue;
      const doc = await fs.readFile(path.join(docsRepo, "generated", "endpoints", `${slug(`${method}-${route}`)}.md`), "utf8");
      const shown = JSON.parse(codeBlocks(section(doc, "Response Example"), "json")[0]);
      for (const name of writeOnly) {
        expect(Object.keys(shown), `${route} shows writeOnly ${name}`).not.toContain(name);
      }
    }
  });

  it("lists error responses from the spec with their descriptions", async () => {
    for (const { route, method, operation } of operationsOf(spec)) {
      const errors = Object.entries(operation.responses || {}).filter(([code]) => !code.startsWith("2"));
      if (errors.length === 0) continue;
      const doc = await fs.readFile(path.join(docsRepo, "generated", "endpoints", `${slug(`${method}-${route}`)}.md`), "utf8");
      const table = section(doc, "Error Codes");
      for (const [code, response] of errors) {
        const description = resolveRef(spec, response)?.description;
        expect(table).toContain(`| ${code} |`);
        if (description) {
          expect(table).not.toContain(`| ${code} | Needs SME input |`);
        }
      }
    }
  });

  it("runs the CI step the bootstrap wrote, and it passes", async () => {
    const workflow = await fs.readFile(path.join(docsRepo, ".github", "workflows", "docs-validate.yml"), "utf8");
    // The step that runs repodocs-ai validate (the workflow also has a lint step).
    const step = yaml.load(workflow).jobs.validate.steps.find((candidate) => /repodocs-ai#v/.test(candidate.run || "")).run;
    // The workflow runs a pinned release through npx; run this checkout instead.
    const pinned = step.match(/npx --yes github:SulagnaSasmal\/repodocs-ai#v[\d.]+/)?.[0];
    expect(pinned).toBeTruthy();
    const script = step.replace(pinned, `node "${path.join(repoRoot, "bin", "repodocs.mjs")}"`);
    const { stdout } = await execFileAsync("bash", ["-c", script], { cwd: docsRepo });
    expect(stdout).toMatch(/^4 checks: (?!.*(?:skipped|failed)).*passed.*\.$/m);
  });
});
