import fs from "node:fs/promises";
import path from "node:path";

const OWN_NPM_SCRIPTS = new Set([
  "validate:docs",
  "validate:frontmatter",
  "validate:quality",
  "validate:openapi",
  "validate:versions"
]);

// Reads command-line targets shared by the validators:
//   <path> ...        docs folders or Markdown files to check
//   --specs <path>    folder (or file) holding the OpenAPI specs those docs describe
// Relative paths resolve from the directory the user ran the command in.
// npm run changes the working directory to the package root, so INIT_CWD is
// used, but only when one of these validators' own npm scripts started us.
export function parseTargets(argv = process.argv.slice(2)) {
  const startedByOwnNpmScript = OWN_NPM_SCRIPTS.has(process.env.npm_lifecycle_event);
  const baseDirectory = (startedByOwnNpmScript && process.env.INIT_CWD) || process.cwd();

  const docPaths = [];
  const specPaths = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--specs") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--")) {
        throw new TargetError("--specs needs a folder, for example: --specs ../company-docs/openapi");
      }
      specPaths.push(path.resolve(baseDirectory, value));
      index += 1;
    } else if (arg.startsWith("--specs=")) {
      specPaths.push(path.resolve(baseDirectory, arg.slice("--specs=".length)));
    } else if (!arg.startsWith("--")) {
      docPaths.push(path.resolve(baseDirectory, arg));
    }
  }

  return { baseDirectory, docPaths, specPaths, userMode: docPaths.length > 0 };
}

export class TargetError extends Error {}

export async function assertPathsExist(paths, label) {
  for (const target of paths) {
    try {
      await fs.access(target);
    } catch {
      throw new TargetError(`${label} not found: ${target}`);
    }
  }
}

// Shows a path relative to where the user ran the command when it sits inside
// that directory, and as an absolute path otherwise.
export function displayPath(target, baseDirectory) {
  const relative = path.relative(baseDirectory, target);
  if (!relative) {
    return ".";
  }
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    return target.replace(/\\/g, "/");
  }
  return relative.replace(/\\/g, "/");
}

export function exitWithTargetError(error) {
  if (error instanceof TargetError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}
