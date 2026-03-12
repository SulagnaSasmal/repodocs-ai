import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

const assetsToCopy = ["templates", "prompts", "diagrams", "schema", "validation"];

const githubGovernanceFiles = [
  ".github/CODEOWNERS",
  ".github/pull_request_template.md"
];

function printUsage() {
  console.log("Usage: npm run bootstrap:docs-repo -- <target-directory>");
  console.log("Example: npm run bootstrap:docs-repo -- ../company-docs");
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
  return `# ${targetName}\n\nThis repository was bootstrapped from RepoDocs AI.\n\n## Start Here\n\n1. Open templates/api/ for API documentation.\n2. Open templates/features/ for feature documentation.\n3. Open templates/governance/ for review and QA guidance.\n4. Use prompts/ with the templates to draft and review content.\n\n## Validate Before Publishing\n\nCopy the validation scripts or wire your own CI checks using the files in validation/ and schema/.\n`;
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
  const targetArgument = process.argv[2];
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

  await copyGithubGovernanceFiles(targetRoot);
  const templateVersion = await writeTemplateVersionFile(targetRoot);
  const createdReadme = await writeStarterReadme(targetRoot);
  const relativeTarget = toPosix(path.relative(process.cwd(), targetRoot) || ".");

  console.log(`Bootstrapped docs repository assets into ${relativeTarget}`);
  console.log("Copied: templates/, prompts/, diagrams/, schema/, validation/");
  console.log("Copied: .github/CODEOWNERS, .github/pull_request_template.md");
  if (templateVersion) {
    console.log(`Wrote: .repodocs-version (${templateVersion})`);
  }
  if (createdReadme) {
    console.log("Created starter README.md");
  }
  console.log("Next steps:");
  console.log("1. Update .github/CODEOWNERS with your organization's GitHub team handles");
  console.log("2. Start with templates/api/, templates/features/, and templates/governance/");
  console.log("3. Use prompts/ to draft and review content");
  console.log("4. Add the copied validation and schema assets to your CI workflow");
}

main().catch((error) => {
  console.error(`Bootstrap failed: ${error.message}`);
  process.exitCode = 1;
});