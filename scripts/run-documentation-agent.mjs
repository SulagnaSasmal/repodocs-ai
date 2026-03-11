import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  ensureDirectory,
  normalizeText,
  repoRoot,
  slugify
} from "./lib/docs-automation-utils.mjs";

function classifyWorkflow(inputPath, content) {
  const extension = path.extname(inputPath).toLowerCase();
  if ([".yaml", ".yml", ".json"].includes(extension) && /openapi\s*:/i.test(content)) {
    return {
      mode: "api-generation",
      template: "templates/api/endpoint-template.md",
      prompt: "prompts/api-generation/openapi-to-api-docs.md"
    };
  }

  if (/feature|workflow|user journey/i.test(content)) {
    return {
      mode: "feature-docs",
      template: "templates/features/feature-overview.md",
      prompt: "prompts/product-docs/product-overview-generation.md"
    };
  }

  return {
    mode: "product-docs",
    template: "templates/product/product-overview.md",
    prompt: "prompts/product-docs/product-overview-generation.md"
  };
}

function runNodeScript(scriptPath, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...args], {
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
      } else {
        reject(new Error(stderr || stdout || `${scriptPath} exited with code ${code}`));
      }
    });
  });
}

async function main() {
  const inputArg = process.argv[2] || "examples/openapi/payments-openapi.yaml";
  const inputPath = path.resolve(repoRoot, inputArg);
  const raw = await fs.readFile(inputPath, "utf8");
  const workflow = classifyWorkflow(inputPath, raw);
  const outputRoot = path.join(repoRoot, "agents", "output");
  const inputSlug = slugify(path.basename(inputPath, path.extname(inputPath)));
  const generatedDirectory = `generated/${inputSlug}`;
  const execution = {
    generated_docs: null,
    validation: null
  };

  if (workflow.mode === "api-generation") {
    execution.generated_docs = await runNodeScript(path.join(repoRoot, "scripts", "generate-openapi-docs.mjs"), [inputArg, generatedDirectory]);
    execution.validation = await runNodeScript(path.join(repoRoot, "scripts", "validate-openapi-examples.mjs"), []);
  }

  const result = {
    run_at: new Date().toISOString(),
    input: path.relative(repoRoot, inputPath).replace(/\\/g, "/"),
    workflow,
    outputs: {
      generated_directory: workflow.mode === "api-generation" ? generatedDirectory : null,
      validation_command: workflow.mode === "api-generation" ? "node scripts/validate-openapi-examples.mjs" : null
    },
    execution
  };

  const summary = [
    "# Documentation Agent Run",
    "",
    `- Input: ${result.input}`,
    `- Workflow: ${workflow.mode}`,
    `- Template: ${workflow.template}`,
    `- Prompt: ${workflow.prompt}`,
    workflow.mode === "api-generation" ? `- Generated docs: ${generatedDirectory}` : "- Generated docs: not applicable",
    workflow.mode === "api-generation" ? `- Validation: ${normalizeText(execution.validation?.stdout, "completed")}` : "- Validation: not applicable",
    "",
    "## Next Review Tasks",
    "",
    "1. Confirm the generated output with an SME.",
    "2. Fill any Needs SME input placeholders before publication.",
    "3. Run npm run validate before merge."
  ].join("\n");

  await ensureDirectory(outputRoot);
  await fs.writeFile(path.join(outputRoot, "last-run.json"), JSON.stringify(result, null, 2), "utf8");
  await fs.writeFile(path.join(outputRoot, "last-run.md"), `${summary}\n`, "utf8");

  console.log(`Documentation agent executed ${workflow.mode} for ${result.input}.`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});