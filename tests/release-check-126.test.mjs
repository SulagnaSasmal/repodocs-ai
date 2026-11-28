/**
 * Release-check probes (v1.2.6 retest)
 *
 * The v1.2.6 retest used the Velo Payments API (100 operations, OAuth2 and
 * Basic, readOnly fields, CSV downloads) and a small synthetic spec for the
 * features Velo lacks (cookies, writeOnly, form bodies, oneOf, OAuth scopes,
 * callbacks, Link headers). These tests generate docs from both, then break
 * copies the way the retest did and check each break is caught, and that the
 * legitimate edits it found are accepted.
 */

import { execFile, spawnSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const script = (name) => path.join(repoRoot, "scripts", name);
const fixtures = {
  velo: path.join(repoRoot, "tests", "fixtures", "third-party", "velo-payments.yaml"),
  ledger: path.join(repoRoot, "tests", "fixtures", "probes", "ledger-features.json")
};

let work;
const bases = {};

async function run(name, args, cwd = repoRoot) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [script(name), ...args], { cwd, maxBuffer: 64 * 1024 * 1024 });
    return { failed: false, output: `${stdout}${stderr}` };
  } catch (error) {
    return { failed: true, output: `${error.stdout}${error.stderr}` };
  }
}

async function makeBase(name) {
  const root = path.join(work, name);
  await fs.mkdir(path.join(root, "openapi"), { recursive: true });
  const specFile = path.join(root, "openapi", path.basename(fixtures[name]));
  await fs.copyFile(fixtures[name], specFile);
  await execFileAsync(process.execPath, [script("generate-openapi-docs.mjs"), specFile, path.join(root, "generated"), "--owner", "payments-eng"]);
  return root;
}

// A copy of a base with one edit; returns its folder.
async function edited(base, file, edit) {
  const target = await fs.mkdtemp(path.join(work, "case-"));
  await fs.cp(bases[base], target, { recursive: true });
  const filePath = path.join(target, file);
  const before = await fs.readFile(filePath, "utf8").catch(() => "");
  const after = edit(before);
  expect(after, `the edit to ${file} must change it`).not.toBe(before);
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, after, "utf8");
  return target;
}

const openapi = async (root) => {
  const docs = path.join(root, "docs");
  const hasDocs = await fs.access(docs).then(() => true, () => false);
  return run("validate-openapi-examples.mjs", [path.join(root, "generated"), ...(hasDocs ? [docs] : []), "--specs", path.join(root, "openapi")]);
};
const quality = (root) => run("validate-doc-quality.mjs", [path.join(root, "generated")]);
const read = (base, file) => fs.readFile(path.join(bases[base], "generated", file), "utf8");
// A function replacement, so "$`" or "$&" in the new text is taken literally.
const replace = (from, to) => (text) => text.replace(from, () => to);
const guide = (body) => () => `---\ntitle: "Getting started"\ndescription: "First calls to the ledger"\nservice: "ledger"\ncomponent: "guide"\nowner: "payments-eng"\napi_version: "3.4.0"\nstatus: draft\ndependencies: []\nlast_reviewed: 2026-11-01\nsecurity_impact: low\n---\n# Getting started\n\n## First call\n\n${body}\n`;

beforeAll(async () => {
  work = await fs.mkdtemp(path.join(os.tmpdir(), "repodocs-check-126-"));
  bases.velo = await makeBase("velo");
  bases.ledger = await makeBase("ledger");
}, 120000);

