import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as yaml from "js-yaml";

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
  // Fenced blocks of three or more backticks, closed by a fence at least as long.
  const segments = body.split(/(^(`{3,})[^\n]*\n[\s\S]*?^\2`*[ \t]*$)/m);
  const out = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    if (index % 3 === 1) {
      // A fence copied from spec prose with no language gets "text" (MD040).
      out.push(segment.replace(/^(`{3,})[ \t]*\n/, "$1text\n")); // fenced code block
      continue;
    }
    if (index % 3 === 2) {
      continue; // the captured fence itself
    }
    out.push(segment
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

    lines.push(`${key}: ${JSON.stringify(value)}`);
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
  return cleanSpecText(text).replace(/\r?\n+/g, " ").replace(/(?<!\\)\|/g, "\\|").replace(/\s{2,}/g, " ").trim();
}

// Spec prose often carries HTML line breaks and comments meant for other
// renderers (ReDoc, Swagger UI). Breaks become spaces; comments are dropped.
function cleanSpecText(text) {
  return String(text ?? "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<br\s*\/?>/gi, " ");
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
  const source = cleanSpecText(text);
  const levels = [...source.matchAll(/^(#{1,6})\s+/gm)].map((match) => match[1].length);
  if (levels.length === 0) {
    return source;
  }
  // The spec's highest heading becomes ###, and every other heading keeps its
  // distance from it, so the hierarchy never skips a level.
  const shift = 3 - Math.min(...levels);
  return source.replace(/^(#{1,6})(\s+)/gm, (match, hashes, space) => `${"#".repeat(Math.min(Math.max(hashes.length + shift, 3), 6))}${space}`);
}

function resolveSchema(spec, schema, depth = 0) {
  const resolved = resolveReference(spec, schema);
  if (!resolved || depth > 10 || !Array.isArray(resolved.allOf) || resolved.allOf.length === 0) {
    return resolved;
  }

  // Flatten allOf so properties and required fields from every part are kept.
  const merged = { ...resolved, properties: { ...(resolved.properties || {}) }, required: [...(resolved.required || [])] };
  delete merged.allOf;
  for (const part of resolved.allOf) {
    const candidate = resolveSchema(spec, part, depth + 1) || {};
    Object.assign(merged.properties, candidate.properties || {});
    merged.required.push(...(candidate.required || []));
    if (!merged.type && candidate.type) {
      merged.type = candidate.type;
    }
    if (!merged.description && candidate.description) {
      merged.description = candidate.description;
    }
  }
  merged.required = [...new Set(merged.required)];
  if (!merged.type && Object.keys(merged.properties).length > 0) {
    merged.type = "object";
  }
  return merged;
}

// Removes fields a schema does not define from an example, at every depth,
// and returns their paths. Objects with no listed properties, or that allow
// extra properties, are left alone.
// A numeric string where the schema says integer or number becomes that
// number, and its path is recorded in removed.converted.
function coerceNumber(spec, container, key, schema, path, removed) {
  const resolved = resolveSchema(spec, schema);
  const types = [].concat(resolved?.type || []);
  const raw = container[key];
  if (typeof raw !== "string" || types.includes("string")) {
    return;
  }
  const pattern = types.includes("number") ? /^-?\d+(?:\.\d+)?$/ : types.includes("integer") ? /^-?\d+$/ : null;
  if (pattern && pattern.test(raw) && Number.isSafeInteger(Math.trunc(Number(raw)))) {
    container[key] = Number(raw);
    removed.converted ||= [];
    if (!removed.converted.some((entry) => entry.path === path)) {
      removed.converted.push({ path, type: types.includes("number") ? "number" : "integer" });
    }
  }
}

function pruneToSchema(spec, value, schema, prefix = "", removed = [], depth = 0) {
  const resolved = resolveSchema(spec, schema);
  if (!resolved || depth > 8 || value === null || typeof value !== "object") {
    return removed;
  }
  const variants = !resolved.properties ? (resolved.oneOf || resolved.anyOf) : null;
  if (Array.isArray(variants) && variants.length > 0) {
    // Prune against the variant that already fits best.
    const shapes = variants.map((variant) => resolveSchema(spec, variant)).filter(Boolean);
    const fit = (shape) => Object.keys(value).filter((key) => key in (shape.properties || {})).length;
    const best = shapes.reduce((winner, shape) => (fit(shape) > fit(winner) ? shape : winner), shapes[0]);
    return best ? pruneToSchema(spec, value, best, prefix, removed, depth + 1) : removed;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => {
      coerceNumber(spec, value, index, resolved.items, `${prefix}[]`, removed);
      pruneToSchema(spec, item, resolved.items, `${prefix}[]`, removed, depth + 1);
    });
    return removed;
  }
  const properties = resolved.properties || {};
  if (Object.keys(properties).length === 0 || resolved.additionalProperties) {
    return removed;
  }
  for (const key of Object.keys(value)) {
    const childPath = prefix ? `${prefix}.${key}` : key;
    if (!(key in properties)) {
      delete value[key];
      if (!removed.includes(childPath)) {
        removed.push(childPath);
      }
    } else {
      coerceNumber(spec, value, key, properties[key], childPath, removed);
      pruneToSchema(spec, value[key], properties[key], childPath, removed, depth + 1);
    }
  }
  return removed;
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
function mediaExample(spec, media, mode = "any") {
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
  return schema ? buildExampleValue(spec, schema, mode) : undefined;
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
  const resolved = resolveSchema(spec, propertySchema);
  if (mode === "request" && resolved?.readOnly) {
    return false;
  }
  if (mode === "response" && resolved?.writeOnly) {
    return false;
  }
  return true;
}

function buildExampleValue(spec, schema, mode = "any", depth = 0) {
  const resolved = resolveSchema(spec, schema);
  if (!resolved || depth > 8) {
    return "value";
  }

  if (resolved.example !== undefined) {
    return resolved.example;
  }

  // OpenAPI 3.1 schemas list examples in an array.
  if (Array.isArray(resolved.examples) && resolved.examples.length > 0) {
    return resolved.examples[0];
  }

  if (resolved.default !== undefined) {
    return resolved.default;
  }

  if (resolved.const !== undefined) {
    return resolved.const;
  }

  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) {
    return resolved.enum[0];
  }

  if (Array.isArray(resolved.oneOf) && resolved.oneOf.length > 0) {
    return buildExampleValue(spec, resolved.oneOf[0], mode, depth + 1);
  }

  if (Array.isArray(resolved.anyOf) && resolved.anyOf.length > 0) {
    return buildExampleValue(spec, resolved.anyOf[0], mode, depth + 1);
  }

  if (Array.isArray(resolved.allOf) && resolved.allOf.length > 0) {
    const merged = resolved.allOf.reduce((accumulator, item) => {
      const candidate = resolveSchema(spec, item);
      if (candidate?.properties) {
        accumulator.properties = { ...(accumulator.properties || {}), ...candidate.properties };
      }
      return { ...accumulator, ...candidate };
    }, {});
    return buildExampleValue(spec, merged, mode, depth + 1);
  }

  // OpenAPI 3.1 type arrays such as ["integer", "null"]: show the real type.
  const types = [].concat(resolved.type || []);
  const type = types.find((candidate) => candidate !== "null") || (types.includes("null") ? "null" : undefined);
  if (type === "null") {
    return null;
  }

  if (type === "object" || (!type && resolved.properties)) {
    const payload = {};
    for (const [name, propertySchema] of Object.entries(resolved.properties || {})) {
      if (includeProperty(spec, propertySchema, mode)) {
        payload[name] = buildExampleValue(spec, propertySchema, mode, depth + 1);
      }
    }
    return payload;
  }

  if (type === "array") {
    return [buildExampleValue(spec, resolved.items, mode, depth + 1)];
  }

  // A value of the right shape for common formats, so the example passes
  // the format check instead of showing "value".
  const formatExamples = {
    date: "2026-01-01",
    "date-time": "2026-01-01T00:00:00Z",
    time: "12:00:00",
    email: "user@example.com",
    "idn-email": "user@example.com",
    uuid: "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    uri: "https://example.com",
    url: "https://example.com",
    "uri-reference": "https://example.com",
    hostname: "example.com",
    ipv4: "192.0.2.1",
    ipv6: "2001:db8::1",
    byte: "U3dhZ2dlciByb2Nrcw=="
  };
  if ((type === "string" || !type) && formatExamples[resolved.format]) {
    return formatExamples[resolved.format];
  }

  switch (type) {
    case "integer":
    case "number": {
      // Inside the schema's range.
      let number = 1;
      if (typeof resolved.minimum === "number") number = Math.max(number, resolved.minimum);
      if (typeof resolved.exclusiveMinimum === "number") number = Math.max(number, Math.floor(resolved.exclusiveMinimum) + 1);
      if (typeof resolved.maximum === "number") number = Math.min(number, resolved.maximum);
      return number;
    }
    case "boolean":
      return true;
    default: {
      const minLength = typeof resolved.minLength === "number" ? resolved.minLength : 0;
      return minLength > 5 ? "value".padEnd(minLength, "x") : "value";
    }
  }
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
        const scopeText = Array.isArray(scopes) && scopes.length > 0 ? ` with scopes: ${scopes.join(", ")}` : "";
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

function buildAuthenticationText(spec, operation) {
  const securityRequirements = Array.isArray(operation.security)
    ? operation.security
    : (Array.isArray(spec.security) ? spec.security : []);

  if (securityRequirements.length === 0) {
    return noSecurityText(spec, extractParameters(spec, operation, spec.paths?.[Object.keys(spec.paths || {}).find((route) => Object.values(spec.paths[route] || {}).includes(operation))]));
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

function buildOverviewAuthentication(spec) {
  const securityRequirements = Array.isArray(spec.security) && spec.security.length > 0
    ? spec.security
    : Object.keys(spec.components?.securitySchemes || {}).map((schemeName) => ({ [schemeName]: [] }));
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
    : `Use any one of these:\n\n${summaries.map((entry) => `- ${sentence(entry)}`).join("\n")}`;
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

  return { pathSection, querySection, headerSection, headerParams };
}

function refName(schema) {
  return typeof schema?.$ref === "string" ? schema.$ref.split("/").pop() : "";
}

// One row per request field, plus nested object fields (parent.child) and
// fields of arrays of objects (parent[].child), two levels deep. readOnly
// fields are left out because the server sets them.
function bodyFieldRows(spec, schema, requestBodyIsRequired, prefix = "", depth = 0, optionLabel = "") {
  const resolved = resolveSchema(spec, schema);
  const properties = resolved?.properties || {};
  const requiredFields = new Set(Array.isArray(resolved?.required) ? resolved.required : []);
  const hasRequiredList = requiredFields.size > 0;
  const rows = [];

  for (const [name, propertySchema] of Object.entries(properties)) {
    if (!includeProperty(spec, propertySchema, "request")) {
      continue;
    }
    const fullName = prefix ? `${prefix}.${name}` : name;
    const required = prefix
      ? (requiredFields.has(name) ? "yes" : "no")
      : formatRequiredValue(requiredFields.has(name), requestBodyIsRequired, hasRequiredList);
    rows.push(`| ${fullName} | ${typeCell(spec, propertySchema)} | ${required} | ${optionLabel}${buildSchemaDescription(spec, propertySchema)} |`);

    if (depth >= 2) {
      continue;
    }
    const child = resolveSchema(spec, propertySchema);
    const choices = child && !child.properties ? (child.oneOf || child.anyOf) : null;
    if (child?.properties) {
      rows.push(...bodyFieldRows(spec, child, false, fullName, depth + 1, optionLabel));
    } else if (Array.isArray(choices) && choices.length > 0) {
      // A field that takes one of several object shapes: list each shape's
      // fields, labelled with the option they belong to.
      choices.forEach((choice, index) => {
        const resolvedChoice = resolveSchema(spec, choice);
        const name = normalizeText(resolvedChoice?.title) || refName(choice);
        const label = `Option ${index + 1} of ${choices.length}${name ? ` (${name})` : ""}. `;
        rows.push(...bodyFieldRows(spec, resolvedChoice, false, fullName, depth + 1, label));
      });
    } else if (child?.type === "array") {
      const item = resolveSchema(spec, child.items);
      if (item?.properties) {
        rows.push(...bodyFieldRows(spec, item, false, `${fullName}[]`, depth + 1, optionLabel));
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
  const typeNote = media.type !== "application/json" ? ` Content type: \`${media.type}\`.` : "";

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
  let value = mediaExample(spec, media.media, "request");
  if (value === undefined) {
    return null;
  }

  // A spec's own example can leave out required fields. Add them from the
  // schema, using the shape the example is closest to, and say so in the doc.
  const addedFields = [];
  const schema = resolveSchema(spec, media.media.schema);
  if (value && typeof value === "object" && !Array.isArray(value) && schema) {
    const variants = !schema.properties ? (schema.oneOf || schema.anyOf) : null;
    const shapes = (Array.isArray(variants) && variants.length > 0 ? variants : [schema]).map((shape) => resolveSchema(spec, shape)).filter(Boolean);
    const missingFor = (shape) => (shape.required || []).filter((key) => !(key in value) && shape.properties?.[key]);
    const closest = shapes.reduce((best, shape) => (missingFor(shape).length < missingFor(best).length ? shape : best), shapes[0]);
    if (closest) {
      const missing = missingFor(closest);
      if (missing.length > 0) {
        value = { ...value };
        for (const key of missing) {
          value[key] = buildExampleValue(spec, closest.properties[key], "request");
          addedFields.push(key);
        }
      }
    }
  }
  let removedFields = [];
  if (value && typeof value === "object") {
    value = structuredClone(value);
    removedFields = pruneToSchema(spec, value, media.media.schema);
  }
  return { kind: media.kind, type: media.type, value, addedFields, removedFields, schema: media.media.schema, encoding: media.media.encoding };
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
      ...fields.map(([name, value]) => `--data-urlencode "${shellQuote(name)}=${shellQuote(fieldText(value))}"`)
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
  const original = mediaExample(spec, media.media, "response");
  if (original === undefined) {
    return JSON.stringify({ status: statusCode, note: "Needs SME input" }, null, 2);
  }
  if (media.kind !== "json" && typeof original === "string") {
    return { lang: "text", text: original };
  }
  const value = structuredClone(original);
  const removed = pruneToSchema(spec, value, media.media.schema);
  return { lang: "json", text: JSON.stringify(value, null, 2), removed };
}

function undefinedFieldsNote(fields) {
  const converted = fields?.converted || [];
  const convertedNote = converted.length === 0
    ? ""
    : `The spec's own example gives ${converted.slice(0, 8).map((entry) => `\u0000${entry.path}\u0000`).join(", ")}${converted.length > 8 ? ` and ${converted.length - 8} more` : ""} as ${converted.length === 1 ? "a string" : "strings"}, but ${converted.length === 1 ? "its schema says" : "their schemas say"} ${[...new Set(converted.map((entry) => entry.type))].join(" or ")}, so ${converted.length === 1 ? "it is" : "they are"} shown as ${converted.length === 1 ? "a number" : "numbers"} here.\n\n`;
  if (!fields?.length) {
    return convertedNote;
  }
  const shown = fields.slice(0, 8).map((field) => `\u0000${field}\u0000`).join(", ");
  const more = fields.length > 8 ? ` and ${fields.length - 8} more` : "";
  return `The spec's own example also shows ${fields.length === 1 ? "a field" : "fields"} its schema does not define (${shown}${more}). ${fields.length === 1 ? "It is" : "They are"} left out here.\n\n${convertedNote}`;
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
  if (parameter.example !== undefined) {
    return parameter.example;
  }
  const namedExample = parameter.examples ? resolveReference(spec, Object.values(parameter.examples)[0]) : undefined;
  if (namedExample?.value !== undefined) {
    return namedExample.value;
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
    .map(([code, response]) => `| ${code} | ${normalizeText(response.description, "Needs SME input").replace(/\|/g, "\\|").replace(/\n+/g, " ")} |`)
    .join("\n");
  const table = `| Code | Description |\n| --- | --- |\n${rows}`;

  const withBody = responseEntries.find(([, response]) => pickMedia(response.content));
  if (!withBody) {
    return table;
  }
  const media = pickMedia(withBody[1].content);
  const example = mediaExample(spec, media.media, "response");
  if (example === undefined || media.kind !== "json") {
    return table;
  }
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
function safeUrl(url) {
  return String(url).replace(/[\s"`$\\!]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0")}`);
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

function buildEndpointDocument(spec, serviceName, owner, apiVersion, route, method, operation, pathItem) {
  const summary = oneLine(normalizeText(operation.summary, humanizeOperationId(operation.operationId) || titleCaseFromSlug(toSlug(`${method}-${route}`))));
  const parameters = extractParameters(spec, operation, pathItem);
  const endpointSlug = toSlug(`${method}-${route}`);
  const isDeprecated = operation.deprecated === true;
  const deprecatedSince = normalizeText(operation["x-deprecated-since"]);
  const sunsetVersion = normalizeText(operation["x-sunset-version"]);
  const replacement = normalizeText(operation["x-replaced-by"]);
  const migrationGuide = normalizeText(operation["x-migration-guide"]);
  const securityImpact = pickAllowedValue(normalizeText(operation["x-security-impact"] || spec.info?.["x-security-impact"]), new Set(["low", "medium", "high"]), "medium");
  const frontmatter = stringifyYamlLines({
    title: `${summary.replace(/<[^>]*>/g, "").trim() || summary}`,
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

  const { pathSection, querySection, headerSection, headerParams } = buildSplitParameterSections(spec, parameters);
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
  const curlArgs = [
    `curl -X ${method.toUpperCase()} "${exampleUrl}"`, // safeUrl already removed shell characters
    ...credentialArgs,
    ...headerArgs,
    ...buildRequestBodyArgs(requestBodyExample, spec)
  ];
  const requestExample = curlArgs.join(" \\\n  ");
  const requestExampleNote = requestBodyExample?.addedFields?.length
    ? `The spec's own request example leaves out required ${requestBodyExample.addedFields.length === 1 ? "field" : "fields"} ${requestBodyExample.addedFields.map((field) => `\u0000${field}\u0000`).join(", ")}. ${requestBodyExample.addedFields.length === 1 ? "It is" : "They are"} added below from the schema.\n\n`
    : "";
  const requestPruneNote = undefinedFieldsNote(requestBodyExample?.removedFields);
  const authText = buildAuthenticationText(spec, operation);
  const responseExample = buildResponseExample(spec, operation);
  const successCode = Object.keys(operation.responses || {}).find((code) => code.startsWith("2"));
  const statusLine = successCode ? `Status: \u0000${successCode}\u0000\n\n` : "";
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

${headerSection ? `## Header Parameters\n\n${headerSection}\n\n` : ""}## Request Body

${requestBodySection}

## Request Example

${requestExampleNote}${requestPruneNote}${fenced("bash", requestExample)}

## Response Example

${responseExample === null ? "" : statusLine}${undefinedFieldsNote(responseExample?.removed)}${responseExampleSection}

## Error Codes

${buildErrorSection(spec, operation)}

## Performance Notes

${normalizeText(operation["x-performance-notes"], "Needs SME input")}${lifecycleSection}
`.replace(/\u0000/g, "`")
  };
}

async function ensureDirectory(directory) {
  await fs.mkdir(directory, { recursive: true });
}

async function parseSpec(inputPath) {
  const raw = await fs.readFile(inputPath, "utf8");
  try {
    if (inputPath.endsWith(".json")) {
      return JSON.parse(raw);
    }
    // CORE_SCHEMA keeps values like 2018-01-01 10:00:00 as written instead of
    // turning them into local-time Date objects.
    return yaml.load(raw, { schema: yaml.CORE_SCHEMA });
  } catch (error) {
    throw new Error(`Could not read ${inputPath}: ${String(error.message).split("\n")[0]}`);
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

  await ensureDirectory(endpointsDirectory);

  const apiOverview = buildApiOverview(spec, serviceName, owner);
  await fs.writeFile(path.join(outputDirectory, "api-overview.md"), escapeUntrustedHtml(apiOverview), "utf8");

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

      await fs.writeFile(path.join(endpointsDirectory, `${endpointSlug}.md`), escapeUntrustedHtml(content), "utf8");
    }
  }

  const shownOutput = path.relative(baseDirectory, outputDirectory);
  console.log(`Generated API documentation in ${(shownOutput.startsWith("..") || path.isAbsolute(shownOutput) ? outputDirectory : shownOutput || ".").replace(/\\/g, "/")}`);
}

main().catch((error) => {
  console.error(String(error?.message || "").startsWith("Could not read") ? error.message : error);
  process.exit(1);
});