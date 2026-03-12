import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

async function readFile(filePath) {
  try {
    return (await fs.readFile(filePath, "utf8")).trim();
  } catch {
    return null;
  }
}

async function main() {
  // The current TEMPLATE_VERSION in the repodocs-ai source
  const currentVersion = await readFile(path.join(repoRoot, "TEMPLATE_VERSION"));

  // The version that was written into this repo at bootstrap time
  const installedVersion = await readFile(path.join(process.cwd(), ".repodocs-version"));

  if (!currentVersion) {
    console.log("TEMPLATE_VERSION file not found in repodocs-ai source.");
    return;
  }

  if (!installedVersion) {
    console.warn("WARNING: No .repodocs-version file found in this repository.");
    console.warn("This repository may not have been bootstrapped from RepoDocs AI,");
    console.warn(`or it was bootstrapped before template version tracking was introduced (current: ${currentVersion}).`);
    console.warn("Run: npm run bootstrap:docs-repo -- <this-repo-path> to refresh and write .repodocs-version");
    process.exitCode = 1;
    return;
  }

  console.log(`Installed template version : ${installedVersion}`);
  console.log(`Current template version   : ${currentVersion}`);

  if (installedVersion === currentVersion) {
    console.log("Templates are up to date.");
    return;
  }

  console.warn(`\nWARNING: Template drift detected.`);
  console.warn(`This repository was bootstrapped from template version ${installedVersion}.`);
  console.warn(`The current RepoDocs AI template version is ${currentVersion}.`);
  console.warn("Run: npm run bootstrap:docs-repo -- <this-repo-path> to pull the latest templates.");
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
