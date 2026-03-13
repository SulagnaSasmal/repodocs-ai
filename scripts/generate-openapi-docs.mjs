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

function resolveSchema(spec, schema) {
  return resolveReference(spec, schema);
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

  return resolved.type || "string";
}

function buildExampleValue(spec, schema) {
  const resolved = resolveSchema(spec, schema);
  if (!resolved) {
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
    return buildExampleValue(spec, resolved.oneOf[0]);
  }

  if (Array.isArray(resolved.anyOf) && resolved.anyOf.length > 0) {
    return buildExampleValue(spec, resolved.anyOf[0]);
  }

  if (Array.isArray(resolved.allOf) && resolved.allOf.length > 0) {
    const merged = resolved.allOf.reduce((accumulator, item) => {
      const candidate = resolveSchema(spec, item);
      if (candidate?.properties) {
        accumulator.properties = { ...(accumulator.properties || {}), ...candidate.properties };
      }
      return { ...accumulator, ...candidate };
    }, {});
    return buildExampleValue(spec, merged);
  }

  if (resolved.type === "object") {
    const payload = {};
    for (const [name, propertySchema] of Object.entries(resolved.properties || {})) {
      payload[name] = buildExampleValue(spec, propertySchema);
    }
    return payload;
  }

  if (resolved.type === "array") {
    return [buildExampleValue(spec, resolved.items)];
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
  if (explicitDescription) {
    return explicitDescription;
  }

  const notes = buildConstraintNotes(spec, resolved);
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

      if (scheme.type === "http" && scheme.scheme === "bearer") {
        const bearerFormat = normalizeText(scheme.bearerFormat);
        summaries.push(bearerFormat ? `HTTP Bearer token (${bearerFormat})` : "HTTP Bearer token");
        continue;
      }

      if (scheme.type === "apiKey") {
        summaries.push(`API key in ${scheme.in || "header"} \`${scheme.name || schemeName}\``);
        continue;
      }

      if (scheme.type === "oauth2") {
        const scopeText = Array.isArray(scopes) && scopes.length > 0 ? ` with scopes: ${scopes.join(", ")}` : "";
        summaries.push(`OAuth 2.0${scopeText}`);
        continue;
      }

      summaries.push(`${scheme.type || "security"} \`${schemeName}\``);
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
  const summaries = summarizeSecuritySchemes(spec, securityRequirements);
  return summaries.length > 0 ? summaries.join(". ") : "Needs SME input";
}

function extractParameters(operation, pathItem) {
  const combined = [...(pathItem.parameters || []), ...(operation.parameters || [])];
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

  return { pathSection, querySection };
}

function buildRequestBodyIntro(operation) {
  const schema = operation.requestBody?.content?.["application/json"]?.schema;
  if (!schema) {
    return "";
  }

  const resolvedSchema = schema;
  const hasRequiredList = Array.isArray(resolvedSchema?.required) && resolvedSchema.required.length > 0;

  return operation.requestBody?.required
    ? (hasRequiredList
      ? "Request body is required. Fields not listed as required in the schema are optional."
      : "Request body is required. The schema does not declare which individual fields are required.")
    : "Request body is optional.";
}

function buildRequestBodyRows(spec, operation) {
  const schema = resolveSchema(spec, operation.requestBody?.content?.["application/json"]?.schema);
  const properties = schema?.properties;
  const requiredFields = new Set(Array.isArray(schema?.required) ? schema.required : []);
  const hasRequiredList = requiredFields.size > 0;
  const requestBodyIsRequired = operation.requestBody?.required === true;

  if (!properties || Object.keys(properties).length === 0) {
    return "| None | n/a | no | No request body |";
  }

  return Object.entries(properties)
    .map(([name, propertySchema]) => {
      const type = schemaTypeLabel(spec, propertySchema);
      const required = formatRequiredValue(requiredFields.has(name), requestBodyIsRequired, hasRequiredList);
      const description = buildSchemaDescription(spec, propertySchema);
      return `| ${name} | ${type} | ${required} | ${description} |`;
    })
    .join("\n");
}

function buildRequestBodyExample(spec, operation) {
  const schema = resolveSchema(spec, operation.requestBody?.content?.["application/json"]?.schema);
  return schema ? JSON.stringify(buildExampleValue(spec, schema), null, 2) : null;
}

function buildResponseExample(spec, operation) {
  const responseEntries = Object.entries(operation.responses || {});
  const successResponse = responseEntries.find(([code]) => code.startsWith("2"));

  if (!successResponse) {
    return '{\n  "status": "Needs SME input"\n}';
  }

  const [statusCode, response] = successResponse;
  const schema = resolveSchema(spec, response.content?.["application/json"]?.schema);
  if (!schema) {
    return JSON.stringify({ status: statusCode, note: "Needs SME input" }, null, 2);
  }

  return JSON.stringify(buildExampleValue(spec, schema), null, 2);
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

  for (const propertySchema of Object.values(resolved.properties || {})) {
    const nestedMatch = findNamedPropertyExample(spec, propertySchema, propertyName);
    if (nestedMatch !== undefined) {
      return nestedMatch;
    }
  }

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

  const requestSchema = operation.requestBody?.content?.["application/json"]?.schema;
  const requestMatch = findNamedPropertyExample(spec, requestSchema, parameter.name);
  if (requestMatch !== undefined) {
    return requestMatch;
  }

  for (const response of Object.values(operation.responses || {})) {
    const responseSchema = response?.content?.["application/json"]?.schema;
    const responseMatch = findNamedPropertyExample(spec, responseSchema, parameter.name);
    if (responseMatch !== undefined) {
      return responseMatch;
    }
  }

  return schemaExample;
}

function buildErrorRows(operation) {
  const responseEntries = Object.entries(operation.responses || {}).filter(([code]) => !code.startsWith("2"));

  if (responseEntries.length === 0) {
    return "| 500 | Needs SME input |";
  }

  return responseEntries
    .map(([code, response]) => `| ${code} | ${normalizeText(response.description, "Needs SME input")} |`)
    .join("\n");
}

function buildExampleUrl(spec, route, operation, pathItem) {
  const baseUrl = normalizeText(spec.servers?.[0]?.url, "https://api.example.com").replace(/\/$/, "");
  const parameters = extractParameters(operation, pathItem);
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
  const baseUrl = normalizeText(spec.servers?.[0]?.url, "Needs SME input");
  const securityImpact = pickAllowedValue(normalizeText(spec.info?.["x-security-impact"]), new Set(["low", "medium", "high"]), "medium");

  const frontmatter = stringifyYamlLines({
    title: `${serviceName} API Overview`,
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

 ${baseUrl} 

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
  const summary = normalizeText(operation.summary, titleCaseFromSlug(toSlug(`${method}-${route}`)));
  const parameters = extractParameters(operation, pathItem);
  const endpointSlug = toSlug(`${method}-${route}`);
  const isDeprecated = operation.deprecated === true;
  const deprecatedSince = normalizeText(operation["x-deprecated-since"], apiVersion);
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
          deprecated_since: deprecatedSince,
          sunset_version: sunsetVersion || "Needs SME input",
          replaced_by: replacement || "Needs SME input",
          migration_guide: migrationGuide || "Needs SME input"
        }
      : {})
  });

  const { pathSection, querySection } = buildSplitParameterSections(spec, parameters);
  const requestBodyIntro = buildRequestBodyIntro(operation);
  const requestBodyExample = buildRequestBodyExample(spec, operation);
  const requestBodyRows = buildRequestBodyRows(spec, operation);
  const requestBodySection = requestBodyRows === "| None | n/a | no | No request body |"
    ? "Not applicable."
    : `${requestBodyIntro ? `${requestBodyIntro}\n\n` : ""}| Field | Type | Required | Description |\n| --- | --- | --- | --- |\n${requestBodyRows}`;
  const exampleUrl = buildExampleUrl(spec, route, operation, pathItem);
  const requestExample = requestBodyExample
    ? `curl -X ${method.toUpperCase()} "${exampleUrl}" \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '${JSON.stringify(JSON.parse(requestBodyExample))}'`
    : `curl -X ${method.toUpperCase()} "${exampleUrl}" \\
  -H "Authorization: Bearer <token>"`;
  const authText = buildAuthenticationText(spec, operation);
  const purpose = normalizeText(operation.description, summary);
  const lifecycleSection = isDeprecated
    ? `

## Deprecation

This endpoint is deprecated as of ${deprecatedSince}.${sunsetVersion ? ` It is scheduled to sunset in ${sunsetVersion}.` : ""}

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

## Request Body

${requestBodySection}

## Request Example

   bash
${requestExample}
   

## Response Example

   json
${buildResponseExample(spec, operation)}
   

## Error Codes

| Code | Description |
| --- | --- |
${buildErrorRows(operation)}

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

  return yaml.load(raw);
}

async function main() {
  const inputArg = process.argv[2];
  if (!inputArg) {
    console.error("Usage: node scripts/generate-openapi-docs.mjs <path-to-openapi-file> [output-directory]");
    process.exit(1);
  }

  const outputArg = process.argv[3];
  const inputPath = path.resolve(repoRoot, inputArg);
  const spec = await parseSpec(inputPath);
  const serviceName = toSlug(normalizeText(spec.info?.title, "generated-api"));
  const owner = process.env.REPODOCS_OWNER || "docs-platform";
  const apiVersion = normalizeText(spec.info?.version, "v1");
  const outputDirectory = outputArg
    ? path.resolve(repoRoot, outputArg)
    : path.join(repoRoot, "generated", serviceName);
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

  console.log(`Generated API documentation in ${path.relative(repoRoot, outputDirectory).replace(/\\/g, "/")}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});