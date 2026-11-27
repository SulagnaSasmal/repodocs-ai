import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const assetsToCopy = ["templates", "prompts", "diagrams", "schema", "validation"];

const githubGovernanceFiles = [".github/pull_request_template.md"];

const lintConfigFiles = [".markdownlint.json"];

const adopterCodeowners = `# CODEOWNERS: who reviews which documentation
#
# Replace the example rules below with your own GitHub users or teams, then
# uncomment them. GitHub requests a review from these owners on every pull
# request that touches a matching path.
#
# Format: <path-pattern> <github-team-or-user>
# Reference: https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/customizing-your-repository/about-code-owners

# *              @your-org/docs-team
# generated/     @your-org/api-team
# openapi/       @your-org/api-team
`;

// CI for the new docs repository. It checks out RepoDocs AI next to the docs
// and runs every content check against generated/ and docs/, comparing them
// with the specs in openapi/ when that folder exists.
const adopterWorkflow = `name: Validate documentation

on:
  push:
    branches:
      - main
  pull_request:

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - name: Check out the docs
        uses: actions/checkout@v4
        with:
          path: docs-repo

      - name: Check out RepoDocs AI
        uses: actions/checkout@v4
        with:
          repository: SulagnaSasmal/repodocs-ai
          # Pin to a commit SHA for repeatable builds.
          ref: main
          path: repodocs-ai

      - name: Set up Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 24

      - name: Install RepoDocs AI
        working-directory: repodocs-ai
        run: npm ci

      - name: Validate docs
        working-directory: repodocs-ai
        run: |
          targets=()
          for folder in generated docs; do
            if [ -d "../docs-repo/$folder" ]; then targets+=("../docs-repo/$folder"); fi
          done
          if [ \${#targets[@]} -eq 0 ]; then
            echo "::warning::No generated/ or docs/ folder yet. Nothing was checked."
            exit 0
          fi
          specs=()
          if [ -d ../docs-repo/openapi ]; then specs=(--specs ../docs-repo/openapi); fi
          node scripts/validate-docs.mjs "\${targets[@]}" "\${specs[@]}"
`;

function printUsage() {
  console.log("Usage: npm run bootstrap:docs-repo -- <target-directory> [--with-examples]");
  console.log("Example: npm run bootstrap:docs-repo -- ../company-docs");
  console.log("         npm run bootstrap:docs-repo -- ../company-docs --with-examples");
}

function toPosix(relativePath) {
  return relativePath.replace(/\\/g, "/");
}

async function ensureDirectory(directoryPath) {
  await fs.mkdir(directoryPath, { recursive: true });
}

