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

// CI for the new docs repository: runs every content check with the same
// RepoDocs AI version that created the repository.
function buildAdopterWorkflow(version) {
  return `name: Validate documentation

on:
  push:
    branches:
      - main
  pull_request:

# The token can read the repository and nothing else.
permissions:
  contents: read

jobs:
  validate:
    runs-on: ubuntu-latest
    steps:
      - name: Check out the docs
        uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1

      - name: Set up Node.js
        uses: actions/setup-node@949feb2413d6458794dcd2491c4babbbce0c15c1 # v7.1.0
        with:
          node-version: 22

      - name: Validate docs
        run: |
          targets=()
          for folder in generated docs; do
            if [ -n "$(find "$folder" -name '*.md' 2>/dev/null | head -n 1)" ]; then targets+=("$folder"); fi
          done
          if [ \${#targets[@]} -eq 0 ]; then
            echo "::error::No Markdown docs in generated/ or docs/ yet. Nothing was checked."
            exit 1
          fi
          specs=()
          if [ -d openapi ]; then specs=(--specs openapi); fi
          # Pinned to the release that created this repository. To pin an exact
          # commit instead of a tag, replace v${version} with its commit SHA.
          npx --yes github:SulagnaSasmal/repodocs-ai#v${version} validate "\${targets[@]}" "\${specs[@]}"

      - name: Lint Markdown
        # The same rules as .markdownlint.json, which init created.
        run: |
          targets=()
          for folder in docs generated; do
            if [ -d "$folder" ]; then targets+=("$folder"); fi
          done
          if [ \${#targets[@]} -gt 0 ]; then
            npx --yes markdownlint-cli@0.50.1 --config .markdownlint.json "\${targets[@]}"
          fi
`;
}

function printUsage() {
  console.log("Usage: repodocs-ai init <target-directory> [--with-examples]");
  console.log("Example: repodocs-ai init company-docs");
  console.log("         repodocs-ai init company-docs --with-examples");
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

async function readPackageVersion() {
  const pkg = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));
  return pkg.version;
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
    await fs.writeFile(workflowPath, buildAdopterWorkflow(await readPackageVersion()), "utf8");
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

function buildStarterReadme(targetName, version) {
  return `# ${targetName}\n\nThis repository was bootstrapped from RepoDocs AI.\n\n## Start Here\n\n1. Open templates/api/ for API documentation.\n2. Open templates/features/ for feature documentation.\n3. Open templates/governance/ for review and QA guidance.\n4. Use prompts/ with the templates to draft and review content.\n\n## Folders\n\n- openapi/: your OpenAPI specs\n- generated/: docs generated from those specs\n- docs/: docs you write by hand from the templates\n\n## Validate Before Publishing\n\nFrom this folder, run:\n\n    npx --yes github:SulagnaSasmal/repodocs-ai#v${version} validate generated --specs openapi\n\nAdd docs to that command once you have hand-written docs.\nThe same checks run in CI through .github/workflows/docs-validate.yml on every pull request.\nThe checklists in validation/ cover what the automated checks cannot, such as accuracy against the product.\n`;
}

async function writeStarterReadme(targetRoot) {
  const readmePath = path.join(targetRoot, "README.md");
  if (await pathExists(readmePath)) {
    return false;
  }

  const targetName = path.basename(targetRoot);
  await fs.writeFile(readmePath, buildStarterReadme(targetName, await readPackageVersion()), "utf8");
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

  const baseDirectory = (process.env.npm_lifecycle_event === "bootstrap:docs-repo" && process.env.INIT_CWD) || process.cwd();
  const targetRoot = path.resolve(baseDirectory, targetArgument);
  await ensureDirectory(targetRoot);

  // The folders the starter README and CI workflow expect.
  for (const folder of ["openapi", "generated", "docs"]) {
    await ensureDirectory(path.join(targetRoot, folder));
    const keepFile = path.join(targetRoot, folder, ".gitkeep");
    if (!(await pathExists(keepFile))) {
      await fs.writeFile(keepFile, "", "utf8");
    }
  }

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
  const shownTarget = path.relative(baseDirectory, targetRoot);
  const relativeTarget = toPosix(shownTarget.startsWith("..") || path.isAbsolute(shownTarget) ? targetRoot : shownTarget || ".");

  console.log(`Bootstrapped docs repository assets into ${relativeTarget}`);
  console.log("Copied: templates/, prompts/, diagrams/, schema/, validation/");
  console.log("Created: openapi/, generated/, docs/");
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
  console.log(`4. Put your OpenAPI spec in ${relativeTarget}/openapi/ and generate docs:`);
  console.log(`   repodocs-ai generate ${relativeTarget}/openapi/<spec>.yaml ${relativeTarget}/generated`);
  console.log(`5. Validate: repodocs-ai validate ${relativeTarget}/generated --specs ${relativeTarget}/openapi`);
  console.log("   CI runs the same checks through .github/workflows/docs-validate.yml once you push to GitHub");
}

main().catch((error) => {
  console.error(`Bootstrap failed: ${error.message}`);
  process.exitCode = 1;
});