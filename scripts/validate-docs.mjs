// Runs every RepoDocs AI content check against your own docs.
//
//   repodocs-ai validate <docs folder...> [--specs <folder>] [--strict]
//
// Without --specs, the two checks that compare docs with the OpenAPI spec are
// reported as skipped, never as passed. With --strict, a skipped check fails
// the run.
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assertPathsExist, exitWithTargetError, parseTargets } from "./lib/cli-targets.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const checks = [
  { name: "Frontmatter", script: "validate-frontmatter.mjs" },
  { name: "Structure and quality", script: "validate-doc-quality.mjs" },
  { name: "OpenAPI examples", script: "validate-openapi-examples.mjs" },
  { name: "API versions", script: "validate-version-compatibility.mjs" }
];

let targets;
try {
  targets = parseTargets();
  if (!targets.userMode) {
    console.error("Pass the docs folder to check, for example:");
    console.error("  npm run validate:docs -- ../company-docs --specs ../company-docs/openapi");
    console.error("To check this repository itself, run: npm run validate");
    process.exit(1);
  }
  await assertPathsExist(targets.docPaths, "Docs path");
  await assertPathsExist(targets.specPaths, "Specs path");
} catch (error) {
  exitWithTargetError(error);
}

const strict = process.argv.includes("--strict");

// Absolute paths, so each check resolves them the same way.
const args = [...targets.docPaths];
for (const specPath of targets.specPaths) {
  args.push("--specs", specPath);
}

let failed = 0;
let skipped = 0;
let warned = 0;

for (const check of checks) {
  const result = spawnSync(process.execPath, [path.join(__dirname, check.script), ...args], {
    encoding: "utf8"
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  const status = result.status !== 0
    ? "FAIL"
    : /^Skipped /m.test(output)
      ? "SKIP"
      : /warning\(s\)/.test(output)
        ? "WARN"
        : "PASS";

  if (status === "FAIL") failed += 1;
  if (status === "SKIP") skipped += 1;
  if (status === "WARN") warned += 1;

  console.log(`[${status}] ${check.name}`);
  console.log(output.split("\n").map((line) => `       ${line}`).join("\n"));
}

console.log("");
if (strict && skipped > 0) {
  console.log(`${skipped} of ${checks.length} checks were skipped, and --strict treats a skipped check as a failure.`);
  process.exit(1);
}
if (failed > 0) {
  console.log(`${failed} of ${checks.length} checks failed.`);
  process.exit(1);
}
const ran = checks.length - skipped;
const parts = [`${ran} of ${checks.length} checks passed`];
if (warned > 0) {
  parts.push(`${warned} with warnings to resolve before publishing`);
}
if (skipped > 0) {
  parts.push(`${skipped} skipped and did not run (add --specs to run them)`);
}
console.log(`${parts.join("; ")}.`);