describe("generated docs (v1.2.6 retest)", () => {
  it.each(["velo", "ledger"])("from the %s spec pass every check and the markdownlint step", async (base) => {
    const result = await run("validate-docs.mjs", [path.join(bases[base], "generated"), "--specs", path.join(bases[base], "openapi")]);
    expect(result.output).not.toContain("[FAIL]");
    const lint = spawnSync(process.execPath, [path.join(repoRoot, "node_modules", "markdownlint-cli", "markdownlint.js"), "--config", path.join(repoRoot, ".markdownlint.json"), path.join(bases[base], "generated")], { encoding: "utf8" });
    expect(lint.status, lint.stderr).toBe(0);
  });

  it("corrects values in the spec's own examples that break its schema, and says so", async () => {
    const doc = await read("velo", "endpoints/get-v2-users.md");
    expect(doc).toContain("Some values in the spec's own example break its own schema");
    expect(doc).toContain("replaced here with values that fit; confirm with an SME");
  });

  it("leaves readOnly fields out of request examples, at every depth, and says so", async () => {
    const doc = await read("velo", "endpoints/post-v3-payees.md");
    expect(doc).toContain("sends readOnly fields `payees[].payeeId`, `payees[].payorRefs`, which the server sets");
    expect(doc).not.toMatch(/-d '[^']*"payeeId"/);
  });

  it("documents a CSV download as text and asks for it with Accept", async () => {
    const doc = await read("velo", "endpoints/get-v3-paymentaudit-transactions.md");
    expect(doc).toContain('-H "Accept: application/csv"');
    expect(doc).toContain("The response body is `application/csv`.");
  });

  it("names every scheme in the overview, and the operations that need none", async () => {
    const doc = await read("velo", "api-overview.md");
    expect(doc).toContain("- HTTP Basic authentication.");
    expect(doc).toContain("each endpoint's Authentication Requirements section says which one it needs");
    expect(doc).toContain("4 operations need no authentication");
  });

  it("documents cookie parameters and sends them with the cookie credential", async () => {
    const doc = await read("ledger", "endpoints/get-session.md");
    expect(doc).toContain("## Cookie Parameters");
    expect(doc).toContain('--cookie "ledger_session=<api-key>; csrf_token=c5f1; theme=light"');
  });

  it("writes deepObject parameters so curl does not read the brackets as a range", async () => {
    expect(await read("ledger", "endpoints/get-payments.md")).toContain("filter%5Bcurrency%5D=USD");
  });

  it("lists response headers, callbacks and alternate content types", async () => {
    expect(await read("ledger", "endpoints/get-payments.md")).toContain("Response headers:\n\n- `Link`");
    expect(await read("ledger", "endpoints/post-payments.md")).toContain("## Callbacks\n\n- `paymentSettled`: the API sends `POST` to `{$request.body#/callbackUrl}`.");
    expect(await read("ledger", "endpoints/get-reports-reportid.md")).toContain("The response can also be `application/pdf`; the example shows `text/csv`.");
  });

  it("writes OAuth scopes as code, which the check reads back", async () => {
    expect(await read("ledger", "endpoints/delete-payments-paymentid.md")).toContain("Use OAuth 2.0 (scopes: `ledger:write`, `ledger:admin`).");
  });
});

