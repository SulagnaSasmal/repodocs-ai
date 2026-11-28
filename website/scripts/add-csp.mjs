// Adds a Content-Security-Policy and a referrer policy to every built page.
// GitHub Pages cannot send response headers, so the policy goes in a <meta>
// tag. Each page's inline scripts are allowed by their SHA-256 hash; no
// other inline script, and no script from another origin, can run.
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const buildDirectory = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "build");

async function htmlFiles(directory) {
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const files = await Promise.all(entries.map((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return htmlFiles(fullPath);
    return entry.name.endsWith(".html") ? [fullPath] : [];
  }));
  return files.flat();
}

function inlineScriptHashes(html) {
  const hashes = new Set();
  for (const match of html.matchAll(/<script(?![^>]*\bsrc=)([^>]*)>([\s\S]*?)<\/script>/gi)) {
    const type = match[1].match(/\btype=["']?([^"'\s>]+)/i)?.[1]?.toLowerCase();
    // JSON-LD and other data blocks are never executed, so they need no hash.
    if (type && type !== "text/javascript" && type !== "module" && type !== "application/javascript") continue;
    hashes.add(`'sha256-${crypto.createHash("sha256").update(match[2], "utf8").digest("base64")}'`);
  }
  return [...hashes];
}

function policyFor(html) {
  return [
    "default-src 'self'",
    `script-src 'self' ${inlineScriptHashes(html).join(" ")}`.trim(),
    // The theme's fonts come from Google Fonts (src/css/custom.css).
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "media-src 'self'",
    "connect-src 'self'",
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "upgrade-insecure-requests"
  ].join("; ");
}

const files = await htmlFiles(buildDirectory);
for (const file of files) {
  const html = await fs.readFile(file, "utf8");
  if (html.includes('http-equiv="Content-Security-Policy"')) continue;
  const tags = `<meta http-equiv="Content-Security-Policy" content="${policyFor(html)}"><meta name="referrer" content="strict-origin-when-cross-origin">`;
  // Right after <head>, before any script, so the policy covers all of them.
  const updated = html.replace(/<head([^>]*)>/i, `<head$1>${tags}`);
  if (updated === html) throw new Error(`No <head> in ${path.relative(buildDirectory, file)}`);
  await fs.writeFile(file, updated, "utf8");
}
console.log(`Added a Content-Security-Policy to ${files.length} pages.`);
