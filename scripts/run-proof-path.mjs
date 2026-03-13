import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { ensureDirectory, pathExists, repoRoot } from "./lib/docs-automation-utils.mjs";

const tempDocsRepo = path.join(repoRoot, "tmp", "proof-docs-repo");
const tempSpecDirectory = path.join(tempDocsRepo, "openapi");
const tempSpecPath = path.join(tempSpecDirectory, "payments-openapi.yaml");
const generatedOutput = "generated/proof-payments-api";
const generatedOutputPath = path.join(repoRoot, generatedOutput);

function runNodeScript(relativeScriptPath, args = []) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(repoRoot, relativeScriptPath), ...args], {
      cwd: repoRoot,
      stdio: ["ignore", "pipe", "pipe"]
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    child.on("exit", (code) => {
      if (code === 0) {
        resolve({ stdout: stdout.trim(), stderr: stderr.trim() });
        return;
      }

      reject(new Error(stderr || stdout || `${relativeScriptPath} exited with code ${code}`));
    });
  });
}

async function removeIfPresent(targetPath) {
  if (await pathExists(targetPath)) {
    await fs.rm(targetPath, { recursive: true, force: true });
  }
}

async function requirePath(targetPath, label) {
  if (!(await pathExists(targetPath))) {
    throw new Error(`Expected ${label} at ${path.relative(repoRoot, targetPath).replace(/\\/g, "/")}`);
  }
}

async function main() {
  await removeIfPresent(tempDocsRepo);
  await removeIfPresent(generatedOutputPath);

  await runNodeScript("scripts/bootstrap-docs-repo.mjs", [path.relative(repoRoot, tempDocsRepo).replace(/\\/g, "/"), "--with-examples"]);

  await requirePath(path.join(tempDocsRepo, "templates", "api", "endpoint-template.md"), "bootstrapped API template");
  await requirePath(path.join(tempDocsRepo, "prompts", "review", "documentation-review.md"), "bootstrapped review prompt");
  await requirePath(path.join(tempDocsRepo, ".github", "CODEOWNERS"), "bootstrapped CODEOWNERS file");

  await ensureDirectory(tempSpecDirectory);
  await fs.copyFile(path.join(repoRoot, "examples", "payments-api", "payments-openapi.yaml"), tempSpecPath);

  await runNodeScript("scripts/generate-openapi-docs.mjs", [
    path.relative(repoRoot, tempSpecPath).replace(/\\/g, "/"),
    generatedOutput
  ]);

  await requirePath(path.join(generatedOutputPath, "api-overview.md"), "generated API overview");
  await requirePath(path.join(generatedOutputPath, "endpoints"), "generated endpoints directory");

  const openApiValidation = await runNodeScript("scripts/validate-openapi-examples.mjs");
  const docQualityValidation = await runNodeScript("scripts/validate-doc-quality.mjs");
  const exportResult = await runNodeScript("scripts/export-docs.mjs", ["all", generatedOutput]);

  console.log("RepoDocs AI proof path completed.");
  console.log(`- Bootstrapped repo: ${path.relative(repoRoot, tempDocsRepo).replace(/\\/g, "/")}`);
  console.log(`- Generated docs: ${generatedOutput}`);
  console.log(`- OpenAPI validation: ${openApiValidation.stdout || "ok"}`);
  console.log(`- Doc quality validation: ${docQualityValidation.stdout || "ok"}`);
  console.log(`- Export: ${exportResult.stdout || "ok"}`);
}

main().catch((error) => {
  console.error(`Proof path failed: ${error.message}`);
  process.exit(1);
});