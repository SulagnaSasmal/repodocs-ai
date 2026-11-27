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
    process.exit(1); // nothing has been written yet, so exiting now loses no output
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

const counts = { PASS: 0, WARN: 0, SKIP: 0, FAIL: 0 };
const skipReasons = [];

for (const check of checks) {
  const result = spawnSync(process.execPath, [path.join(__dirname, check.script), ...args], {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024
  });
  const output = `${result.stdout || ""}${result.stderr || ""}`.trim();
  const skipLine = output.match(/^Skipped [^:\n]+:\s*(.+)$/m);
  const status = result.status !== 0
    ? "FAIL"
    : skipLine
      ? "SKIP"
      : /warning\(s\)/.test(output)
        ? "WARN"
        : "PASS";

  counts[status] += 1;
  if (status === "SKIP") {
    skipReasons.push(`${check.name}: ${skipLine[1].replace(/\.\s.*$/, "").replace(/\.$/, "")}`);
  }

  console.log(`[${status}] ${check.name}`);
  console.log(output.split("\n").map((line) => `       ${line}`).join("\n"));
}

const parts = [];
if (counts.PASS > 0) parts.push(`${counts.PASS} passed`);
if (counts.WARN > 0) parts.push(`${counts.WARN} passed with warnings to resolve before publishing`);
if (counts.SKIP > 0) parts.push(`${counts.SKIP} skipped and did not run`);
if (counts.FAIL > 0) parts.push(`${counts.FAIL} failed`);

console.log("");
console.log(`${checks.length} checks: ${parts.join(", ")}.`);
for (const reason of skipReasons) {
  console.log(`  Skipped, ${reason}.`);
}

if (counts.FAIL > 0) {
  process.exitCode = 1;
} else if (strict && counts.SKIP > 0) {
  console.log("--strict treats a skipped check as a failure.");
  process.exitCode = 1;
}
