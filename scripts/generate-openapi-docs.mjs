import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yaml from "js-yaml";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, "..");

function normalizeText(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  return value.trim();
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

function resolveReference(spec, value) {
  if (!value || typeof value !== "object" || !value.$ref || !value.$ref.startsWith("#/")) {
    return value;
  }

  const segments = value.$ref.slice(2).split("/");
  let current = spec;
  for (const segment of segments) {
    current = current?.[segment];
  }

  return current || value;
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
    value.forEach((item) => pruneToSchema(spec, item, resolved.items, `${prefix}[]`, removed, depth + 1));
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

function schemaTypeLabel(spec, schema) {
  const resolved = resolveSchema(spec, schema);
  if (!resolved) {
    return "string";
  }

  if (resolved.type === "array") {
    return `array<${schemaTypeLabel(spec, resolved.items)}>`;
  }

  const choices = resolved.oneOf || resolved.anyOf;
  if (!resolved.type && Array.isArray(choices) && choices.length > 0) {
    return `one of: ${[...new Set(choices.map((choice) => schemaTypeLabel(spec, choice)))].join(" \\| ")}`;
  }

  return resolved.type || (resolved.properties ? "object" : "string");
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

  if (resolved.default !== undefined) {
    return resolved.default;
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

  if (resolved.type === "object" || (!resolved.type && resolved.properties)) {
    const payload = {};
    for (const [name, propertySchema] of Object.entries(resolved.properties || {})) {
      if (includeProperty(spec, propertySchema, mode)) {
        payload[name] = buildExampleValue(spec, propertySchema, mode, depth + 1);
      }
    }
    return payload;
  }

  if (resolved.type === "array") {
    return [buildExampleValue(spec, resolved.items, mode, depth + 1)];
  }

  if (resolved.format === "date") {
    return "2026-01-01";
  }

  if (resolved.format === "date-time") {
    return "2026-01-01T00:00:00Z";
  }

  switch (resolved.type) {
    case "integer":
    case "number":
      return 1;
    case "boolean":
      return true;
    default:
      return "value";
  }
}

function buildConstraintNotes(spec, schema) {
  const resolved = resolveSchema(spec, schema);
  if (!resolved || typeof resolved !== "object") {
    return [];
  }

  const notes = [];
  if (Array.isArray(resolved.enum) && resolved.enum.length > 0) {
    notes.push(`Allowed values: ${resolved.enum.join(", ")}`);
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
  return notes;
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
  if (explicitDescription) {
    return joinSentenceParts([explicitDescription, ...notes]).replace(/\|/g, "\\|").replace(/\n+/g, " ");
  }

  if (resolved?.example !== undefined) {
    notes.unshift(`Example value: ${jsonExampleLiteral(resolved.example)}`);
  }

  return notes.length > 0
    ? joinSentenceParts(["Needs SME input for field semantics", ...notes])
    : "Needs SME input";
}

function summarizeSecuritySchemes(spec, securityRequirements) {
  const schemes = spec.components?.securitySchemes || {};
  const summaries = [];

  for (const requirement of securityRequirements) {
    for (const [schemeName, scopes] of Object.entries(requirement || {})) {
      const scheme = resolveReference(spec, schemes[schemeName]);
      if (!scheme) {
        continue;
      }

      const schemeDescription = normalizeText(scheme.description).replace(/\n+/g, " ");
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
  }

  return [...new Set(summaries)];
}

function buildAuthenticationText(spec, operation) {
  const securityRequirements = Array.isArray(operation.security)
    ? operation.security
    : (Array.isArray(spec.security) ? spec.security : []);

  if (securityRequirements.length === 0) {
    return "No authentication requirements are defined in the OpenAPI specification.";
  }

  const summaries = summarizeSecuritySchemes(spec, securityRequirements);
  if (summaries.length === 0) {
    return "Authentication is required. Validate the exact scheme against the source OpenAPI file.";
  }

  return `Authentication is required. Use ${summaries.join(" or ")}.`;
}

function buildOverviewAuthentication(spec) {
  const securityRequirements = Array.isArray(spec.security) && spec.security.length > 0
    ? spec.security
    : Object.keys(spec.components?.securitySchemes || {}).map((schemeName) => ({ [schemeName]: [] }));
  if (securityRequirements.length === 0) {
    return "No authentication requirements are defined in the OpenAPI specification.";
  }
  const summaries = summarizeSecuritySchemes(spec, securityRequirements);
  return summaries.length > 0 ? summaries.join(". ") : "Needs SME input";
}

// The credential arguments a curl example needs, based on the spec's security
// requirements. No requirements means no credentials are added.
function buildCredentialArgs(spec, operation) {
  const securityRequirements = Array.isArray(operation.security)
    ? operation.security
    : (Array.isArray(spec.security) ? spec.security : []);
  const firstRequirement = securityRequirements.find((requirement) => requirement && Object.keys(requirement).length > 0);
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
      args.push(`-H "${scheme.name}: <api-key>"`);
    } else if (scheme.type === "apiKey" && scheme.in === "cookie" && scheme.name) {
      args.push(`--cookie "${scheme.name}=<api-key>"`);
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
      const type = schemaTypeLabel(spec, parameter.schema);
      const required = parameter.required ? "yes" : "no";
      const description = joinSentenceParts([
        normalizeText(parameter.description, `Parameter in ${parameter.in}`),
        ...buildConstraintNotes(spec, parameter.schema)
      ]);
      return `| ${parameter.name} | ${type} | ${required} | ${description} |`;
    })
    .join("\n");
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
    rows.push(`| ${fullName} | ${schemaTypeLabel(spec, propertySchema)} | ${required} | ${optionLabel}${buildSchemaDescription(spec, propertySchema)} |`);

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
  return { kind: media.kind, type: media.type, value, addedFields, removedFields };
}

function shellQuote(value) {
  return String(value).replace(/(["\\$`])/g, "\\$1");
}

function buildRequestBodyArgs(body) {
  if (!body) {
    return [];
  }
  const fields = body.value && typeof body.value === "object" && !Array.isArray(body.value) ? Object.entries(body.value) : [];
  const fieldText = (value) => (typeof value === "object" ? JSON.stringify(value) : String(value));
  if (body.kind === "json") {
    return [`-H "Content-Type: ${body.type}"`, `-d '${JSON.stringify(body.value).replace(/'/g, "'\\''")}'`];
  }
  if (body.kind === "form") {
    return [
      `-H "Content-Type: ${body.type}"`,
      ...fields.map(([name, value]) => `--data-urlencode "${shellQuote(name)}=${shellQuote(fieldText(value))}"`)
    ];
  }
  if (body.kind === "multipart") {
    return fields.map(([name, value]) => `-F "${shellQuote(name)}=${shellQuote(fieldText(value))}"`);
  }
  return [`-H "Content-Type: ${body.type}"`, "--data-binary @<file>"];
}

function buildResponseExample(spec, operation) {
  const responseEntries = Object.entries(operation.responses || {});
  const successResponse = responseEntries.find(([code]) => code.startsWith("2"));

  if (!successResponse) {
    return '{\n  "status": "Needs SME input"\n}';
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
  if (!fields?.length) {
    return "";
  }
  const shown = fields.slice(0, 8).map((field) => `\u0000${field}\u0000`).join(", ");
  const more = fields.length > 8 ? ` and ${fields.length - 8} more` : "";
  return `The spec's own example also shows ${fields.length === 1 ? "a field" : "fields"} its schema does not define (${shown}${more}). ${fields.length === 1 ? "It is" : "They are"} left out here.\n\n`;
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
  return `${table}\n\nError response body (\u0000${withBody[0]}\u0000):\n\n\u0000\u0000\u0000json\n${JSON.stringify(example, null, 2)}\n\u0000\u0000\u0000`;
}

function buildExampleUrl(spec, route, operation, pathItem) {
  const baseUrl = serverUrl(spec, "https://api.example.com").replace(/\/$/, "");
  const parameters = extractParameters(spec, operation, pathItem);
  let examplePath = route;
  const queryParams = [];

  for (const parameter of parameters) {
    const exampleValue = buildParameterExampleValue(spec, operation, parameter);
    if (parameter.in === "path") {
      examplePath = examplePath.replace(`{${parameter.name}}`, encodeURIComponent(String(exampleValue)));
    }
    if (parameter.in === "query") {
      queryParams.push(`${encodeURIComponent(parameter.name)}=${encodeURIComponent(String(exampleValue))}`);
    }
  }

  return `${baseUrl}${examplePath}${queryParams.length > 0 ? `?${queryParams.join("&")}` : ""}`;
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
    last_reviewed: new Date().toISOString().slice(0, 10),
    security_impact: securityImpact
  });

  return `${frontmatter}# API Overview

## Purpose

${description}

## Intended Consumers

${formatOverviewValue(spec.info?.["x-intended-consumers"])}

## Authentication

${buildOverviewAuthentication(spec)}

## Base URL

\u0000${baseUrl}\u0000

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
  const summary = normalizeText(operation.summary, humanizeOperationId(operation.operationId) || titleCaseFromSlug(toSlug(`${method}-${route}`)));
  const parameters = extractParameters(spec, operation, pathItem);
  const endpointSlug = toSlug(`${method}-${route}`);
  const isDeprecated = operation.deprecated === true;
  const deprecatedSince = normalizeText(operation["x-deprecated-since"]);
  const sunsetVersion = normalizeText(operation["x-sunset-version"]);
  const replacement = normalizeText(operation["x-replaced-by"]);
  const migrationGuide = normalizeText(operation["x-migration-guide"]);
  const securityImpact = pickAllowedValue(normalizeText(operation["x-security-impact"] || spec.info?.["x-security-impact"]), new Set(["low", "medium", "high"]), "medium");
  const frontmatter = stringifyYamlLines({
    title: `${summary}`,
    description: `Generated endpoint documentation for ${method.toUpperCase()} ${route}`,
    service: serviceName,
    component: "endpoint",
    owner,
    api_version: apiVersion,
    status: isDeprecated ? "deprecated" : "draft",
    dependencies: [],
    last_reviewed: new Date().toISOString().slice(0, 10),
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
    .map((parameter) => {
      const example = buildParameterExampleValue(spec, operation, parameter);
      const value = example === "value" ? `<${parameter.name}>` : String(example);
      return `-H "${parameter.name}: ${value.replace(/(["\\$`])/g, "\\$1")}"`;
    });
  const requestBodyExample = buildRequestBodyExample(spec, operation);
  const requestBodySection = buildRequestBodySection(spec, operation);
  const exampleUrl = buildExampleUrl(spec, route, operation, pathItem);
  const curlArgs = [
    `curl -X ${method.toUpperCase()} "${exampleUrl}"`,
    ...credentialArgs,
    ...headerArgs,
    ...buildRequestBodyArgs(requestBodyExample)
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
      ? `\u0000\u0000\u0000${responseExample.lang}\n${responseExample.text}\n\u0000\u0000\u0000`
      : `\u0000\u0000\u0000json\n${responseExample}\n\u0000\u0000\u0000`;
  const purpose = normalizeText(operation.description, summary);
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

${requestExampleNote}${requestPruneNote}\u0000\u0000\u0000bash
${requestExample}
\u0000\u0000\u0000

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
  if (inputPath.endsWith(".json")) {
    return JSON.parse(raw);
  }

  // CORE_SCHEMA keeps values like 2018-01-01 10:00:00 as written instead of
  // turning them into local-time Date objects.
  return yaml.load(raw, { schema: yaml.CORE_SCHEMA });
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
  await fs.writeFile(path.join(outputDirectory, "api-overview.md"), apiOverview, "utf8");

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

      await fs.writeFile(path.join(endpointsDirectory, `${endpointSlug}.md`), content, "utf8");
    }
  }

  const shownOutput = path.relative(baseDirectory, outputDirectory);
  console.log(`Generated API documentation in ${(shownOutput.startsWith("..") || path.isAbsolute(shownOutput) ? outputDirectory : shownOutput || ".").replace(/\\/g, "/")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});