async function pathExists(targetPath) {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function copyAssetDirectory(sourceName, targetRoot) {
  const sourcePath = path.join(repoRoot, sourceName);
  const destinationPath = path.join(targetRoot, sourceName);
  await fs.cp(sourcePath, destinationPath, { recursive: true, force: true });
}

async function copyGithubGovernanceFiles(targetRoot) {
  const githubDir = path.join(targetRoot, ".github");
  await ensureDirectory(githubDir);
  for (const relPath of githubGovernanceFiles) {
    const sourcePath = path.join(repoRoot, relPath);
    const destPath = path.join(targetRoot, relPath);
    await fs.copyFile(sourcePath, destPath);
  }
}

async function writeAdopterGithubFiles(targetRoot) {
  const written = [];
  const codeownersPath = path.join(targetRoot, ".github", "CODEOWNERS");
  if (!(await pathExists(codeownersPath))) {
    await fs.writeFile(codeownersPath, adopterCodeowners, "utf8");
    written.push(".github/CODEOWNERS");
  }

  const workflowPath = path.join(targetRoot, ".github", "workflows", "docs-validate.yml");
  if (!(await pathExists(workflowPath))) {
    await ensureDirectory(path.dirname(workflowPath));
    await fs.writeFile(workflowPath, adopterWorkflow, "utf8");
    written.push(".github/workflows/docs-validate.yml");
  }
  return written;
}

async function copyLintConfig(targetRoot) {
  const copied = [];
  for (const relPath of lintConfigFiles) {
    const destPath = path.join(targetRoot, relPath);
    if (!(await pathExists(destPath))) {
      await fs.copyFile(path.join(repoRoot, relPath), destPath);
      copied.push(relPath);
    }
  }
  return copied;
}

async function writeTemplateVersionFile(targetRoot) {
  const versionSourcePath = path.join(repoRoot, "TEMPLATE_VERSION");
  let version = "unknown";
  try {
    version = (await fs.readFile(versionSourcePath, "utf8")).trim();
  } catch {
    // TEMPLATE_VERSION file not present — skip
  }
  if (version === "unknown") {
    return false;
  }
  await fs.writeFile(path.join(targetRoot, ".repodocs-version"), version, "utf8");
  return version;
}

function buildStarterReadme(targetName) {
  return `# ${targetName}\n\nThis repository was bootstrapped from RepoDocs AI.\n\n## Start Here\n\n1. Open templates/api/ for API documentation.\n2. Open templates/features/ for feature documentation.\n3. Open templates/governance/ for review and QA guidance.\n4. Use prompts/ with the templates to draft and review content.\n\n## Folders\n\n- openapi/: your OpenAPI specs\n- generated/: docs generated from those specs\n- docs/: docs you write by hand from the templates\n\n## Validate Before Publishing\n\nFrom your RepoDocs AI clone, run:\n\n    npm run validate:docs -- ../${targetName}/generated --specs ../${targetName}/openapi\n\nAdd ../${targetName}/docs to that command once you have hand-written docs.\nThe same checks run in CI through .github/workflows/docs-validate.yml on every pull request.\nThe checklists in validation/ cover what the automated checks cannot, such as accuracy against the product.\n`;
}

async function writeStarterReadme(targetRoot) {
  const readmePath = path.join(targetRoot, "README.md");
  if (await pathExists(readmePath)) {
    return false;
  }

  const targetName = path.basename(targetRoot);
  await fs.writeFile(readmePath, buildStarterReadme(targetName), "utf8");
  return true;
}

async function main() {
  const args = process.argv.slice(2);
  const targetArgument = args.find((a) => !a.startsWith("--"));
  const withExamples = args.includes("--with-examples");

  if (!targetArgument) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const targetRoot = path.resolve(process.cwd(), targetArgument);
  await ensureDirectory(targetRoot);

  for (const asset of assetsToCopy) {
    await copyAssetDirectory(asset, targetRoot);
  }

  if (withExamples) {
    await copyAssetDirectory("examples", targetRoot);
  }

  await copyGithubGovernanceFiles(targetRoot);
  const githubFilesWritten = await writeAdopterGithubFiles(targetRoot);
  const lintFilesCopied = await copyLintConfig(targetRoot);
  const templateVersion = await writeTemplateVersionFile(targetRoot);
  const createdReadme = await writeStarterReadme(targetRoot);
  const relativeTarget = toPosix(path.relative(process.cwd(), targetRoot) || ".");

  console.log(`Bootstrapped docs repository assets into ${relativeTarget}`);
  console.log("Copied: templates/, prompts/, diagrams/, schema/, validation/");
  if (withExamples) {
    console.log("Copied: examples/ (payments API examples, product docs, complete system)");
  }
  console.log("Copied: .github/pull_request_template.md");
  if (githubFilesWritten.length > 0) {
    console.log(`Wrote: ${githubFilesWritten.join(", ")}`);
  }
  if (lintFilesCopied.length > 0) {
    console.log(`Copied: ${lintFilesCopied.join(", ")}`);
  }
  if (templateVersion) {
    console.log(`Wrote: .repodocs-version (${templateVersion})`);
  }
  if (createdReadme) {
    console.log("Created starter README.md");
  }
  console.log("Next steps:");
  console.log("1. Replace the example rules in .github/CODEOWNERS with your own GitHub users or teams");
  console.log("2. Start with templates/api/, templates/features/, and templates/governance/");
  console.log("3. Use prompts/ to draft and review content");
  if (!withExamples) {
    console.log("   Tip: rerun with --with-examples to also copy the payments API example set");
  }
  console.log("4. Put your OpenAPI specs in openapi/ and generate docs into generated/");
  console.log(`5. Validate: npm run validate:docs -- ${relativeTarget}/generated --specs ${relativeTarget}/openapi`);
  console.log("   CI runs the same checks through .github/workflows/docs-validate.yml once you push to GitHub");
}

main().catch((error) => {
  console.error(`Bootstrap failed: ${error.message}`);
  process.exitCode = 1;
});