/**
 * Repository consistency tests
 *
 * Instead of checking files one by one, these tests check that the things
 * people and CI rely on actually line up:
 *   - the structure check passes
 *   - every npm script that runs a file points at a file that exists
 *   - every `npm run` command in the README and in CI workflows exists
 *   - every repository path the README mentions exists
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function exists(relativePath) {
  try {
    await fs.access(path.join(repoRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

async function readPackageScripts() {
  const pkg = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));
  return pkg.scripts;
}

function npmRunCommands(text) {
  return [...new Set([...text.matchAll(/npm run ([a-z][\w:-]*)/g)].map((match) => match[1]))];
}

describe("structure check", () => {
  it("passes on this repository", async () => {
    const { stdout } = await execFileAsync(process.execPath, [path.join(repoRoot, "scripts", "validate-structure.mjs")], { cwd: repoRoot });
    expect(stdout).toMatch(/Validated \d+ required project files\./);
  });
});

describe("npm scripts", () => {
  it("point at files that exist", async () => {
    const scripts = await readPackageScripts();
    const missing = [];
    for (const [name, command] of Object.entries(scripts)) {
      for (const match of command.matchAll(/(?:node|-f)\s+([\w./-]+\.(?:mjs|js|ya?ml))/g)) {
        if (!(await exists(match[1]))) {
          missing.push(`${name}: ${match[1]}`);
        }
      }
      if (/docker build/.test(command) && !/-f\s/.test(command) && !(await exists("Dockerfile"))) {
        missing.push(`${name}: Dockerfile`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("documented commands", () => {
  it("every npm run command in the README exists", async () => {
    const scripts = await readPackageScripts();
    const readme = await fs.readFile(path.join(repoRoot, "README.md"), "utf8");
    const unknown = npmRunCommands(readme).filter((name) => !(name in scripts));
    expect(unknown).toEqual([]);
  });

  it("every npm run command in CI workflows exists", async () => {
    // Workflows also build the site, which has its own package.json.
    const websitePackage = JSON.parse(await fs.readFile(path.join(repoRoot, "website", "package.json"), "utf8"));
    const scripts = { ...(await readPackageScripts()), ...websitePackage.scripts };
    const workflowsDirectory = path.join(repoRoot, ".github", "workflows");
    const unknown = [];
    for (const file of await fs.readdir(workflowsDirectory)) {
      const text = await fs.readFile(path.join(workflowsDirectory, file), "utf8");
      for (const name of npmRunCommands(text)) {
        if (!(name in scripts)) {
          unknown.push(`${file}: npm run ${name}`);
        }
      }
    }
    expect(unknown).toEqual([]);
  });

  it("every repository path the README mentions exists", async () => {
    const readme = await fs.readFile(path.join(repoRoot, "README.md"), "utf8");
    // Files the bootstrap writes into a user's docs repository, not into this one.
    const writtenIntoDocsRepos = new Set([".github/workflows/docs-validate.yml"]);
    const prefixes = ["scripts/", "docs/", "templates/", "prompts/", "examples/", "schema/", "validation/", "experimental/", "archive/", "website/", ".github/"];
    const mentioned = [...new Set([...readme.matchAll(/`([^`\s]+)`/g)].map((match) => match[1]))]
      .filter((value) => prefixes.some((prefix) => value.startsWith(prefix)))
      .filter((value) => !/[<>*]/.test(value))
      .filter((value) => !writtenIntoDocsRepos.has(value));
    const missing = [];
    for (const value of mentioned) {
      if (!(await exists(value.replace(/\/$/, "")))) {
        missing.push(value);
      }
    }
    expect(missing).toEqual([]);
  });
});
