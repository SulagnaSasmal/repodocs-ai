import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";
import { conformValue, exampleFor, includeProperty as includeForMode, resolveSchema as resolveSharedSchema } from "./lib/schema-values.mjs";
import { splitByFences } from "./lib/markdown-blocks.mjs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  return value.trim();
}

// Text from a spec is not trusted: a description can carry <script>, event
// handlers or javascript: links, and a docs site that renders raw HTML
// (MkDocs, Jekyll, Hugo with unsafe HTML on) would run them. Outside code
// blocks and code spans, every "<" is written as "&lt;" (which also keeps
// types such as array<string> visible) and links to script URLs are dropped.
// The frontmatter is left alone: its values are already quoted strings.
function escapeUntrustedHtml(markdown) {
  const frontmatter = markdown.match(/^---\n[\s\S]*?\n---\n/)?.[0] || "";
  const body = markdown.slice(frontmatter.length);
  // Fenced blocks, found line by line: a regular expression backtracks on a
  // long run of backticks in a spec description.
  const out = [];
  for (const piece of splitByFences(body)) {
    if (piece.code) {
      // A fence copied from spec prose with no language gets "text" (MD040).
      out.push(piece.text.replace(/^(`{3,}|~{3,})[ \t]*\n/, "$1text\n"));
      continue;
    }
    out.push(piece.text
      .split(/(`+[^`\n]*?`+)/)
      .map((part, partIndex) => (partIndex % 2 === 1 ? part : escapeProse(part)))
      .join("")
      .replace(/\n{3,}/g, "\n\n")); // removed comments can leave extra blank lines (MD012)
  }
  return frontmatter + out.join("");
}

// A link target that would run script once a renderer decodes entities and
// drops the whitespace browsers ignore in URLs.
function isScriptUrl(target) {
  const decoded = String(target)
    .replace(/&amp;/gi, "&")
    .replace(/&#x([0-9a-f]+);?/gi, (match, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);?/g, (match, decimal) => String.fromCodePoint(Number(decimal)))
    .replace(/&colon;/gi, ":")
    .replace(/&tab;|&newline;/gi, "")
    .replace(/[\u0000-\u0020\u007f]+/g, "")
    .toLowerCase();
  return /^(javascript|vbscript|data):/.test(decoded);
}

function escapeProse(text) {
  const autolinks = [];
  return text
    // Keep autolinks to web pages; every other "<" becomes text.
    .replace(/<(https?:\/\/[^\s<>]+)>/g, (match, url) => {
      autolinks.push(url);
      return `\u0001${autolinks.length - 1}\u0001`;
    })
    // Entities are shown as written, so they cannot spell out a script URL.
    .replace(/&(?=#|[A-Za-z]+;)/g, "&amp;")
    .replace(/</g, "&lt;")
    // Bare web addresses become autolinks (markdownlint MD034).
    // Not a URL that is already a link target: "](https://...)".
    .replace(/(^|\s|(?<!\])\()(https?:\/\/[^\s<>()\]"']*[^\s<>()\]"'.,;:!?])/g, (match, lead, url) => `${lead}<${url}>`)
    .replace(/\u0001(\d+)\u0001/g, (match, index) => `<${autolinks[Number(index)]}>`)
    // Inline links and reference definitions to script URLs are dropped.
    // The whole target, whitespace included: browsers drop tabs and newlines
    // inside URLs, so "java<TAB>script:" still runs.
    .replace(/\]\(((?:[^()]|\((?:[^()]|\([^()]*\))*\))*)\)/g, (match, target) => (isScriptUrl(target) ? "](#unsafe-link-removed)" : match))
    .replace(/^(\s{0,3}\[[^\]]+\]:\s*)(\S+)(.*)$/gm, (match, lead, target, rest) => (isScriptUrl(target) ? `${lead}#unsafe-link-removed` : match));
}

function toSlug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "") || "endpoint";
}

function titleCaseFromSlug(value) {
  return value
    .split("-")
    .filter(Boolean)
    .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
    .join(" ");
}

function stringifyYamlLines(fields) {
  const lines = ["---"];

  for (const [key, value] of Object.entries(fields)) {
    if (Array.isArray(value)) {
      if (value.length === 0) {
        lines.push(`${key}: []`);
        continue;
      }

      lines.push(`${key}:`);
      for (const item of value) {
        lines.push(`  - ${item}`);
      }
      continue;
    }

    // Values come from the spec: no HTML tags or script URLs, which a docs
    // theme could put into a page title or a link.
    const clean = typeof value === "string" ? value.replace(/<[^<>]{0,500}>/g, "").replace(/<(?=[a-z/!])/gi, "").replace(/\b(?:javascript|vbscript)\s*:/gi, "").replace(/\bdata:(?=[a-z]+\/)/gi, "") : value;
    lines.push(`${key}: ${JSON.stringify(clean)}`);
  }

  lines.push("---", "");
  return lines.join("\n");
}

function pickAllowedValue(value, allowedValues, fallback) {
  return allowedValues.has(value) ? value : fallback;
}

function formatOverviewValue(value, fallback = "Needs SME input") {
  if (Array.isArray(value)) {
    const items = value.map((item) => normalizeText(item)).filter(Boolean);
    return items.length > 0 ? items.map((item) => `- ${item}`).join("\n") : fallback;
  }

  const text = normalizeText(value);
  return text || fallback;
}

function resolveReference(spec, value, depth = 0) {
  if (!value || typeof value !== "object" || !value.$ref || !value.$ref.startsWith("#/") || depth > 20) {
    return value;
  }

  const segments = value.$ref.slice(2).split("/");
  let current = spec;
  for (const segment of segments) {
    current = current?.[segment];
  }
  if (!current) {
    return value;
  }

  // OpenAPI 3.1 allows keywords such as description next to $ref; they apply
  // on top of the referenced object.
  const { $ref, ...siblings } = value;
  const target = resolveReference(spec, current, depth + 1);
  return Object.keys(siblings).length > 0 ? { ...target, ...siblings } : target;
}

// Table cells must stay on one line and must not contain an unescaped pipe.
function tableCell(text) {
  return normaliseEmphasis(cleanSpecText(text)
    // A list inside one cell reads as bullets, not as emphasis markers (MD037).
    .replace(/(^|\n)[ \t]*(?:[-*+]|\d+[.)])[ \t]+/g, "$1• ")
    .replace(/^• /, "")
    .replace(/\r?\n+/g, " ")
    .replace(/(?<!\\)\|/g, "\\|")
    .replace(/\s{2,}/g, " ")
    .trim());
}

// Spec prose often carries HTML line breaks and comments meant for other
// renderers (ReDoc, Swagger UI). Breaks become spaces; comments are dropped.
// Formatting tags such as <p>, <b> and <a href> become Markdown, so they
// read as formatting rather than as escaped tag text. Any other tag is
// escaped later, outside code, by escapeUntrustedHtml.
function cleanSpecText(text) {
  return String(text ?? "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/?p(?:\s[^<>]{0,500})?>/gi, "\n\n")
    .replace(/<(b|strong)>([^<]*)<\/\1>/gi, "**$2**")
    .replace(/<(i|em)>([^<]*)<\/\1>/gi, "*$2*")
    .replace(/<code>([^<`]*)<\/code>/gi, "`$1`")
    .replace(/<a\s[^<>]{0,500}?href\s*=\s*["'](https?:\/\/[^"'\s<>]+)["'][^<>]{0,500}>([^<]*)<\/a>/gi, (match, url, label) => (label.trim() ? `[${label.trim()}](${url})` : `<${url}>`))
    .replace(/<li(?:\s[^<>]{0,500})?>\s*/gi, "\n- ")
    .replace(/<\/li>/gi, "")
    .replace(/<\/?(?:ul|ol)(?:\s[^<>]{0,500})?>/gi, "\n")
    // A link to an anchor on the spec's own page (ReDoc's #operationId) has
    // nowhere to go in a generated doc; keep its text (MD051).
    .replace(/\[([^\]\n]+)\]\(#[^)\s]*\)/g, "$1")
    .replace(/^\n+|\n+$/g, "")
    .replace(/\n{3,}/g, "\n\n");
}

// One emphasis style (asterisks), and a lone "*" escaped, so spec prose that
// mixes _x_ and *x* or leaves a stray asterisk passes MD037, MD049 and MD050.
// snake_case words and code spans are left alone.
function normaliseEmphasis(text) {
  return String(text).split(/(`+[^`\n]*?`+)/).map((part, index) => (index % 2 === 1 ? part : part
    .replace(/(^|[\s([])__(?=\S)([^_\n]*?\S)__(?=$|[\s.,;:!?)\]])/g, "$1**$2**")
    .replace(/(^|[\s([])_(?=\S)([^_\n]*?\S)_(?=$|[\s.,;:!?)\]])/g, "$1*$2*")
    .replace(/\\\*|\*\*(?=\S)([^*\n]*?\S)\*\*|\*(?=[^\s*])([^*\n]*?[^\s*\\])\*|\*/g, (match) => (match === "*" ? "\\*" : match)))).join("");
}

// Spec Markdown, made to pass the markdownlint rules the docs are checked
// with: one list marker, and blank lines around headings, fences and lists.
function tidyMarkdown(text) {
  const lines = String(text).split("\n");
  const out = [];
  let fence = null;
  const isList = (line) => /^\s*(?:[-*+]|\d+[.)])\s+/.test(line);
  const blankBefore = () => {
    if (out.length > 0 && out[out.length - 1].trim() !== "") out.push("");
  };
  for (let index = 0; index < lines.length; index += 1) {
    let line = fence ? lines[index] : lines[index].replace(/[ \t]+$/, "");
    const fenceMatch = /^\s*(`{3,}|~{3,})/.exec(line);
    if (fence) {
      out.push(line);
      if (fenceMatch && fenceMatch[1][0] === fence[0] && fenceMatch[1].length >= fence.length) {
        fence = null;
        if (index + 1 < lines.length && lines[index + 1].trim() !== "") out.push("");
      }
      continue;
    }
    if (fenceMatch) {
      blankBefore();
      fence = fenceMatch[1];
      out.push(line);
      continue;
    }
    if (/^#{1,6}\s/.test(line)) {
      blankBefore();
      out.push(line);
      if (index + 1 < lines.length && lines[index + 1].trim() !== "") out.push("");
      continue;
    }
    if (isList(line)) {
      line = line.replace(/^(\s*)[*+](\s+)/, "$1-$2");
      if (out.length > 0 && out[out.length - 1].trim() !== "" && !isList(out[out.length - 1]) && !/^\s+\S/.test(out[out.length - 1])) out.push("");
      out.push(line);
      const next = lines[index + 1];
      if (next !== undefined && next.trim() !== "" && !isList(next) && !/^\s+\S/.test(next)) out.push("");
      continue;
    }
    out.push(normaliseEmphasis(line));
  }
  // A fence the spec never closes would turn the rest of the doc into code.
  if (fence) {
    out.push(fence);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n");
}

// A code span that survives backticks inside the value.
function codeSpan(value) {
  const text = String(value);
  if (!text.includes("`")) {
    return `\u0000${text}\u0000`;
  }
  const longest = Math.max(...(text.match(/`+/g) || [""]).map((run) => run.length));
  const fence = "\u0000".repeat(longest + 1);
  return `${fence} ${text} ${fence}`;
}

// A fenced code block whose fence is longer than any backtick run inside it,
// so content such as a JSON string containing three backticks cannot close it.
function fenced(lang, body) {
  const longest = Math.max(0, ...(String(body).match(/`+/g) || []).map((run) => run.length));
  const fence = "\u0000".repeat(Math.max(3, longest + 1));
  return `${fence}${lang}\n${body}\n${fence}`;
}

// One line of text, for headings and frontmatter values.
function oneLine(text) {
  return cleanSpecText(text).replace(/\s*\r?\n\s*/g, " ").trim();
}

// The local calendar date, so last_reviewed matches the day the docs were generated.
function localDate() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

// Spec descriptions can contain their own Markdown headings; demote them so
// they cannot add a second "## Authentication" to a generated doc.
function demoteHeadings(text) {
  const source = tidyMarkdown(cleanSpecText(text));
  const levels = [...source.matchAll(/^(#{1,6})\s+/gm)].map((match) => match[1].length);
  if (levels.length === 0) {
    return source;
  }
  // The spec's highest heading becomes ###, and every other heading keeps its
  // distance from it, so the hierarchy never skips a level.
  const shift = 3 - Math.min(...levels);
  return source.replace(/^(#{1,6})(\s+)/gm, (match, hashes, space) => `${"#".repeat(Math.min(Math.max(hashes.length + shift, 3), 6))}${space}`);
}

function resolveSchema(spec, schema) {
  return resolveSharedSchema(spec, schema);
}

// Picks the media type to document: JSON first, then form, multipart, or
// whatever the spec lists first.
function pickMedia(content) {
  if (!content || typeof content !== "object") {
    return null;
  }
  const types = Object.keys(content);
  const pick = (kind, type) => (type ? { kind, type, media: content[type] || {} } : null);
  return (
    pick("json", types.find((type) => type === "application/json") || types.find((type) => /[/+]json(;|$)/i.test(type))) ||
    pick("form", types.find((type) => /^application\/x-www-form-urlencoded/i.test(type))) ||
    pick("multipart", types.find((type) => /^multipart\//i.test(type))) ||
    pick("other", types[0])
  );
}

// Set in main() so request body references (#/components/requestBodies/...)
// can be followed from functions that only receive the operation.
let currentSpec = null;

function requestBodyOf(operation) {
  return resolveReference(currentSpec, operation.requestBody);
}

function requestMedia(operation) {
  return pickMedia(requestBodyOf(operation)?.content);
}

// The example a media type gives: its example, its first named example, or
// one built from its schema.
function mediaExample(spec, media, mode = "any", changes = null) {
  if (!media) {
    return undefined;
  }
  if (media.example !== undefined) {
    return media.example;
  }
  const firstExample = media.examples ? resolveReference(spec, Object.values(media.examples)[0]) : undefined;
  if (firstExample?.value !== undefined) {
    return firstExample.value;
  }
  const schema = resolveSchema(spec, media.schema);
  // An example on the schema itself is still the spec's own example: return
  // it as written, so the caller corrects it and says what changed.
  if (schema?.example !== undefined) {
    return schema.example;
  }
  if (Array.isArray(schema?.examples) && schema.examples.length > 0) {
    return schema.examples[0];
  }
  return schema ? exampleFor(spec, schema, mode, 0, "", changes) : undefined;
}

// The first server URL, with server variables replaced by their defaults.
// Servers after the first, with their variables filled in, for the overview.
function otherServers(spec) {
  const servers = (spec.servers || []).slice(1).map((server) => ({
    url: normalizeText(server?.url).replace(/\{([^}]+)\}/g, (match, name) => {
      const value = server.variables?.[name]?.default ?? server.variables?.[name]?.enum?.[0];
      return value !== undefined ? String(value) : match;
    }),
    description: oneLine(normalizeText(server?.description))
  })).filter((server) => server.url);
  return servers.length === 0
    ? ""
    : `\n\nOther servers in the spec:\n\n${servers.map((server) => `- ${codeSpan(server.url)}${server.description ? `: ${server.description}` : ""}`).join("\n")}`;
}

function serverUrl(spec, fallback) {
  const server = spec.servers?.[0];
  const url = normalizeText(server?.url);
  if (!url) {
    return fallback;
  }
  return url.replace(/\{([^}]+)\}/g, (match, name) => {
    const variable = server.variables?.[name];
    const value = variable?.default ?? variable?.enum?.[0];
    return value !== undefined ? String(value) : match;
  });
}

function jsonExampleLiteral(value) {
  return typeof value === "string" ? `\`${value}\`` : `\`${JSON.stringify(value)}\``;
}

// A type label inside a table: array<string> goes in a code span so it reads
// the same in the Markdown source as on the page.
function typeCell(spec, schema) {
  const label = schemaTypeLabel(spec, schema);
  return label.includes("<") && !label.includes("|") ? codeSpan(label) : label;
}

function schemaTypeLabel(spec, schema) {
  const resolved = resolveSchema(spec, schema);
  if (!resolved) {
    return "string";
  }

  // OpenAPI 3.1 type arrays: the non-null type; "Nullable" is a separate note.
  const types = [].concat(resolved.type || []);
  const type = types.length > 1 ? (types.find((candidate) => candidate !== "null") || "null") : types[0];

  if (type === "array") {
    return `array<${schemaTypeLabel(spec, resolved.items)}>`;
  }

  const choices = resolved.oneOf || resolved.anyOf;
  if (!resolved.type && Array.isArray(choices) && choices.length > 0) {
    // oneOf: exactly one shape matches; anyOf: one or more may.
    return `${resolved.oneOf ? "one of" : "any of"}: ${[...new Set(choices.map((choice) => schemaTypeLabel(spec, choice)))].join(" \\| ")}`;
  }

  // A schema with no type and no structure accepts any value.
  return type || (resolved.properties ? "object" : Object.keys(resolved).filter((key) => !["description", "title", "example", "examples", "deprecated", "nullable", "readOnly", "writeOnly"].includes(key)).length === 0 ? "any" : "string");
}

// mode "request" leaves out readOnly properties (the server sets them);
// mode "response" leaves out writeOnly properties (the server never returns them).
function includeProperty(spec, propertySchema, mode) {
  return includeForMode(spec, propertySchema, mode);
}

// An example value that fits the schema: see exampleFor in lib/schema-values.mjs.
function buildExampleValue(spec, schema, mode = "any") {
  return exampleFor(spec, schema, mode);
}

function buildConstraintNotes(spec, schema, ownerDescription = "") {
  const resolved = resolveSchema(spec, schema);
  if (!resolved || typeof resolved !== "object") {
    return [];
  }

  const notes = [];
  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) {
    notes.push(`Allowed values: ${resolved.enum.map((value) => codeSpan(value)).join(", ")}`);
  }
  const itemSchema = resolved.type === "array" ? resolveSchema(spec, resolved.items) : null;
  if (Array.isArray(itemSchema?.enum) && itemSchema.enum.length > 0) {
    notes.push(`Allowed values for each item: ${itemSchema.enum.map((value) => codeSpan(value)).join(", ")}`);
  }
  if (resolved.nullable === true || (Array.isArray(resolved.type) && resolved.type.includes("null"))) {
    notes.push("Nullable");
  }
  if (resolved.additionalProperties === true || (resolved.additionalProperties && typeof resolved.additionalProperties === "object")) {
    notes.push(resolved.properties ? "Other keys are also accepted" : "A map: any keys are accepted");
  }
  if (resolved.minLength !== undefined) {
    notes.push(`Minimum length: ${resolved.minLength}`);
  }
  if (resolved.maxLength !== undefined) {
    notes.push(`Maximum length: ${resolved.maxLength}`);
  }
  if (resolved.default !== undefined) {
    notes.push(`Default: ${typeof resolved.default === "object" ? JSON.stringify(resolved.default) : resolved.default}`);
  }
  if (resolved.format) {
    notes.push(`Format: ${resolved.format}`);
  }
  if (typeof resolved.pattern === "string" && resolved.pattern.length <= 200) {
    notes.push(`Pattern: ${codeSpan(resolved.pattern)}`);
  }
  if (resolved.minimum !== undefined) {
    notes.push(`Minimum: ${resolved.minimum}`);
  }
  if (resolved.maximum !== undefined) {
    notes.push(`Maximum: ${resolved.maximum}`);
  }
  // Skip a note the spec's own description already states ("Minimum 1,
  // Maximum 200, Default 20"), so the cell does not say it twice.
  const prose = `${resolved.description || ""} ${ownerDescription || ""}`.toLowerCase();
  return notes.filter((note) => {
    const match = note.match(/^(Default|Minimum|Maximum|Format): (.+)$/);
    if (!match) {
      return true;
    }
    const value = match[2].toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return !new RegExp(`\\b${match[1].toLowerCase()}\\b[^.;]{0,12}?\\b${value}\\b`).test(prose);
  });
}

function joinSentenceParts(parts) {
  const normalizedParts = parts
    .filter(Boolean)
    .map((part) => String(part).trim())
    .filter(Boolean);

  if (normalizedParts.length === 0) {
    return "";
  }

  return normalizedParts.reduce((result, part, index) => {
    if (index === 0) {
      return part;
    }

    const cleanResult = result.replace(/[.\s]+$/, "");
    const cleanPart = part.replace(/^[.\s]+/, "");
    return `${cleanResult}. ${cleanPart}`;
  }, "");
}

function formatRequiredValue(isExplicitlyRequired, requestBodyIsRequired, hasRequiredList) {
  if (isExplicitlyRequired) {
    return "yes";
  }

  if (requestBodyIsRequired && !hasRequiredList) {
    return "unspecified";
  }

  return "no";
}

function buildSchemaDescription(spec, schema) {
  const resolved = resolveSchema(spec, schema);
  const explicitDescription = normalizeText(resolved?.description);
  const notes = buildConstraintNotes(spec, resolved);
  if (resolved?.deprecated) {
    notes.unshift("Deprecated");
  }
  if (explicitDescription) {
    return tableCell(joinSentenceParts([explicitDescription, ...notes]));
  }

  if (resolved?.example !== undefined) {
    notes.unshift(`Example value: ${jsonExampleLiteral(resolved.example)}`);
  }

  return notes.length > 0
    ? tableCell(joinSentenceParts(["Needs SME input for field semantics", ...notes]))
    : "Needs SME input";
}

// The first sentence of a scheme description, without Markdown structure,
// for endpoint docs; the overview keeps the full text.
function briefDescription(text) {
  const flat = cleanSpecText(text).replace(/^\s*[-*+]\s+/gm, "").replace(/^#+\s+/gm, "").replace(/\s+/g, " ").trim();
  const first = flat.split(/(?<=[.!?])\s+/)[0] || "";
  return first.length > 200 ? `${first.slice(0, 197).replace(/\s+\S*$/, "")}...` : first;
}

function summarizeSecuritySchemes(spec, securityRequirements, { brief = false } = {}) {
  const schemes = spec.components?.securitySchemes || {};
  const summaries = [];

  for (const requirement of securityRequirements) {
    const parts = [];
    for (const [schemeName, scopes] of Object.entries(requirement || {})) {
      const scheme = resolveReference(spec, schemes[schemeName]);
      if (!scheme) {
        continue;
      }
      const summaries = parts; // each scheme of this requirement

      const schemeDescription = brief ? briefDescription(scheme.description) : cleanSpecText(normalizeText(scheme.description)).replace(/\n+/g, " ");
      const withDescription = (label) => (schemeDescription ? `${label}: ${schemeDescription.replace(/[.\s]+$/, "")}` : label);

      if (scheme.type === "http" && String(scheme.scheme).toLowerCase() === "bearer") {
        const bearerFormat = normalizeText(scheme.bearerFormat);
        summaries.push(withDescription(bearerFormat ? `HTTP Bearer token (${bearerFormat})` : "HTTP Bearer token"));
        continue;
      }

      if (scheme.type === "http" && String(scheme.scheme).toLowerCase() === "basic") {
        summaries.push(withDescription("HTTP Basic authentication"));
        continue;
      }

      if (scheme.type === "apiKey") {
        summaries.push(withDescription(`API key in ${scheme.in || "header"} \`${scheme.name || schemeName}\``));
        continue;
      }

      if (scheme.type === "oauth2") {
        const scopeText = Array.isArray(scopes) && scopes.length > 0 ? ` (scopes: ${scopes.map((scope) => codeSpan(scope)).join(", ")})` : "";
        summaries.push(withDescription(`OAuth 2.0${scopeText}`));
        continue;
      }

      summaries.push(withDescription(`${scheme.type || "security"} \`${schemeName}\``));
    }
    if (parts.length === 1) {
      summaries.push(parts[0]);
    } else if (parts.length > 1) {
      // Several schemes in one requirement must all be sent together.
      summaries.push(brief
        ? `all of these together: ${parts.map((part) => part.replace(/[.\s]+$/, "")).join("; ")}`
        : `all of these are required together:\n\n${parts.map((part) => `- ${part.replace(/[.\s]+$/, "")}.`).join("\n")}`);
    }
  }

  return [...new Set(summaries)];
}

function buildAuthenticationText(spec, operation, pathItem = null) {
  const securityRequirements = Array.isArray(operation.security)
    ? operation.security
    : (Array.isArray(spec.security) ? spec.security : []);

  if (securityRequirements.length === 0) {
    return noSecurityText(spec, extractParameters(spec, operation, pathItem || {}));
  }

  const summaries = summarizeSecuritySchemes(spec, securityRequirements, { brief: true });
  if (summaries.length === 0) {
    return "Authentication is required. Validate the exact scheme against the source OpenAPI file.";
  }

  return `Authentication is required. Use ${summaries.join(" or ")}.`;
}

// With no security scheme, a spec may still send credentials as ordinary
// header parameters (Api-Key, X-Auth-Token). Say so instead of "none".
function credentialHeaderNames(parameters) {
  return parameters
    .filter((parameter) => parameter.in === "header" && /(api[-_]?key|token|auth|secret|session|password|username)/i.test(parameter.name))
    .map((parameter) => parameter.name);
}

function noSecurityText(spec, parameters) {
  const names = [...new Set(credentialHeaderNames(parameters || []))];
  return names.length > 0
    ? `The spec defines no security scheme, but this operation takes credential-like headers: ${names.map((name) => `\u0000${name}\u0000`).join(", ")}. See the Header Parameters table and confirm with an SME.`
    : "No authentication requirements are defined in the OpenAPI specification.";
}

function allOperations(spec) {
  return Object.entries(spec.paths || {}).flatMap(([route, pathItem]) =>
    ["get", "post", "put", "patch", "delete", "head", "options"].filter((method) => pathItem?.[method]).map((method) => ({ route, method, operation: pathItem[method], pathItem })));
}

function buildOverviewAuthentication(spec) {
  // The global requirements, then any other requirement an operation sets
  // (such as HTTP Basic on a token endpoint), so no scheme goes unmentioned.
  const operations = allOperations(spec);
  const operationRequirements = operations.flatMap(({ operation }) => (Array.isArray(operation.security) ? operation.security : []));
  const seenRequirements = new Set();
  const securityRequirements = [
    ...(Array.isArray(spec.security) && spec.security.length > 0 ? spec.security : []),
    ...operationRequirements
  ].filter((requirement) => requirement && Object.keys(requirement).length > 0).filter((requirement) => {
    const key = JSON.stringify(Object.keys(requirement).sort());
    if (seenRequirements.has(key)) return false;
    seenRequirements.add(key);
    return true;
  });
  if (securityRequirements.length === 0) {
    securityRequirements.push(...Object.keys(spec.components?.securitySchemes || {}).map((schemeName) => ({ [schemeName]: [] })));
  }
  const openOperations = operations.filter(({ operation }) => Array.isArray(operation.security) && (operation.security.length === 0 || operation.security.some((requirement) => Object.keys(requirement || {}).length === 0)));
  const openNote = securityRequirements.length > 0 && openOperations.length > 0
    ? `\n\n${openOperations.length === 1 ? "One operation needs" : `${openOperations.length} operations need`} no authentication: ${openOperations.slice(0, 6).map(({ method, route }) => codeSpan(`${method.toUpperCase()} ${route}`)).join(", ")}${openOperations.length > 6 ? ` and ${openOperations.length - 6} more` : ""}.`
    : "";
  // "Any one of these" is true only when every operation accepts the same choices.
  const signature = (requirements) => JSON.stringify((requirements || []).filter((requirement) => Object.keys(requirement || {}).length > 0).map((requirement) => Object.keys(requirement).sort().join("+")).sort());
  const signatures = new Set(operations.map(({ operation }) => signature(Array.isArray(operation.security) ? operation.security : spec.security)).filter((value) => value !== "[]"));
  const mixed = signatures.size > 1;
  return buildOverviewAuthenticationText(spec, securityRequirements, mixed) + openNote;
}

function buildOverviewAuthenticationText(spec, securityRequirements, mixed = false) {
  if (securityRequirements.length === 0) {
    const allParameters = Object.entries(spec.paths || {}).flatMap(([route, pathItem]) =>
      ["get", "post", "put", "patch", "delete"].filter((method) => pathItem?.[method]).flatMap((method) => extractParameters(spec, pathItem[method], pathItem)));
    return noSecurityText(spec, allParameters).replace("this operation takes", "operations take").replace("See the Header Parameters table and confirm", "Confirm the scheme");
  }
  const summaries = summarizeSecuritySchemes(spec, securityRequirements);
  if (summaries.length === 0) {
    return "Needs SME input";
  }
  const sentence = (text) => (text.includes("\n- ") ? `${text.charAt(0).toUpperCase()}${text.slice(1)}` : `${text.charAt(0).toUpperCase()}${text.slice(1).replace(/[.\s]+$/, "")}.`);
  return summaries.length === 1
    ? sentence(summaries[0])
    : `${mixed ? "The API uses these schemes; each endpoint's Authentication Requirements section says which one it needs:" : "Use any one of these:"}\n\n${summaries.map((entry) => `- ${sentence(entry)}`).join("\n")}`;
}

// The credential arguments a curl example needs, based on the spec's security
// requirements. No requirements means no credentials are added.
function buildCredentialArgs(spec, operation) {
  const firstRequirement = firstSecurityRequirement(spec, operation);
  if (!firstRequirement) {
    return [];
  }

  const schemes = spec.components?.securitySchemes || {};
  const args = [];
  for (const schemeName of Object.keys(firstRequirement)) {
    const scheme = resolveReference(spec, schemes[schemeName]);
    if (!scheme) {
      continue;
    }
    if (scheme.type === "http" && String(scheme.scheme).toLowerCase() === "basic") {
      args.push('-u "<username>:<password>"');
    } else if (scheme.type === "apiKey" && scheme.in === "header" && scheme.name) {
      // An API key sent in Authorization often has a prefix the spec states
      // in prose, such as "Bearer <key>".
      const prefix = headerName(scheme.name).toLowerCase() === "authorization" ? (normalizeText(scheme.description).match(/\b(Bearer|Token|Basic|ApiKey)\s+</i)?.[1] || "") : "";
      args.push(`-H "${headerName(scheme.name)}: ${prefix ? `${prefix} ` : ""}<api-key>"`);
    } else if (scheme.type === "apiKey" && scheme.in === "cookie" && scheme.name) {
      args.push(`--cookie "${headerName(scheme.name)}=<api-key>"`);
    } else if (scheme.type === "http" || scheme.type === "oauth2" || scheme.type === "openIdConnect") {
      args.push('-H "Authorization: Bearer <token>"');
    }
  }
  return args;
}

function humanizeOperationId(operationId) {
  const value = normalizeText(operationId);
  if (!value) {
    return "";
  }
  return value
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function extractParameters(spec, operation, pathItem) {
  const combined = [...(pathItem.parameters || []), ...(operation.parameters || [])]
    .map((parameter) => resolveReference(spec, parameter))
    .filter((parameter) => parameter && parameter.name && parameter.in);
  const seen = new Set();

  return combined.filter((parameter) => {
    const key = `${parameter.name}:${parameter.in}`;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function buildParameterRows(spec, parameters) {
  if (parameters.length === 0) {
    return "| None | n/a | no | No parameters defined |";
  }

  return parameters
    .map((parameter) => {
      const type = typeCell(spec, parameter.schema);
      const required = parameter.required ? "yes" : "no";
      const description = tableCell(joinSentenceParts([
        normalizeText(parameter.description, "Needs SME input"),
        ...(parameter.deprecated ? ["Deprecated"] : []),
        ...buildConstraintNotes(spec, parameter.schema, parameter.description)
      ]));
      const row = `| ${tableCell(parameter.name)} | ${type} | ${required} | ${description} |`;
      return [row, ...deepObjectRows(spec, parameter)].join("\n");
    })
    .join("\n");
}

// A deepObject query parameter is sent as name[key]=value, so each key gets
// its own row with its type, allowed values and default.
function isDeepObject(spec, parameter) {
  const schema = resolveSchema(spec, parameter.schema) || {};
  return parameter.in === "query" && parameter.style === "deepObject" && (schema.type === "object" || schema.properties);
}

function deepObjectRows(spec, parameter) {
  if (!isDeepObject(spec, parameter)) {
    return [];
  }
  const schema = resolveSchema(spec, parameter.schema) || {};
  const required = new Set(schema.required || []);
  return Object.entries(schema.properties || {}).map(([key, propertySchema]) => {
    const resolved = resolveSchema(spec, propertySchema) || {};
    const description = tableCell(joinSentenceParts([
      normalizeText(resolved.description, `Sent as \u0000${parameter.name}[${key}]\u0000`),
      ...(resolved.deprecated ? ["Deprecated"] : []),
      ...buildConstraintNotes(spec, propertySchema)
    ]));
    return `| ${tableCell(`${parameter.name}[${key}]`)} | ${typeCell(spec, propertySchema)} | ${required.has(key) ? "yes" : "no"} | ${description} |`;
  });
}

function buildSplitParameterSections(spec, parameters) {
  const pathParams = parameters.filter((parameter) => parameter.in === "path");
  const queryParams = parameters.filter((parameter) => parameter.in === "query");

  const pathSection = pathParams.length === 0
    ? "Not applicable."
    : `| Name | Type | Required | Description |\n| --- | --- | --- | --- |\n${buildParameterRows(spec, pathParams)}`;

  const querySection = queryParams.length === 0
    ? "Not applicable."
    : `| Name | Type | Required | Description |\n| --- | --- | --- | --- |\n${buildParameterRows(spec, queryParams)}`;

  const headerParams = parameters.filter((parameter) => parameter.in === "header");
  const headerSection = headerParams.length === 0
    ? null
    : `| Name | Type | Required | Description |\n| --- | --- | --- | --- |\n${buildParameterRows(spec, headerParams)}`;

  const cookieParams = parameters.filter((parameter) => parameter.in === "cookie");
  const cookieSection = cookieParams.length === 0
    ? null
    : `| Name | Type | Required | Description |\n| --- | --- | --- | --- |\n${buildParameterRows(spec, cookieParams)}`;

  return { pathSection, querySection, headerSection, headerParams, cookieSection, cookieParams };
}

function refName(schema) {
  return typeof schema?.$ref === "string" ? schema.$ref.split("/").pop() : "";
}

// One row per request field, plus nested object fields (parent.child) and
// fields of arrays of objects (parent[].child), six levels deep. readOnly
// fields are left out because the server sets them.
function bodyFieldRows(spec, schema, requestBodyIsRequired, prefix = "", depth = 0, optionLabel = "", ancestors = new Set(), seen = new Set()) {
  const resolved = resolveSchema(spec, schema);
  // A schema that contains itself (a tree, a linked list) is listed once,
  // not once per level, and no row appears twice.
  const identity = typeof schema?.$ref === "string" ? schema.$ref : schema;
  if (ancestors.has(identity)) {
    return [];
  }
  const nextAncestors = new Set(ancestors).add(identity);
  const properties = resolved?.properties || {};
  const requiredFields = new Set(Array.isArray(resolved?.required) ? resolved.required : []);
  const hasRequiredList = requiredFields.size > 0;
  const rows = [];

  for (const [name, propertySchema] of Object.entries(properties)) {
    if (!includeProperty(spec, propertySchema, "request")) {
      continue;
    }
    const fullName = prefix ? `${prefix}.${name}` : name;
    if (seen.has(`${optionLabel}|${fullName}`)) {
      continue;
    }
    seen.add(`${optionLabel}|${fullName}`);
    const required = prefix
      ? (requiredFields.has(name) ? "yes" : "no")
      : formatRequiredValue(requiredFields.has(name), requestBodyIsRequired, hasRequiredList);
    rows.push(`| ${fullName} | ${typeCell(spec, propertySchema)} | ${required} | ${optionLabel}${buildSchemaDescription(spec, propertySchema)} |`);

    if (depth >= 5) {
      continue;
    }
    const child = resolveSchema(spec, propertySchema);
    const choices = child && !child.properties ? (child.oneOf || child.anyOf) : null;
    if (child?.properties) {
      rows.push(...bodyFieldRows(spec, propertySchema, false, fullName, depth + 1, optionLabel, nextAncestors, seen));
    } else if (Array.isArray(choices) && choices.length > 0) {
      // A field that takes one of several object shapes: list each shape's
      // fields, labelled with the option they belong to.
      choices.forEach((choice, index) => {
        const resolvedChoice = resolveSchema(spec, choice);
        const name = normalizeText(resolvedChoice?.title) || refName(choice);
        const label = `Option ${index + 1} of ${choices.length}${name ? ` (${name})` : ""}. `;
        rows.push(...bodyFieldRows(spec, choice, false, fullName, depth + 1, label, nextAncestors, seen));
      });
    } else if (child?.type === "array") {
      const item = resolveSchema(spec, child.items);
      if (item?.properties) {
        rows.push(...bodyFieldRows(spec, child.items, false, `${fullName}[]`, depth + 1, optionLabel, nextAncestors, seen));
      }
    }
  }
  return rows;
}

function buildRequestBodySection(spec, operation) {
  const media = requestMedia(operation);
  if (!media) {
    return "Not applicable.";
  }

  const schema = resolveSchema(spec, media.media.schema);
  const requestBodyIsRequired = requestBodyOf(operation)?.required === true;
  const header = "| Field | Type | Required | Description |\n| --- | --- | --- | --- |";
  const intro = requestBodyIsRequired ? "Request body is required." : "Request body is optional.";
  const alternates = otherMediaTypes(requestBodyOf(operation)?.content, media.type);
  const typeNote = `${media.type !== "application/json" ? ` Content type: \`${media.type}\`.` : ""}${alternates.length ? ` The spec also accepts ${alternates.map((type) => `\`${type}\``).join(" or ")} for this body; the fields and example below are for \`${media.type}\`.` : ""}`;

  const variants = schema && !schema.properties ? (schema.oneOf || schema.anyOf) : null;
  if (Array.isArray(variants) && variants.length > 0) {
    const quantity = schema.oneOf ? "exactly one" : "at least one";
    const parts = variants.map((variant, index) => {
      const resolvedVariant = resolveSchema(spec, variant);
      const name = normalizeText(resolvedVariant?.title) || refName(variant) || `Shape ${index + 1}`;
      const rows = bodyFieldRows(spec, resolvedVariant, true);
      const body = rows.length > 0
        ? `${header}\n${rows.join("\n")}`
        : `Type: ${schemaTypeLabel(spec, resolvedVariant)}. ${buildSchemaDescription(spec, resolvedVariant)}`;
      return `### Option ${index + 1}: ${name}\n\n${body}`;
    });
    return `${intro}${typeNote} The body must match ${quantity} of these ${variants.length} shapes. The request example uses option 1.\n\n${parts.join("\n\n")}`;
  }

  const rows = schema ? bodyFieldRows(spec, schema, requestBodyIsRequired) : [];
  if (rows.length === 0) {
    const detail = schema ? `Type: ${schemaTypeLabel(spec, schema)}. ${buildSchemaDescription(spec, schema)}` : "Needs SME input";
    return `${intro}${typeNote} ${detail}`;
  }

  const hasRequiredList = Array.isArray(schema.required) && schema.required.length > 0;
  const requiredNote = requestBodyIsRequired
    ? (hasRequiredList
      ? " Fields not listed as required in the schema are optional."
      : " The schema does not declare which individual fields are required.")
    : "";
  const nestedNote = rows.some((row) => /^\| [^|]*\./.test(row))
    ? " For nested fields, Required means required when the parent field is sent."
    : "";
  return `${intro}${typeNote}${requiredNote}${nestedNote}\n\n${header}\n${rows.join("\n")}`;
}

function buildRequestBodyExample(spec, operation) {
  const media = requestMedia(operation);
  if (!media) {
    return null;
  }
  const built = [];
  let value = mediaExample(spec, media.media, "request", built);
  if (value === undefined) {
    return null;
  }

  // A spec's own example can break its own schema: fields it does not define,
  // readOnly fields, wrong types, values too long, required fields left out.
  // It is corrected, and the doc says what changed.
  let changes = built;
  if (media.media.schema) {
    ({ value, changes } = conformValue(spec, structuredClone(value), media.media.schema, "request", 0, "", built));
  }
  return { kind: media.kind, type: media.type, value, changes, schema: media.media.schema, encoding: media.media.encoding };
}

function shellQuote(value) {
  return String(value).replace(/(["\\$`])/g, "\\$1");
}

// A multipart field that carries a file rather than text.
function isFileField(spec, name, schema, encoding) {
  const resolved = resolveSchema(spec, schema) || {};
  const itemSchema = resolveSchema(spec, resolved.items) || {};
  return ["binary", "base64"].includes(resolved.format) || ["binary", "base64"].includes(itemSchema.format)
    || Boolean(resolved.contentMediaType) || Boolean(encoding?.[name]?.contentType && !/^text\//.test(encoding[name].contentType))
    || (Object.keys(resolved).length === 0 && /file|upload|image|avatar|attachment|document/i.test(name));
}

// Multipart field names go inside a curl -F argument, where = ; @ < have meaning.
function formFieldName(name) {
  return String(name).replace(/[=;@<>"`$\\\r\n\t\u0000-\u001f]/g, "");
}

function buildRequestBodyArgs(body, spec = null) {
  if (!body) {
    return [];
  }
  const fields = body.value && typeof body.value === "object" && !Array.isArray(body.value) ? Object.entries(body.value) : [];
  const fieldText = (value) => (typeof value === "object" ? JSON.stringify(value) : String(value));
  if (body.kind === "json") {
    return [`-H "Content-Type: ${shellText(body.type)}"`, `-d '${JSON.stringify(body.value).replace(/'/g, "'\\''")}'`];
  }
  if (body.kind === "form") {
    return [
      `-H "Content-Type: ${shellText(body.type)}"`,
      ...fields.map(([name, value]) => `--data-urlencode "${formFieldName(name)}=${shellText(fieldText(value))}"`)
    ];
  }
  if (body.kind === "multipart") {
    // Text fields use --form-string, which never reads a file even if the
    // value starts with @ or <. File fields show a placeholder to replace.
    const properties = resolveSchema(spec, body.schema)?.properties || {};
    return fields.map(([name, value]) => (spec && isFileField(spec, name, properties[name], body.encoding)
      ? `-F "${formFieldName(name)}=@<file>"`
      : `--form-string "${formFieldName(name)}=${shellText(fieldText(value))}"`));
  }
  return [`-H "Content-Type: ${shellText(body.type)}"`, '--data-binary "@<file>"'];
}

function buildResponseExample(spec, operation) {
  const responseEntries = Object.entries(operation.responses || {});
  const successResponse = responseEntries.find(([code]) => code.startsWith("2"));

  if (!successResponse) {
    // Nothing to show; an invented body would be checked as if it were real.
    return { lang: "prose", text: "The spec defines no success (2xx) response for this operation. See Error Codes for the responses it does define." };
  }

  const [statusCode, response] = successResponse;
  const media = pickMedia(resolveReference(spec, response)?.content);
  if (!media) {
    return null;
  }
  const built = [];
  const original = mediaExample(spec, media.media, "response", built);
  if (original === undefined) {
    return JSON.stringify({ status: statusCode, note: "Needs SME input" }, null, 2);
  }
  if (media.kind !== "json") {
    // A CSV, XML or file response is not JSON; showing an invented JSON body
    // would be wrong, and the JSON check would compare it as if it were real.
    return typeof original === "string"
      ? { lang: "text", text: original.replace(/\s+$/, "") }
      : { lang: "prose", text: `The response body is \u0000${media.type}\u0000. The spec gives no example of it: Needs SME input.` };
  }
  const { value, changes } = media.media.schema
    ? conformValue(spec, structuredClone(original), media.media.schema, "response", 0, "", built)
    : { value: original, changes: built };
  return { lang: "json", text: JSON.stringify(value, null, 2), changes };
}

// What was changed in the spec's own example, in a few sentences.
function exampleChangesNote(changes, which = "example") {
  if (!changes?.length) {
    return "";
  }
  const list = (entries) => `${entries.slice(0, 8).map((entry) => `\u0000${entry.path}\u0000`).join(", ")}${entries.length > 8 ? ` and ${entries.length - 8} more` : ""}`;
  const plural = (entries, one, many) => (entries.length === 1 ? one : many);
  const unique = (entries) => entries.filter((entry, index) => entries.findIndex((other) => other.path === entry.path && other.action === entry.action) === index);
  const of = (action, reason) => unique(changes.filter((entry) => entry.action === action && (reason === undefined || entry.reason === reason)));
  const sentences = [];
  const added = of("added");
  if (added.length) {
    sentences.push(`The spec's own ${which} leaves out required ${plural(added, "field", "fields")} ${list(added)}. ${plural(added, "It is", "They are")} added below from the schema.`);
  }
  const undefinedFields = of("removed", "undefined");
  if (undefinedFields.length) {
    sentences.push(`The spec's own example also shows ${plural(undefinedFields, "a field", "fields")} its schema does not define (${list(undefinedFields)}). ${plural(undefinedFields, "It is", "They are")} left out here.`);
  }
  const readOnly = of("removed", "readOnly");
  if (readOnly.length) {
    sentences.push(`The spec's own ${which} sends readOnly ${plural(readOnly, "field", "fields")} ${list(readOnly)}, which the server sets. ${plural(readOnly, "It is", "They are")} left out here.`);
  }
  const writeOnly = of("removed", "writeOnly");
  if (writeOnly.length) {
    sentences.push(`The spec's own ${which} shows writeOnly ${plural(writeOnly, "field", "fields")} ${list(writeOnly)}, which the server never returns. ${plural(writeOnly, "It is", "They are")} left out here.`);
  }
  // Conversions grouped by what they were and what the schema says.
  const converted = of("converted");
  const groups = new Map();
  for (const entry of converted) {
    const match = /^was an? (\S+); the schema says (.+)$/.exec(entry.reason);
    const key = match ? `${match[1]}|${match[2].split(" or ")[0]}` : entry.reason;
    groups.set(key, [...(groups.get(key) || []), entry]);
  }
  for (const [key, entries] of groups) {
    const [from, to] = key.includes("|") ? key.split("|") : [null, null];
    sentences.push(from
      ? `The spec's own example gives ${list(entries)} as ${plural(entries, `a ${from}`, `${from}s`)}, but ${plural(entries, "its schema says", "their schemas say")} ${to}, so ${plural(entries, "it is", "they are")} shown as ${plural(entries, `a ${to}`, `${to}s`)} here.`
      : `The spec's own example gives ${list(entries)} in a form its schema does not allow (${entries[0].reason}); ${plural(entries, "it is", "they are")} converted here.`);
  }
  const replaced = of("replaced");
  if (replaced.length) {
    const reasons = replaced.slice(0, 8).map((entry) => `\u0000${entry.path}\u0000 ${entry.reason}`).join("; ");
    sentences.push(`Some values in the spec's own example break its own schema: ${reasons}${replaced.length > 8 ? `; and ${replaced.length - 8} more` : ""}. ${plural(replaced, "It is", "They are")} replaced here with ${plural(replaced, "a value", "values")} that fit; confirm with an SME.`);
  }
  return `${sentences.join("\n\n")}\n\n`;
}

function findNamedPropertyExample(spec, schema, propertyName) {
  const resolved = resolveSchema(spec, schema);
  if (!resolved || typeof resolved !== "object") {
    return undefined;
  }

  if (resolved.properties?.[propertyName]) {
    return buildExampleValue(spec, resolved.properties[propertyName]);
  }

  if (resolved.items) {
    const itemMatch = findNamedPropertyExample(spec, resolved.items, propertyName);
    if (itemMatch !== undefined) {
      return itemMatch;
    }
  }

  for (const keyword of ["allOf", "anyOf", "oneOf"]) {
    for (const candidate of resolved[keyword] || []) {
      const match = findNamedPropertyExample(spec, candidate, propertyName);
      if (match !== undefined) {
        return match;
      }
    }
  }

  // Only top-level fields of this operation's own request and response are
  // used; a same-named field nested elsewhere may mean something else.
  return undefined;
}

function buildParameterExampleValue(spec, operation, parameter) {
  // The spec's own parameter example, brought in line with its schema.
  const fitted = (value) => (parameter.schema ? conformValue(spec, structuredClone(value), parameter.schema, "request").value : value);
  if (parameter.example !== undefined) {
    return fitted(parameter.example);
  }
  const namedExample = parameter.examples ? resolveReference(spec, Object.values(parameter.examples)[0]) : undefined;
  if (namedExample?.value !== undefined) {
    return fitted(namedExample.value);
  }

  const schemaExample = buildExampleValue(spec, parameter.schema);
  if (schemaExample !== "value") {
    return schemaExample;
  }

  const requestSchema = requestMedia(operation)?.media?.schema;
  const requestMatch = findNamedPropertyExample(spec, requestSchema, parameter.name);
  if (requestMatch !== undefined) {
    return requestMatch;
  }

  for (const response of Object.values(operation.responses || {})) {
    const responseSchema = pickMedia(resolveReference(spec, response)?.content)?.media?.schema;
    const responseMatch = findNamedPropertyExample(spec, responseSchema, parameter.name);
    if (responseMatch !== undefined) {
      return responseMatch;
    }
  }

  return schemaExample;
}

function buildErrorSection(spec, operation) {
  const responseEntries = Object.entries(operation.responses || {})
    .filter(([code]) => !code.startsWith("2"))
    .map(([code, response]) => [code, resolveReference(spec, response) || {}]);

  if (responseEntries.length === 0) {
    return "The OpenAPI specification defines no error responses for this operation.";
  }

  const rows = responseEntries
    .map(([code, response]) => `| ${code} | ${tableCell(normalizeText(response.description, "Needs SME input"))} |`)
    .join("\n");
  const table = `| Code | Description |\n| --- | --- |\n${rows}`;

  const withBody = responseEntries.find(([, response]) => pickMedia(response.content));
  if (!withBody) {
    return table;
  }
  const media = pickMedia(withBody[1].content);
  const original = mediaExample(spec, media.media, "response");
  if (original === undefined || media.kind !== "json") {
    return table;
  }
  const example = media.media.schema ? conformValue(spec, structuredClone(original), media.media.schema, "response").value : original;
  return `${table}\n\nError response body (\u0000${withBody[0]}\u0000):\n\n${fenced("json", JSON.stringify(example, null, 2))}`;
}

// True when the generator fell back to the word "value" because the spec
// gives no example, default or enum for this parameter.
function isPlaceholderValue(spec, parameter, value) {
  if (value !== "value") {
    return false;
  }
  const schema = resolveSchema(spec, parameter.schema) || {};
  return parameter.example !== "value" && schema.example !== "value" && schema.default !== "value" && !(schema.enum || []).includes("value");
}

// Query pairs for one parameter's example value, serialised the way the
// spec's style says: deepObject as name[key]=value, exploded arrays as
// repeated keys. Objects are never written as "[object Object]".
function queryPairs(spec, parameter, value) {
  const encode = (text) => encodeURIComponent(String(text));
  const schema = resolveSchema(spec, parameter.schema) || {};
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const primitive = Object.entries(value).filter(([, entry]) => entry === null || typeof entry !== "object");
    if (parameter.style === "deepObject") {
      return primitive.map(([key, entry]) => `${encode(parameter.name)}[${encode(key)}]=${encode(entry)}`);
    }
    if (parameter.explode === false) {
      return [`${encode(parameter.name)}=${primitive.map(([key, entry]) => `${encode(key)},${encode(entry)}`).join(",")}`];
    }
    return primitive.map(([key, entry]) => `${encode(key)}=${encode(entry)}`);
  }
  if (Array.isArray(value)) {
    const items = value.filter((entry) => entry === null || typeof entry !== "object");
    return parameter.explode === false || (parameter.style && parameter.style !== "form")
      ? [`${encode(parameter.name)}=${items.map(encode).join(",")}`]
      : items.map((entry) => `${encode(parameter.name)}=${encode(entry)}`);
  }
  if (schema.type === "object" || schema.properties) {
    return []; // an object parameter with no usable example
  }
  return [`${encode(parameter.name)}=${encode(value)}`];
}

function buildExampleUrl(spec, route, operation, pathItem) {
  const baseUrl = serverUrl(spec, "https://api.example.com").replace(/\/$/, "");
  const parameters = extractParameters(spec, operation, pathItem);
  let examplePath = route;
  const queryParams = [];

  for (const parameter of parameters) {
    const exampleValue = buildParameterExampleValue(spec, operation, parameter);
    const placeholder = isPlaceholderValue(spec, parameter, exampleValue);
    if (parameter.in === "path") {
      // With no example in the spec, keep a visible {name} placeholder rather than the word "value".
      examplePath = examplePath.replace(`{${parameter.name}}`, placeholder ? `{${parameter.name}}` : encodeURIComponent(String(exampleValue)));
    }
    if (parameter.in === "query") {
      if (placeholder && !parameter.required) {
        continue; // optional, and the spec gives no value to show
      }
      queryParams.push(...(placeholder ? [`${encodeURIComponent(parameter.name)}={${parameter.name}}`] : queryPairs(spec, parameter, exampleValue)));
    }
  }
  for (const name of apiKeyQueryNames(spec, operation)) {
    queryParams.push(`${encodeURIComponent(name)}=<api-key>`);
  }

  return safeUrl(`${baseUrl}${examplePath}${queryParams.length > 0 ? `?${queryParams.join("&")}` : ""}`);
}

// The URL goes inside double quotes in a shell command. Characters the shell
// would act on there, and any whitespace, are percent-encoded, so a crafted
// server URL cannot end the string or run a command.
// Square brackets are encoded too: curl treats them as a glob range and
// fails on name[key]=value when the example is pasted as written.
function safeUrl(url) {
  return String(url).replace(/[\s"`$\\![\]]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
}

// Text placed inside a double-quoted shell argument: no line breaks, and the
// characters the shell interprets there are escaped.
function shellText(value) {
  // "!" triggers history expansion inside double quotes in an interactive
  // shell, so it is written as a single-quoted '!' between the quoted parts.
  return shellQuote(String(value).replace(/[\r\n\t\u0000-\u001f\u007f]+/g, " ")).replace(/!/g, `"'!'"`);
}

// Header names are tokens; anything else is dropped so a name cannot end the
// quoted argument.
function headerName(name) {
  return String(name).replace(/[^A-Za-z0-9!#$%&'*+.^_`|~-]/g, "").replace(/[$`]/g, "");
}

function apiKeyQueryNames(spec, operation) {
  const requirement = firstSecurityRequirement(spec, operation);
  const schemes = spec.components?.securitySchemes || {};
  return Object.keys(requirement || {})
    .map((schemeName) => resolveReference(spec, schemes[schemeName]))
    .filter((scheme) => scheme?.type === "apiKey" && scheme.in === "query" && scheme.name)
    .map((scheme) => scheme.name);
}

function firstSecurityRequirement(spec, operation) {
  const securityRequirements = Array.isArray(operation.security)
    ? operation.security
    : (Array.isArray(spec.security) ? spec.security : []);
  return securityRequirements.find((requirement) => requirement && Object.keys(requirement).length > 0) || null;
}

function buildApiOverview(spec, serviceName, owner) {
  const version = normalizeText(spec.info?.version, "v1");
  const description = normalizeText(spec.info?.description, "Generated API overview from an OpenAPI specification");
  const baseUrl = serverUrl(spec, "Needs SME input");
  const securityImpact = pickAllowedValue(normalizeText(spec.info?.["x-security-impact"]), new Set(["low", "medium", "high"]), "medium");

  const frontmatter = stringifyYamlLines({
    title: `${normalizeText(spec.info?.title, serviceName).replace(/\s+API$/i, "")} API Overview`,
    description: `Generated API overview for ${serviceName}`,
    service: serviceName,
    component: "api",
    owner,
    api_version: version,
    status: "draft",
    dependencies: [],
    last_reviewed: localDate(),
    security_impact: securityImpact
  });

  return `${frontmatter}# API Overview

## Purpose

${demoteHeadings(description)}

## Intended Consumers

${formatOverviewValue(spec.info?.["x-intended-consumers"])}

## Authentication

${buildOverviewAuthentication(spec)}

## Base URL

${codeSpan(baseUrl)}${otherServers(spec)}

## Versioning Strategy

${formatOverviewValue(spec.info?.["x-versioning-strategy"], `Source specification version: ${version}`)}

## Rate Limits

${formatOverviewValue(spec.info?.["x-rate-limits"])}

## Error Handling

${formatOverviewValue(spec.info?.["x-error-handling"], "Generated from the source OpenAPI paths and responses. Validate response semantics with an SME before publishing.")}

## SDK Support

${formatOverviewValue(spec.info?.["x-sdk-support"])}

## Example Use Case

${formatOverviewValue(spec.info?.["x-example-use-case"])}
`.replace(/\u0000/g, "`");
}

// Content types a body can also be sent or returned as, besides the one documented.
function otherMediaTypes(content, documentedType) {
  return Object.keys(content || {}).filter((type) => type !== documentedType);
}

function successEntry(operation) {
  return Object.entries(operation.responses || {}).find(([code]) => code.startsWith("2")) || null;
}

// Headers the success response sets, such as Link for paging.
function responseHeadersText(spec, response) {
  const headers = Object.entries(resolveReference(spec, response)?.headers || {});
  if (headers.length === 0) {
    return "";
  }
  const items = headers.map(([name, header]) => {
    const resolved = resolveReference(spec, header) || {};
    const description = oneLine(normalizeText(resolved.description));
    return `- ${codeSpan(name)}${description ? `: ${description.replace(/[.\s]+$/, "")}.` : ""}`;
  });
  return `Response headers:\n\n${items.join("\n")}\n\n`;
}

// Callbacks the API makes to a URL the client provides.
function callbacksSection(spec, operation) {
  const callbacks = Object.entries(operation.callbacks || {});
  if (callbacks.length === 0) {
    return "";
  }
  const items = [];
  for (const [name, callback] of callbacks) {
    for (const [expression, pathItem] of Object.entries(resolveReference(spec, callback) || {})) {
      for (const method of ["get", "post", "put", "patch", "delete"]) {
        const callbackOperation = pathItem?.[method];
        if (!callbackOperation) continue;
        const summary = oneLine(normalizeText(callbackOperation.summary || callbackOperation.description));
        items.push(`- ${codeSpan(name)}: the API sends ${codeSpan(method.toUpperCase())} to ${codeSpan(expression)}${summary ? `. ${summary.replace(/[.\s]+$/, "")}.` : "."}`);
      }
    }
  }
  return items.length === 0 ? "" : `\n\n## Callbacks\n\n${items.join("\n")}`;
}

// Cookies a request sends: an API key kept in a cookie, and cookie parameters.
function cookieArg(spec, operation, cookieParams, credentialArgs) {
  const pairs = [];
  for (const arg of credentialArgs) {
    const match = /^--cookie "([^"]*)"$/.exec(arg);
    if (match) pairs.push(match[1]);
  }
  for (const parameter of cookieParams) {
    const example = buildParameterExampleValue(spec, operation, parameter);
    const placeholder = isPlaceholderValue(spec, parameter, example);
    if (placeholder && !parameter.required) continue;
    const value = placeholder ? `<${headerName(parameter.name)}>` : typeof example === "object" ? JSON.stringify(example) : String(example);
    pairs.push(`${headerName(parameter.name)}=${shellText(value).replace(/;/g, "%3B")}`);
  }
  return pairs.length === 0 ? [] : [`--cookie "${pairs.join("; ")}"`];
}

function buildEndpointDocument(spec, serviceName, owner, apiVersion, route, method, operation, pathItem) {
  // No trailing full stop: the summary becomes the page heading (MD026).
  const summary = oneLine(normalizeText(operation.summary, humanizeOperationId(operation.operationId) || titleCaseFromSlug(toSlug(`${method}-${route}`)))).replace(/[.,;:!]+$/, "");
  const parameters = extractParameters(spec, operation, pathItem);
  const endpointSlug = toSlug(`${method}-${route}`);
  const isDeprecated = operation.deprecated === true;
  const deprecatedSince = normalizeText(operation["x-deprecated-since"]);
  const sunsetVersion = normalizeText(operation["x-sunset-version"]);
  const replacement = normalizeText(operation["x-replaced-by"]);
  const migrationGuide = normalizeText(operation["x-migration-guide"]);
  const securityImpact = pickAllowedValue(normalizeText(operation["x-security-impact"] || spec.info?.["x-security-impact"]), new Set(["low", "medium", "high"]), "medium");
  const frontmatter = stringifyYamlLines({
    title: `${summary.replace(/<[^<>]{0,500}>/g, "").trim() || summary}`,
    description: `Generated endpoint documentation for ${method.toUpperCase()} ${route}`,
    service: serviceName,
    component: "endpoint",
    owner,
    api_version: apiVersion,
    status: isDeprecated ? "deprecated" : "draft",
    dependencies: [],
    last_reviewed: localDate(),
    security_impact: securityImpact,
    ...(isDeprecated
      ? {
          deprecated_since: deprecatedSince || "Needs SME input",
          sunset_version: sunsetVersion || "Needs SME input",
          replaced_by: replacement || "Needs SME input",
          migration_guide: migrationGuide || "Needs SME input"
        }
      : {})
  });

  const { pathSection, querySection, headerSection, headerParams, cookieSection, cookieParams } = buildSplitParameterSections(spec, parameters);
  // Skip a header parameter only when the credentials or the request body
  // already write that header, so it never appears twice.
  const credentialArgs = buildCredentialArgs(spec, operation);
  const headersWrittenByDefault = new Set();
  if (credentialArgs.some((arg) => arg.startsWith('-H "Authorization:'))) {
    headersWrittenByDefault.add("authorization");
  }
  if (requestMedia(operation)) {
    headersWrittenByDefault.add("content-type");
  }
  const headerArgs = headerParams
    .filter((parameter) => !headersWrittenByDefault.has(parameter.name.toLowerCase()))
    .filter((parameter) => parameter.required || !isPlaceholderValue(spec, parameter, buildParameterExampleValue(spec, operation, parameter)))
    .map((parameter) => {
      const example = buildParameterExampleValue(spec, operation, parameter);
      const name = headerName(parameter.name);
      const value = isPlaceholderValue(spec, parameter, example) ? `<${name}>` : typeof example === "object" ? JSON.stringify(example) : String(example);
      return `-H "${name}: ${shellText(value)}"`;
    });
  const requestBodyExample = buildRequestBodyExample(spec, operation);
  const requestBodySection = buildRequestBodySection(spec, operation);
  const exampleUrl = buildExampleUrl(spec, route, operation, pathItem);
  const success = successEntry(operation);
  const successMedia = success ? pickMedia(resolveReference(spec, success[1])?.content) : null;
  // A CSV or file download names the type it wants back.
  const acceptArgs = successMedia && successMedia.kind !== "json" && !headerParams.some((parameter) => parameter.name.toLowerCase() === "accept")
    ? [`-H "Accept: ${shellText(successMedia.type)}"`]
    : [];
  const curlArgs = [
    `curl -X ${method.toUpperCase()} "${exampleUrl}"`, // safeUrl already removed shell characters
    ...credentialArgs.filter((arg) => !arg.startsWith("--cookie ")),
    ...cookieArg(spec, operation, cookieParams, credentialArgs),
    ...headerArgs,
    ...acceptArgs,
    ...buildRequestBodyArgs(requestBodyExample, spec)
  ];
  const requestExample = curlArgs.join(" \\\n  ");
  const requestExampleNote = exampleChangesNote(requestBodyExample?.changes, "request example");
  const requestPruneNote = "";
  const authText = buildAuthenticationText(spec, operation, pathItem);
  const responseExample = buildResponseExample(spec, operation);
  const successCode = Object.keys(operation.responses || {}).find((code) => code.startsWith("2"));
  const otherResponseTypes = successMedia ? otherMediaTypes(resolveReference(spec, success[1])?.content, successMedia.type) : [];
  const statusLine = successCode
    ? `Status: \u0000${successCode}\u0000\n\n${otherResponseTypes.length ? `The response can also be ${otherResponseTypes.map((type) => codeSpan(type)).join(" or ")}; the example shows ${codeSpan(successMedia.type)}.\n\n` : ""}${responseHeadersText(spec, success[1])}`
    : "";
  const responseExampleSection = responseExample === null
    ? `This operation returns \u0000${successCode}\u0000 with no response body.`
    : typeof responseExample === "object"
      ? (responseExample.lang === "prose" ? responseExample.text : fenced(responseExample.lang, responseExample.text))
      : fenced("json", responseExample);
  // Headings inside the spec's description must not become sections of the doc.
  const purpose = demoteHeadings(normalizeText(operation.description, summary));
  const lifecycleSection = isDeprecated
    ? `

## Deprecation

${deprecatedSince ? `This endpoint is deprecated as of ${deprecatedSince}.` : "This endpoint is deprecated. The spec does not say since which version: Needs SME input."}${sunsetVersion ? ` It is scheduled to sunset in ${sunsetVersion}.` : ""}

## Migration

${replacement ? `Move clients to \`${replacement}\`.` : "Needs SME input"}

${migrationGuide ? `Migration guide: \`${migrationGuide}\`.` : "Migration guide: Needs SME input."}`
    : "";

  return {
    endpointSlug,
    content: `${frontmatter}# Endpoint: ${summary}

## Summary

${purpose}

## Endpoint

- Method: \`${method.toUpperCase()}\`
- URL: \`${route}\`

## Authentication Requirements

${authText}

## Path Parameters

${pathSection}

## Query Parameters

${querySection}

${headerSection ? `## Header Parameters\n\n${headerSection}\n\n` : ""}${cookieSection ? `## Cookie Parameters\n\n${cookieSection}\n\n` : ""}## Request Body

${requestBodySection}

## Request Example

${requestExampleNote}${requestPruneNote}${fenced("bash", requestExample)}

## Response Example

${responseExample === null ? "" : statusLine}${exampleChangesNote(responseExample?.changes, "response example")}${responseExampleSection}

## Error Codes

${buildErrorSection(spec, operation)}${callbacksSection(spec, operation)}

## Performance Notes

${normalizeText(operation["x-performance-notes"], "Needs SME input")}${lifecycleSection}
`.replace(/\u0000/g, "`")
  };
}

async function ensureDirectory(directory) {
  await fs.mkdir(directory, { recursive: true });
}

// Limits on what a spec may cost to read. A YAML alias bomb is a few lines
// that expand to billions of values; a value count with aliases counted at
// every use stops it before the generator walks the tree.
const MAX_SPEC_BYTES = Number(process.env.REPODOCS_MAX_SPEC_BYTES || 50 * 1024 * 1024);
const MAX_SPEC_VALUES = Number(process.env.REPODOCS_MAX_SPEC_VALUES || 5_000_000);

function checkSpecSize(spec, source) {
  let count = 0;
  const stack = [spec];
  while (stack.length > 0) {
    const value = stack.pop();
    count += 1;
    if (count > MAX_SPEC_VALUES) {
      throw new Error(`Could not read ${source}: it expands to more than ${MAX_SPEC_VALUES} values, which usually means YAML aliases repeated many times over. Set REPODOCS_MAX_SPEC_VALUES to allow a larger spec.`);
    }
    if (value && typeof value === "object") {
      for (const child of Array.isArray(value) ? value : Object.values(value)) {
        stack.push(child);
      }
    }
  }
}

async function parseSpec(inputPath) {
  const stats = await fs.stat(inputPath);
  if (stats.size > MAX_SPEC_BYTES) {
    throw new Error(`Could not read ${inputPath}: it is ${stats.size} bytes, more than the ${MAX_SPEC_BYTES}-byte limit. Set REPODOCS_MAX_SPEC_BYTES to allow a larger spec.`);
  }
  const raw = await fs.readFile(inputPath, "utf8");
  let spec;
  try {
    // CORE_SCHEMA keeps values like 2018-01-01 10:00:00 as written instead of
    // turning them into local-time Date objects.
    spec = inputPath.endsWith(".json") ? JSON.parse(raw) : yaml.load(raw, { schema: yaml.CORE_SCHEMA });
  } catch (error) {
    throw new Error(`Could not read ${inputPath}: ${String(error.message).split("\n")[0]}`);
  }
  checkSpecSize(spec, inputPath);
  return spec;
}

// Output is never written through a symbolic link: a link planted in the
// output folder (by a pull request, say) could point the generator at files
// anywhere on the machine.
async function refuseSymlink(target) {
  try {
    if ((await fs.lstat(target)).isSymbolicLink()) {
      throw new Error(`${target} is a symbolic link; refusing to write through it. Remove the link or choose another output folder.`);
    }
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

async function writeOutput(filePath, content) {
  await refuseSymlink(filePath);
  const { O_WRONLY, O_CREAT, O_TRUNC, O_NOFOLLOW = 0 } = (await import("node:fs")).constants;
  const handle = await fs.open(filePath, O_WRONLY | O_CREAT | O_TRUNC | O_NOFOLLOW, 0o644);
  try {
    await handle.writeFile(content, "utf8");
  } finally {
    await handle.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const positional = args.filter((arg, index) => !arg.startsWith("--") && args[index - 1] !== "--owner");
  const inputArg = positional[0];
  if (!inputArg) {
    console.error("Usage: repodocs-ai generate <path-to-openapi-file> [output-directory] [--owner <team>]");
    process.exit(1);
  }

  // Paths resolve from the directory the command was run in. npm run moves to
  // the package root, so INIT_CWD is used when this script's own npm script
  // started it.
  const baseDirectory = (process.env.npm_lifecycle_event === "generate:openapi" && process.env.INIT_CWD) || process.cwd();
  const outputArg = positional[1];
  const inputPath = path.resolve(baseDirectory, inputArg);
  try {
    await fs.access(inputPath);
  } catch {
    console.error(`OpenAPI spec not found: ${inputPath}`);
    console.error("Paths are resolved from the current directory.");
    console.error("Check the path. To try the bundled example spec, run:");
    console.error("  repodocs-ai init company-docs --with-examples");
    console.error("  repodocs-ai generate company-docs/examples/payments-api/payments-openapi.yaml company-docs/generated/payments-api");
    process.exit(1);
  }
  const spec = await parseSpec(inputPath);
  currentSpec = spec;
  const serviceName = toSlug(normalizeText(spec.info?.title, "generated-api"));
  const ownerFlagIndex = args.indexOf("--owner");
  const owner = (ownerFlagIndex > -1 ? args[ownerFlagIndex + 1] : undefined) || process.env.REPODOCS_OWNER || "unassigned";
  const apiVersion = normalizeText(spec.info?.version, "v1");
  const outputDirectory = outputArg
    ? path.resolve(baseDirectory, outputArg)
    : path.join(baseDirectory, "generated", serviceName);
  const endpointsDirectory = path.join(outputDirectory, "endpoints");

  await refuseSymlink(outputDirectory);
  await refuseSymlink(endpointsDirectory);
  await ensureDirectory(endpointsDirectory);

  const apiOverview = buildApiOverview(spec, serviceName, owner);
  await writeOutput(path.join(outputDirectory, "api-overview.md"), escapeUntrustedHtml(apiOverview));
  // Two routes can make the same file name (/a-b and /a/b both become
  // a-b); the second gets a number instead of overwriting the first.
  const usedSlugs = new Map();

  const supportedMethods = ["get", "post", "put", "patch", "delete"];
  for (const [route, pathItem] of Object.entries(spec.paths || {})) {
    for (const method of supportedMethods) {
      if (!pathItem[method]) {
        continue;
      }

      const { endpointSlug, content } = buildEndpointDocument(
        spec,
        serviceName,
        owner,
        apiVersion,
        route,
        method,
        pathItem[method],
        pathItem
      );

      let fileSlug = endpointSlug;
      for (let suffix = 2; usedSlugs.has(fileSlug); suffix += 1) {
        fileSlug = `${endpointSlug}-${suffix}`;
      }
      if (fileSlug !== endpointSlug) {
        console.warn(`${method.toUpperCase()} ${route} would share the file name ${endpointSlug}.md with ${usedSlugs.get(endpointSlug)}; writing it as ${fileSlug}.md`);
      }
      usedSlugs.set(fileSlug, `${method.toUpperCase()} ${route}`);
      await writeOutput(path.join(endpointsDirectory, `${fileSlug}.md`), escapeUntrustedHtml(content));
    }
  }

  const shownOutput = path.relative(baseDirectory, outputDirectory);
  console.log(`Generated API documentation in ${(shownOutput.startsWith("..") || path.isAbsolute(shownOutput) ? outputDirectory : shownOutput || ".").replace(/\\/g, "/")}`);
}

main().catch((error) => {
  // A plain message for problems the user can fix; a stack only for bugs.
  const expected = /^(Could not read|.* is a symbolic link)/.test(String(error?.message || ""));
  console.error(expected ? error.message : error);
  process.exit(1);
});