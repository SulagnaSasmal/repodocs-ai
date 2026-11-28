/**
 * Release-check probes (v1.2.5 retest)
 *
 * Generates docs from a small OpenAPI 3.1 spec that uses the features the
 * v1.2.5 retest found gaps in: 3.1 examples and type arrays, multipart
 * uploads, an operation with no success response, credential headers with no
 * security scheme, and more than one server. Then it breaks copies the way
 * the retest did and checks that each break is caught, and that the legitimate
 * variations it found are still accepted.
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
const catalogSpec = path.join(repoRoot, "tests", "fixtures", "probes", "catalog-31.yaml");

let workDirectory;
let specsDirectory;
let generatedDirectory;

async function run(name, args) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [script(name), ...args]);
    return { failed: false, output: `${stdout}${stderr}` };
  } catch (error) {
    return { failed: true, output: `${error.stdout}${error.stderr}` };
  }
}

const checkOpenApi = (docs) => run("validate-openapi-examples.mjs", [docs, "--specs", specsDirectory]);
const checkQuality = (docs) => run("validate-doc-quality.mjs", [docs]);

async function brokenCopy(file, edit) {
  const target = await fs.mkdtemp(path.join(workDirectory, "probe-"));
  await fs.cp(generatedDirectory, target, { recursive: true });
  const filePath = path.join(target, file);
  const before = await fs.readFile(filePath, "utf8");
  const after = edit(before);
  expect(after, "the probe edit must change the doc").not.toBe(before);
  await fs.writeFile(filePath, after, "utf8");
  return target;
}

async function handWritten(name, body) {
  const target = await fs.mkdtemp(path.join(workDirectory, "page-"));
  await fs.writeFile(
    path.join(target, name),
    `---\ntitle: "Catalog guide"\ndescription: "How to call the catalog service"\nservice: "catalog"\ncomponent: "api"\nowner: "catalog-team"\napi_version: "2.0"\nstatus: draft\ndependencies: []\nlast_reviewed: 2026-11-01\nsecurity_impact: low\n---\n${body}`,
    "utf8"
  );
  return target;
}

beforeAll(async () => {
  workDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "repodocs-release-probes-"));
  specsDirectory = path.join(workDirectory, "openapi");
  generatedDirectory = path.join(workDirectory, "generated");
  await fs.mkdir(specsDirectory);
  await fs.copyFile(catalogSpec, path.join(specsDirectory, "catalog.yaml"));
  await execFileAsync(process.execPath, [script("generate-openapi-docs.mjs"), path.join(specsDirectory, "catalog.yaml"), generatedDirectory, "--owner", "catalog-team"]);
});

describe("docs generated from an OpenAPI 3.1 spec", () => {
  const read = (file) => fs.readFile(path.join(generatedDirectory, file), "utf8");

  it("pass the OpenAPI check as generated", async () => {
    expect(await checkOpenApi(generatedDirectory)).toMatchObject({ failed: false });
  });

  it("use 3.1 examples, type arrays and formats in the response example", async () => {
    const doc = await read("endpoints/get-items.md");
    expect(doc).toContain('"id": 42');
    expect(doc).toContain('"name": "value"');
    expect(doc).toContain('"created": "2026-01-01T00:00:00Z"');
    expect(doc).toContain('"contact": "user@example.com"');
  });

  it("send a multipart file with -F and text fields with --form-string", async () => {
    const doc = await read("endpoints/post-uploads.md");
    expect(doc).toContain('-F "file=@<file>"');
    expect(doc).toContain('--form-string "title=value"');
  });

  it("say so when an operation has no success response", async () => {
    expect(await read("endpoints/delete-items-itemid.md")).toContain("The spec defines no success (2xx) response for this operation.");
  });

  it("point out credential headers when the spec defines no security scheme", async () => {
    expect(await read("endpoints/get-items.md")).toContain("takes credential-like headers: `Api-Key`");
  });

  it("list the other servers, with their variables filled in", async () => {
    expect(await read("api-overview.md")).toContain("- `https://sandbox.example.com/v1`");
  });
});

describe("breaks found by the v1.2.5 retest", () => {
  it.each([
    ["a multipart example that uploads a real local file", "endpoints/post-uploads.md", (doc) => doc.replace("@<file>", "@/etc/passwd"), "uploads the local file '/etc/passwd'"],
    ["an unknown multipart field", "endpoints/post-uploads.md", (doc) => doc.replace('--form-string "title=value"', '--form-string "caption=value"'), "caption"],
    ["a second Response Example section", "endpoints/get-items.md", (doc) => doc.replace("## Summary\n", "## Summary\n\n## Response Example\n\n```json\n{\"id\": 1}\n```\n"), 'has 2 "## Response Example" sections'],
    ["a wrong type inside a ~~~ fence", "endpoints/get-items.md", (doc) => doc.replace("```json\n{\n  \"id\": 42", "~~~json\n{\n  \"id\": \"forty-two\"").replace("}\n```\n\n## Error Codes", "}\n~~~\n\n## Error Codes"), "id"],
    ["a Required value that is not yes or no", "endpoints/get-items.md", (doc) => doc.replace("| Api-Key | string | yes |", "| Api-Key | string | maybe |"), "maybe"],
    ["a renamed placeholder in the Endpoint URL", "endpoints/delete-items-itemid.md", (doc) => doc.replace(/(URL:[^\n]*)\{itemId\}/, "$1{id}"), "{id}"],
    ["an auth header the spec never mentions", "endpoints/get-items.md", (doc) => doc.replace("takes credential-like headers: `Api-Key`.", "takes credential-like headers: `Api-Key` and the header `X-Secret-Token`."), "X-Secret-Token"],
    ["-XPOST on a GET operation", "endpoints/get-items.md", (doc) => doc.replace("curl -X GET", "curl -XPOST"), "POST"],
    ["a request body on an operation without one", "endpoints/get-items.md", (doc) => doc.replace('-H "Api-Key: <Api-Key>"', "-H \"Api-Key: <Api-Key>\" \\\n  -d '{}'"), "body"]
  ])("catches %s", async (name, file, edit, expected) => {
    const result = await checkOpenApi(await brokenCopy(file, edit));
    expect(result.failed).toBe(true);
    expect(result.output).toContain(expected);
  });

  it("catches a guide whose curl calls a path the spec does not define", async () => {
    const docs = await handWritten("guide.md", "# Catalog guide\n\n## Listing items\n\n```bash\ncurl \"https://api.example.com/v1/products\" -H \"Api-Key: $CATALOG_KEY\"\n```\n");
    const result = await checkOpenApi(docs);
    expect(result.failed).toBe(true);
    expect(result.output).toContain("a curl example calls /products, which catalog.yaml does not define");
  });

  it("catches a guide whose curl uses a method the path does not have", async () => {
    const docs = await handWritten("guide.md", "# Catalog guide\n\n## Removing items\n\n```bash\ncurl -X DELETE \"https://api.example.com/v1/items\"\n```\n");
    expect((await checkOpenApi(docs)).output).toContain("defines no DELETE for that path");
  });

  it("says when a Swagger 2.0 file was not checked", async () => {
    const specs = await fs.mkdtemp(path.join(workDirectory, "specs-"));
    await fs.copyFile(catalogSpec, path.join(specs, "catalog.yaml"));
    await fs.writeFile(path.join(specs, "legacy.yaml"), 'swagger: "2.0"\ninfo: {title: Legacy, version: "1"}\npaths: {}\n', "utf8");
    const result = await run("validate-openapi-examples.mjs", [generatedDirectory, "--specs", specs]);
    expect(result.output).toContain("legacy.yaml is Swagger 2.0, not OpenAPI 3.x, so it was not checked");
  });
});

describe("legitimate variations the v1.2.5 retest found", () => {
  it.each([
    ["Required written as mandatory", "endpoints/get-items.md", (doc) => doc.replace("| Api-Key | string | yes |", "| Api-Key | string | mandatory |")],
    ["Required written as true", "endpoints/get-items.md", (doc) => doc.replace("| Api-Key | string | yes |", "| Api-Key | string | true |")],
    ["a header the spec describes but leaves off this operation", "endpoints/get-items.md", (doc) => doc.replace("takes credential-like headers: `Api-Key`.", "takes credential-like headers: `Api-Key` and `Api-Username`.")]
  ])("accepts %s", async (name, file, edit) => {
    expect(await checkOpenApi(await brokenCopy(file, edit))).toMatchObject({ failed: false });
  });

  it("warns, but does not fail, on an auth header the spec uses elsewhere", async () => {
    const docs = await brokenCopy("endpoints/get-items.md", (doc) => doc.replace("takes credential-like headers: `Api-Key`.", "takes credential-like headers: `Api-Key` and `Api-Username`."));
    expect((await checkOpenApi(docs)).output).toContain("which the spec uses elsewhere but does not declare on GET /items");
  });

  it("accepts a guide whose curl calls a defined path", async () => {
    const docs = await handWritten("guide.md", "# Catalog guide\n\n## Listing items\n\n```bash\ncurl \"https://sandbox.example.com/v1/items?limit=5\" -H \"Api-Key: $CATALOG_KEY\"\n```\n");
    expect(await checkOpenApi(docs)).toMatchObject({ failed: false });
  });
});

describe("quality checks added after the v1.2.5 retest", () => {
  it.each([
    ["a script link split by a newline", '<a href="java\nscript:alert(1)">docs</a>', "script"],
    ["an svg onload handler", '<svg onload="alert(1)"></svg>', "on"],
    ["a formaction script link", '<button formaction="javascript:alert(1)">Go</button>', "script"],
    ["a script autolink", "Open <javascript:alert(1)> to start.", "script"],
    ["a style url()", '<div style="background: url(https://tracker.example/p.gif)">x</div>', "style attribute that loads a url"],
    ["a mixed-case Tbd", "Rate limits: Tbd.", "placeholder"],
    ["a <your-...> placeholder in prose", "Set the key to <your-api-key> first.", "placeholder"],
    ["a {{...}} placeholder in prose", "Call the service as {{service_user}}.", "placeholder"]
  ])("fails %s", async (name, line, expected) => {
    const result = await checkQuality(await handWritten("page.md", `# Catalog guide\n\n## Setup\n\n${line}\n`));
    expect(result.failed).toBe(true);
    expect(result.output.toLowerCase()).toContain(expected.toLowerCase());
  });

  it("allows <your-...> and {{...}} inside code blocks", async () => {
    const result = await checkQuality(await handWritten("page.md", "# Catalog guide\n\n## Setup\n\n```bash\nexport KEY=<your-api-key>\necho {{service_user}}\n```\n"));
    expect(result.failed).toBe(false);
  });

  it.each([
    ["a heading with no space after #", "##Setup\n\nText.", "space"],
    ["a table whose separator has the wrong column count", "| a | b |\n| --- |\n| 1 | 2 |", "separator row"],
    ["an unclosed HTML comment", "<!-- draft notes\n\nText.", "comment"]
  ])("fails broken Markdown: %s", async (name, block, expected) => {
    const result = await checkQuality(await handWritten("page.md", `# Catalog guide\n\n## Setup\n\nIntro.\n\n${block}\n`));
    expect(result.failed).toBe(true);
    expect(result.output.toLowerCase()).toContain(expected);
  });

  it("warns when a page has no # title heading", async () => {
    const result = await checkQuality(await handWritten("page.md", "## Setup\n\nText.\n"));
    expect(result.output).toContain("no # title heading");
  });
});
