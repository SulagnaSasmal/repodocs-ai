import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cli = path.join(repoRoot, "bin", "repodocs.mjs");
const petstore = path.join(repoRoot, "tests", "fixtures", "third-party", "petstore-expanded.yaml");
const { version } = JSON.parse(await fs.readFile(path.join(repoRoot, "package.json"), "utf8"));

async function runIn(cwd, args, command = process.execPath, prefix = [cli]) {
  return execFileAsync(command, [...prefix, ...args], { cwd });
}

describe("repodocs-ai CLI", () => {
  it("prints its version and help", async () => {
    const workDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "repodocs-cli-"));
    expect((await runIn(workDirectory, ["--version"])).stdout.trim()).toBe(version);
    const help = (await runIn(workDirectory, ["help"])).stdout;
    expect(help).toContain("repodocs-ai init <dir>");
    expect(help).toContain("repodocs-ai validate");
  });

  it("rejects an unknown command", async () => {
    const workDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "repodocs-cli-"));
    await expect(runIn(workDirectory, ["publish"])).rejects.toMatchObject({ stderr: expect.stringContaining("Unknown command: publish") });
  });

  it("runs init, generate and validate with paths relative to the current directory", async () => {
    const workDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "repodocs-cli-"));
    await runIn(workDirectory, ["init", "company-docs"]);
    await fs.mkdir(path.join(workDirectory, "company-docs", "openapi"));
    await fs.copyFile(petstore, path.join(workDirectory, "company-docs", "openapi", "petstore.yaml"));

    const generated = await runIn(workDirectory, ["generate", "company-docs/openapi/petstore.yaml", "company-docs/generated"]);
    expect(generated.stdout).toContain("Generated API documentation in company-docs/generated");
    await expect(fs.access(path.join(workDirectory, "company-docs", "generated", "endpoints", "post-pets.md"))).resolves.toBeUndefined();

    const validated = await runIn(path.join(workDirectory, "company-docs"), ["validate", "generated", "--specs", "openapi"]);
    expect(validated.stdout).toMatch(/4 of 4 checks passed/);
  });

  it("returns a failing exit code when validation fails", async () => {
    const workDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "repodocs-cli-"));
    await fs.mkdir(path.join(workDirectory, "docs"));
    await fs.writeFile(path.join(workDirectory, "docs", "page.md"), "---\ntitle: \"Page\"\n---\n# Page\n\n## Overview\n\nText.\n", "utf8");
    await expect(runIn(workDirectory, ["validate", "docs"])).rejects.toMatchObject({ code: 1 });
  });
});

describe("published package", () => {
  it("installs from a packed tarball and runs the full path", async () => {
    const workDirectory = await fs.mkdtemp(path.join(os.tmpdir(), "repodocs-pack-"));
    const { stdout } = await execFileAsync("npm", ["pack", "--pack-destination", workDirectory, "--silent"], { cwd: repoRoot });
    const tarball = path.join(workDirectory, stdout.trim().split("\n").pop());

    const project = path.join(workDirectory, "project");
    await fs.mkdir(project);
    await execFileAsync("npm", ["init", "-y"], { cwd: project });
    await execFileAsync("npm", ["install", "--no-audit", "--no-fund", tarball], { cwd: project });

    const bin = path.join(project, "node_modules", ".bin", "repodocs-ai");
    await execFileAsync(bin, ["init", "docs-repo", "--with-examples"], { cwd: project });
    await execFileAsync(bin, ["generate", "docs-repo/examples/payments-api/payments-openapi.yaml", "docs-repo/generated"], { cwd: project });
    const validated = await execFileAsync(bin, ["validate", "docs-repo/generated", "--specs", "docs-repo/examples/payments-api"], { cwd: project });
    expect(validated.stdout).toMatch(/4 of 4 checks passed/);

    const installed = JSON.parse(await fs.readFile(path.join(project, "package-lock.json"), "utf8"));
    expect(Object.keys(installed.packages)).not.toContain("node_modules/redis");
  }, 120000);
});
