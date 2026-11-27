#!/usr/bin/env node
// RepoDocs AI command-line interface.
//
//   repodocs-ai init <dir> [--with-examples]        set up a new docs repository
//   repodocs-ai generate <spec> [output-dir] [--owner <team>]       draft endpoint docs from an OpenAPI spec
//   repodocs-ai validate <docs...> [--specs <dir>] [--strict]       run every content check on your docs
//
// Paths resolve from the directory you run the command in.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { version } = JSON.parse(fs.readFileSync(path.join(packageRoot, "package.json"), "utf8"));

const commands = {
  init: { script: "bootstrap-docs-repo.mjs", summary: "Set up a new docs repository: templates, prompts, schema, checklists and a CI workflow" },
  generate: { script: "generate-openapi-docs.mjs", summary: "Draft endpoint docs from an OpenAPI 3.x spec" },
  validate: { script: "validate-docs.mjs", summary: "Run the frontmatter, structure, OpenAPI and version checks on your docs" }
};

function printHelp() {
  console.log(`RepoDocs AI ${version}

Usage:
  repodocs-ai init <dir> [--with-examples]
  repodocs-ai generate <spec> [output-dir] [--owner <team>]
  repodocs-ai validate <docs-folder...> [--specs <specs-folder>] [--strict]

Commands:
${Object.entries(commands).map(([name, command]) => `  ${name.padEnd(10)}${command.summary}`).join("\n")}

Example:
  repodocs-ai init company-docs
  repodocs-ai generate company-docs/openapi/my-api.yaml company-docs/generated
  repodocs-ai validate company-docs/generated --specs company-docs/openapi

Options:
  --with-examples   init: also copy the payments example set
  --owner <team>    generate: set the owner field in the frontmatter (default: unassigned)
  --specs <folder>  validate: compare docs with the OpenAPI specs in this folder
  --strict          validate: fail when a check is skipped

Paths resolve from the current directory. Docs: https://github.com/SulagnaSasmal/repodocs-ai`);
}

const [commandName, ...args] = process.argv.slice(2);

if (!commandName || commandName === "help" || commandName === "--help" || commandName === "-h") {
  printHelp();
  process.exit(commandName ? 0 : 1);
}

if (commandName === "--version" || commandName === "-v" || commandName === "version") {
  console.log(version);
  process.exit(0);
}

const command = commands[commandName];
if (!command) {
  console.error(`Unknown command: ${commandName}\n`);
  printHelp();
  process.exit(1);
}

// Clear npm's lifecycle variables so the scripts resolve paths from the
// user's current directory, not from wherever npm or npx started.
const env = { ...process.env };
delete env.npm_lifecycle_event;
delete env.INIT_CWD;

const result = spawnSync(process.execPath, [path.join(packageRoot, "scripts", command.script), ...args], {
  stdio: "inherit",
  env
});

process.exit(result.status ?? 1);