describe("generator safety (v1.2.6 retest)", () => {
  it("gives routes that make the same file name their own files", async () => {
    const root = await fs.mkdtemp(path.join(work, "collide-"));
    const spec = { openapi: "3.0.3", info: { title: "Collide", version: "1" }, paths: { "/a-b": { get: { responses: { 200: { description: "ok" } } } }, "/a/b": { get: { responses: { 200: { description: "ok" } } } } } };
    await fs.writeFile(path.join(root, "spec.json"), JSON.stringify(spec));
    const result = spawnSync(process.execPath, [script("generate-openapi-docs.mjs"), path.join(root, "spec.json"), path.join(root, "out")], { encoding: "utf8" });
    expect(result.stderr).toContain("writing it as get-a-b-2.md");
    expect((await fs.readdir(path.join(root, "out", "endpoints"))).sort()).toEqual(["get-a-b-2.md", "get-a-b.md"]);
  });

  it("refuses to write through a symbolic link in the output folder", async () => {
    const root = await fs.mkdtemp(path.join(work, "link-"));
    const elsewhere = await fs.mkdtemp(path.join(work, "elsewhere-"));
    await fs.mkdir(path.join(root, "out"));
    await fs.symlink(elsewhere, path.join(root, "out", "endpoints"));
    const result = spawnSync(process.execPath, [script("generate-openapi-docs.mjs"), fixtures.ledger, path.join(root, "out")], { encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("is a symbolic link; refusing to write through it");
    expect(await fs.readdir(elsewhere)).toEqual([]);
  });

  it("refuses a YAML alias bomb before expanding it", async () => {
    const root = await fs.mkdtemp(path.join(work, "bomb-"));
    let yamlText = 'openapi: 3.0.3\ninfo: {title: bomb, version: "1"}\npaths: {}\nx-a: &a ["lol","lol","lol","lol","lol","lol","lol","lol","lol"]\n';
    let previous = "a";
    for (const name of "bcdefghi") {
      yamlText += `x-${name}: &${name} [${Array(9).fill(`*${previous}`).join(",")}]\n`;
      previous = name;
    }
    await fs.writeFile(path.join(root, "spec.yaml"), yamlText);
    const started = Date.now();
    const result = spawnSync(process.execPath, [script("generate-openapi-docs.mjs"), path.join(root, "spec.yaml"), path.join(root, "out")], { encoding: "utf8", timeout: 30000 });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("YAML aliases");
    expect(Date.now() - started).toBeLessThan(10000);
  });

  it("quotes ! in form fields so shell history expansion cannot rewrite them", async () => {
    const root = await fs.mkdtemp(path.join(work, "bang-"));
    const spec = JSON.parse(await fs.readFile(fixtures.ledger, "utf8"));
    const form = spec.paths["/oauth/token"].post.requestBody.content["application/x-www-form-urlencoded"];
    form.example = { grant_type: "client_credentials", scope: "!-1" };
    await fs.writeFile(path.join(root, "spec.json"), JSON.stringify(spec));
    await execFileAsync(process.execPath, [script("generate-openapi-docs.mjs"), path.join(root, "spec.json"), path.join(root, "out")]);
    const doc = await fs.readFile(path.join(root, "out", "endpoints", "post-oauth-token.md"), "utf8");
    expect(doc).toContain(`--data-urlencode "scope="'!'"-1"`);
  });

  it("keeps a long run of backticks or tags from slowing the checks down", async () => {
    const root = await edited("ledger", "generated/endpoints/get-session.md", replace("## Summary\n", `## Summary\n\n${"`".repeat(50000)}\n\n${"<a ".repeat(30000)}\n\n`));
    const started = Date.now();
    await quality(root);
    await openapi(root);
    expect(Date.now() - started).toBeLessThan(8000);
  });
});

describe("breaks found by the v1.2.6 retest", () => {
  const payments = "generated/endpoints/post-payments.md";
  const accounts = "generated/endpoints/post-accounts.md";
  const session = "generated/endpoints/get-session.md";
  const token = "generated/endpoints/post-oauth-token.md";
  const cancel = "generated/endpoints/delete-payments-paymentid.md";
  const list = "generated/endpoints/get-payments.md";
  it.each([
    ["null for a field that does not allow it", payments, replace('"currency":"USD"', '"currency":null'), "is null, but the spec does not allow null"],
    ["a date-time on a day that does not exist", payments, replace('"createdAt": "2026-01-02T03:04:05Z"', '"createdAt": "2026-02-30T03:04:05Z"'), "not a valid date-time"],
    ["a date-time with no time-zone offset", payments, replace('"createdAt": "2026-01-02T03:04:05Z"', '"createdAt": "2026-01-02T03:04:05"'), "not a valid date-time"],
    ["a readOnly field sent inside a oneOf option", payments, replace('"cvv":"123"}', '"cvv":"123","last4":"4242"}'), "last4"],
    ["a writeOnly field returned in a nested object", accounts, replace('"email": "a@acme.example"\n', '"email": "a@acme.example",\n    "password": "x"\n'), "which is writeOnly"],
    ["a value that breaks a pattern", payments, replace('"cvv":"123"', '"cvv":"12a"'), "does not match the spec's pattern"],
    ["a request body that is an array, not an object", accounts, (doc) => doc.replace(/-d '\{.*\}'/, "-d '[1,2]'"), "is an array, but the spec says object"],
    ["a comment line before the curl, hiding a wrong method", cancel, replace('```bash\ncurl -X DELETE', '```bash\n# Cancel it\ncurl -X GET'), "sends GET"],
    ["a shell prompt before the curl, hiding a wrong method", cancel, replace('```bash\ncurl -X DELETE', '```bash\n$ curl -X GET'), "sends GET"],
    ["a renamed Request Example section", cancel, replace("## Request Example", "## Example Request"), "name the section '## Request Example'"],
    ["a renamed Error Codes section", cancel, replace("## Error Codes", "## Errors"), "name the section '## Error Codes'"],
    ["a second curl with the wrong method", cancel, replace("## Response Example", '```bash\ncurl -X GET "https://api.ledger.example.com/v3/payments/pay_9f8e7d" -H "Authorization: Bearer <token>"\n```\n\n## Response Example'), "curl command 2 in the Request Example sends GET"],
    ["a curl in another section calling an undefined path", cancel, (doc) => `${doc}\n## Additional Examples\n\n\`\`\`bash\ncurl -X DELETE "https://api.ledger.example.com/v3/payment/pay_1"\n\`\`\`\n`, "which ledger-features.json does not define"],
    ["a cookie outside its enum", session, replace("theme=light", "theme=blue"), "cookie 'theme' uses 'blue'"],
    ["an unknown cookie", session, replace("theme=light", "theme=light; tracking=1"), "sends cookie 'tracking'"],
    ["a required cookie left out", session, replace("; csrf_token=c5f1", ""), "leaves out required cookie 'csrf_token'"],
    ["a form field outside its enum", token, replace("grant_type=client_credentials", "grant_type=password"), "form field 'grant_type' uses 'password'"],
    ["an unknown form field", token, replace('--data-urlencode "refresh_token=value"', '--data-urlencode "refresh_token=value" \\\n  --data-urlencode "colour=red"'), "form field 'colour'"],
    ["a required form field left out", token, replace('  --data-urlencode "grant_type=client_credentials" \\\n', ""), "leaves out required form field 'grant_type'"],
    ["an invented OAuth scope", list, replace("(scopes: `ledger:read`)", "(scopes: `ledger:superuser`)"), "lists the OAuth scope ledger:superuser"],
    ["a missing OAuth scope", cancel, replace("(scopes: `ledger:write`, `ledger:admin`)", "(scopes: `ledger:write`)"), "leaves out the OAuth scope ledger:admin"],
    ["a path value that breaks its pattern", cancel, replace("/payments/pay_9f8e7d", "/payments/9f8e7d"), "path parameter 'paymentId'"],
    ["a header longer than its maximum", payments, replace("Idempotency-Key: k-123", `Idempotency-Key: ${"k".repeat(70)}`), "header 'Idempotency-Key'"],
    ["a lowercase method", cancel, replace("curl -X DELETE", "curl -X delete"), "HTTP methods are case-sensitive"],
    ["the wrong Authorization word", cancel, replace("Authorization: Bearer <token>", "Authorization: Token <token>"), "'Authorization: Token ...'"],
    ["an empty Authorization header", cancel, replace("Authorization: Bearer <token>", "Authorization: "), "empty Authorization header"],
    ["a required nested body row removed", accounts, replace("| owner.email | string | yes | Needs SME input for field semantics. Format: email |\n", ""), "required request field 'owner.email'"],
    ["a wrong maximum length note", accounts, replace("Maximum length: 80", "Maximum length: 800"), "Maximum length: 800"],
    ["a oneOf field typed as string", payments, replace("| method | one of: object |", "| method | string |"), "documented as string, but the spec allows object"],
    ["an error status shown as the success example", payments, replace("Status: `201`", "Status: `400`"), "error bodies belong under Error Codes"],
    ["a JSON body shown for a 204", cancel, replace("This operation returns `204` with no response body.", "Status: `204`\n\n```json\n{\"ok\": true}\n```"), "defines no body for that response"],
    ["a CSV response shown as JSON", "generated/endpoints/get-reports-reportid.md", (doc) => doc.replace(/```text\n[\s\S]*?\n```/, '```json\n{"id": "pay_1"}\n```'), "not JSON"],
    ["a success code in Error Codes", cancel, replace("| 404 | Not found |", "| 404 | Not found |\n| 204 | Done |"), "which is a success response"],
    ["a fake server in the overview", "generated/api-overview.md", replace("## Versioning Strategy", "Also: `https://evil.example/v3`\n\n## Versioning Strategy"), "is not a server in the spec"]
  ])("catches %s", async (name, file, edit, expected) => {
    const result = await openapi(await edited("ledger", file, edit));
    expect(result.failed, result.output).toBe(true);
    expect(result.output).toContain(expected);
  });

  it.each([
    ["a query value above its maximum", 'curl "https://api.ledger.example.com/v3/payments?limit=1000" -H "Authorization: Bearer <token>"', "query parameter 'limit'"],
    ["an unknown query parameter", 'curl "https://api.ledger.example.com/v3/payments?colour=red" -H "Authorization: Bearer <token>"', "uses query parameter 'colour'"],
    ["missing credentials", 'curl "https://api.ledger.example.com/v3/payments"', "sends no credentials"],
    ["Basic credentials where the spec uses OAuth", 'curl -u "a:b" "https://api.ledger.example.com/v3/payments"', "sends Basic credentials"],
    ["a JSON body of the wrong type", `curl -X POST "https://api.ledger.example.com/v3/accounts" -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d '{"kind":"business","name":7,"owner":{"email":"a@b.example"}}'`, "sends a body in which"],
    ["a server variable and a wrong path", 'curl "$BASE_URL/payment" -H "Authorization: Bearer <token>"', "calls /payment"]
  ])("catches a guide curl with %s", async (name, command, expected) => {
    const result = await openapi(await edited("ledger", "docs/getting-started.md", guide(`\`\`\`bash\n${command}\n\`\`\``)));
    expect(result.failed, result.output).toBe(true);
    expect(result.output).toContain(expected);
  });

  it.each([
    ["wget to an undefined path", "```bash\nwget \"https://api.ledger.example.com/v3/payment/1\"\n```", "a code example calls /v3/payment/1".replace("/v3", "")],
    ["Python requests with an undefined method", "```python\nrequests.put(\"https://api.ledger.example.com/v3/payments\")\n```", "defines no PUT for that path"]
  ])("catches %s in a guide", async (name, body, expected) => {
    const result = await openapi(await edited("ledger", "docs/getting-started.md", guide(body)));
    expect(result.output).toContain(expected);
  });

  it("warns when guide prose names an endpoint the spec does not have", async () => {
    const result = await openapi(await edited("ledger", "docs/getting-started.md", guide("Poll it with `GET /payment/{paymentId}` until it settles.")));
    expect(result.output).toContain("names GET /payment/{paymentId}");
  });
});

describe("legitimate edits found by the v1.2.6 retest", () => {
  it.each([
    ["a table without outer pipes", "generated/endpoints/delete-payments-paymentid.md", replace("| Name | Type | Required | Description |\n| --- | --- | --- | --- |\n| paymentId | string | yes | Needs SME input. Pattern: `^pay_[a-z0-9]+$` |", "Name | Type | Required | Description\n--- | --- | --- | ---\npaymentId | string | yes | Needs SME input. Pattern: `^pay_[a-z0-9]+$`")],
    ["curl -G with --data-urlencode", "generated/endpoints/get-payments.md", (doc) => doc.replace(/curl -X GET "([^"?]+)\?[^"]*"/, 'curl -G "$1" --data-urlencode "status=pending" --data-urlencode "limit=50"')],
    ["a JSON body printed over several lines", "generated/endpoints/post-accounts.md", (doc) => doc.replace(/-d '(\{.*\})'/, (match, body) => `-d '${JSON.stringify(JSON.parse(body), null, 2)}'`)],
    ["a comment line before the curl", "generated/endpoints/delete-payments-paymentid.md", replace("```bash\ncurl", "```bash\n# Cancel a payment\ncurl")],
    ["OAuth scopes written in prose", "generated/endpoints/delete-payments-paymentid.md", replace("Use OAuth 2.0 (scopes: `ledger:write`, `ledger:admin`).", "Use an OAuth 2.0 access token that has both the `ledger:write` and `ledger:admin` scopes.")],
    ["TBD inside a code span", "generated/endpoints/get-session.md", replace("Read the browser session\n\n## Endpoint", "Read the browser session. A status of `TBD` means the session is still loading.\n\n## Endpoint")]
  ])("accepts %s", async (name, file, edit) => {
    const root = await edited("ledger", file, edit);
    const result = await openapi(root);
    expect(result.failed, result.output).toBe(false);
    expect((await quality(root)).failed).toBe(false);
  });
});

describe("quality checks added after the v1.2.6 retest", () => {
  it.each([
    ["a javascript: URL in srcset", '<img srcset="javascript:alert(1) 1x">', "script"],
    ["a <portal>", '<portal src="https://evil.example"></portal>', "<portal>"],
    ["a split <script> tag", "<scr<script>ipt>alert(1)</script>", "<script>"],
    ["an unclosed <div>", "<div>\n\nSome text.", "<div> is opened 1 time"],
    ["T.B.D.", "Rate limits: T.B.D.", "placeholder"],
    ["Description goes here", "Description goes here.", "placeholder"],
    ["a ?? fill me in ?? marker", "?? fill me in ??", "placeholder"]
  ])("fails %s", async (name, line, expected) => {
    const result = await quality(await edited("ledger", "generated/endpoints/get-session.md", replace("## Summary\n", `## Summary\n\n${line}\n`)));
    expect(result.failed, result.output).toBe(true);
    expect(result.output).toContain(expected);
  });

  it("fails HTML or a script URL in the frontmatter", async () => {
    const result = await quality(await edited("ledger", "generated/endpoints/get-session.md", replace('title: "Read the browser session"', 'title: "<script>alert(1)</script>"')));
    expect(result.output).toContain("HTML or a script URL in the frontmatter");
  });

  it("warns about a Markdown image from another site", async () => {
    const result = await quality(await edited("ledger", "generated/endpoints/get-session.md", replace("## Summary\n", "## Summary\n\n![pixel](https://tracker.example/p.gif)\n")));
    expect(result.output).toContain("a Markdown image loads from another site");
  });
});
