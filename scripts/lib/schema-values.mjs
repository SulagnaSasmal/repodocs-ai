// Shared rules for example values against an OpenAPI schema.
//
// The generator uses them to build examples and to correct a spec's own
// examples where they break its schema; the OpenAPI check uses the same rules
// to report problems. Keeping one copy means a generated doc never fails the
// check for a rule the generator did not know about.

// How deep examples are built and checked. Both use the same limit, so a
// value the generator stops building at is never checked as if complete
// (recursive schemas would otherwise always fail).
export const MAX_EXAMPLE_DEPTH = 10;

// Follows $ref (with OpenAPI 3.1 sibling keywords applied on top) and merges
// allOf, so properties and required fields from every part are kept.
export function resolveSchema(spec, schema, depth = 0) {
  let resolved = schema;
  while (resolved && typeof resolved === "object" && typeof resolved.$ref === "string" && resolved.$ref.startsWith("#/") && depth < 20) {
    const { $ref, ...siblings } = resolved;
    const target = $ref.slice(2).split("/").map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~")).reduce((current, segment) => current?.[segment], spec);
    resolved = target && Object.keys(siblings).length > 0 ? { ...target, ...siblings } : target;
    depth += 1;
  }
  if (!resolved || typeof resolved !== "object" || !Array.isArray(resolved.allOf) || resolved.allOf.length === 0 || depth > 20) {
    return resolved && typeof resolved === "object" ? resolved : null;
  }
  const merged = { ...resolved, properties: { ...(resolved.properties || {}) }, required: [...(resolved.required || [])] };
  delete merged.allOf;
  for (const part of resolved.allOf) {
    const candidate = resolveSchema(spec, part, depth + 1) || {};
    Object.assign(merged.properties, candidate.properties || {});
    merged.required.push(...(candidate.required || []));
    for (const key of ["type", "description", "format", "enum", "pattern", "minLength", "maxLength", "minimum", "maximum", "items", "nullable", "readOnly", "writeOnly", "additionalProperties", "oneOf", "anyOf"]) {
      if (merged[key] === undefined && candidate[key] !== undefined) {
        merged[key] = candidate[key];
      }
    }
  }
  merged.required = [...new Set(merged.required)];
  if (!merged.type && Object.keys(merged.properties).length > 0) {
    merged.type = "object";
  }
  return merged;
}

// The shapes a schema allows: each oneOf/anyOf option, flattened, or itself.
export function expandShapes(spec, schema, depth = 0) {
  const resolved = resolveSchema(spec, schema);
  if (!resolved || depth > 6) {
    return [];
  }
  const variants = !resolved.properties ? (resolved.oneOf || resolved.anyOf) : null;
  if (Array.isArray(variants) && variants.length > 0) {
    return variants.flatMap((variant) => expandShapes(spec, variant, depth + 1));
  }
  return [resolved];
}

// The JSON type of a value, in schema terms.
export function jsonType(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

export function shapeTypes(shape) {
  const types = [].concat(shape?.type || []);
  if (types.length === 0 && shape?.properties && Object.keys(shape.properties).length > 0) {
    return ["object"];
  }
  return types;
}

// null fits a shape only when the shape says so (nullable, a "null" type, a
// null in its enum) or when the shape says nothing about the value at all.
export function allowsNull(shape) {
  if (!shape) return true;
  if (shape.nullable === true || [].concat(shape.type || []).includes("null")) return true;
  if (Array.isArray(shape.enum)) return shape.enum.includes(null);
  if (shape.const !== undefined) return shape.const === null;
  return shapeTypes(shape).length === 0;
}

function typeFits(actual, types) {
  return types.length === 0 || types.includes(actual) || (actual === "integer" && types.includes("number"));
}

const daysInMonth = (year, month) => [31, (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];

function validDate(year, month, day) {
  return month >= 1 && month <= 12 && day >= 1 && day <= daysInMonth(year, month);
}

function validTime(hour, minute, second) {
  // 60 allows a leap second.
  return hour <= 23 && minute <= 59 && second <= 60;
}

// Format checks. date and date-time follow RFC 3339, as OpenAPI requires:
// real calendar days, a time with seconds, and a time-zone offset.
export function formatValid(value, format) {
  switch (format) {
    case "date": {
      const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      return Boolean(match) && validDate(Number(match[1]), Number(match[2]), Number(match[3]));
    }
    case "date-time": {
      const match = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-](\d{2}):(\d{2}))$/.exec(value);
      return Boolean(match) && validDate(Number(match[1]), Number(match[2]), Number(match[3]))
        && validTime(Number(match[4]), Number(match[5]), Number(match[6]))
        && (!match[9] || (Number(match[9]) <= 23 && Number(match[10]) <= 59));
    }
    case "time": {
      const match = /^(\d{2}):(\d{2}):(\d{2})(\.\d+)?([Zz]|[+-]\d{2}:\d{2})?$/.exec(value);
      return Boolean(match) && validTime(Number(match[1]), Number(match[2]), Number(match[3]));
    }
    case "email":
    case "idn-email":
      return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
    case "uuid":
      return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
    case "uri":
    case "url":
      return /^[A-Za-z][A-Za-z0-9+.-]*:\S*$/.test(value);
    case "ipv4":
      return /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/.test(value);
    default:
      return true;
  }
}

const patternCache = new Map();

// A spec pattern as a JavaScript RegExp, or null when it does not compile.
export function compilePattern(pattern) {
  if (typeof pattern !== "string" || pattern.length > 2000) {
    return null;
  }
  if (!patternCache.has(pattern)) {
    let compiled = null;
    for (const flags of ["u", ""]) {
      try {
        compiled = new RegExp(pattern, flags);
        break;
      } catch {
        // try without the unicode flag
      }
    }
    patternCache.set(pattern, compiled);
  }
  return patternCache.get(pattern);
}

// A value outside the schema's range, length, format or pattern, as a phrase.
export function constraintProblem(value, shape) {
  if (typeof value === "number") {
    if (typeof shape.minimum === "number" && (shape.exclusiveMinimum === true ? value <= shape.minimum : value < shape.minimum)) {
      return `is ${value}, below the spec's minimum of ${shape.minimum}`;
    }
    if (typeof shape.maximum === "number" && (shape.exclusiveMaximum === true ? value >= shape.maximum : value > shape.maximum)) {
      return `is ${value}, above the spec's maximum of ${shape.maximum}`;
    }
    if (typeof shape.exclusiveMinimum === "number" && value <= shape.exclusiveMinimum) {
      return `is ${value}, not above the spec's exclusive minimum of ${shape.exclusiveMinimum}`;
    }
    if (typeof shape.exclusiveMaximum === "number" && value >= shape.exclusiveMaximum) {
      return `is ${value}, not below the spec's exclusive maximum of ${shape.exclusiveMaximum}`;
    }
    if (typeof shape.multipleOf === "number" && shape.multipleOf > 0 && Math.abs(value / shape.multipleOf - Math.round(value / shape.multipleOf)) > 1e-9) {
      return `is ${value}, not a multiple of ${shape.multipleOf}`;
    }
  }
  if (typeof value === "string") {
    const length = [...value].length;
    if (typeof shape.minLength === "number" && length < shape.minLength) {
      return `is ${length} characters, shorter than the spec's minimum length of ${shape.minLength}`;
    }
    if (typeof shape.maxLength === "number" && length > shape.maxLength) {
      return `is ${length} characters, longer than the spec's maximum length of ${shape.maxLength}`;
    }
    if (shape.format && value !== "" && !formatValid(value, shape.format)) {
      return `is '${value}', which is not a valid ${shape.format}`;
    }
    const pattern = compilePattern(shape.pattern);
    if (pattern && !pattern.test(value)) {
      return `is '${value}', which does not match the spec's pattern ${shape.pattern}`;
    }
  }
  if (Array.isArray(value)) {
    if (typeof shape.minItems === "number" && value.length < shape.minItems) {
      return `has ${value.length} items, fewer than the spec's minimum of ${shape.minItems}`;
    }
    if (typeof shape.maxItems === "number" && value.length > shape.maxItems) {
      return `has ${value.length} items, more than the spec's maximum of ${shape.maxItems}`;
    }
  }
  return null;
}

// Problems with a JSON example against a schema, at every depth, as
// messages. kind is "request", "response" or "error response": requests may
// not send readOnly fields and responses may not show writeOnly ones. For
// oneOf/anyOf the example must fit one option on its own.
export function valueProblems(spec, value, schemas, kind, label = "", depth = 0) {
  if (depth >= MAX_EXAMPLE_DEPTH || value === undefined) {
    return [];
  }
  const shapes = [].concat(schemas).flatMap((schema) => expandShapes(spec, schema));
  if (shapes.length === 0) {
    return [];
  }
  let best = null;
  for (const shape of shapes) {
    const errors = shapeProblems(spec, value, shape, kind, label, depth);
    if (errors.length === 0) {
      return [];
    }
    if (!best || errors.length < best.length) {
      best = errors;
    }
  }
  return [...new Set(best)];
}

function where(kind, label) {
  return label ? `${kind} example field '${label}'` : `the ${kind} example`;
}

function shapeProblems(spec, value, shape, kind, label, depth) {
  if (value === null) {
    return allowsNull(shape) ? [] : [`${where(kind, label)} is null, but the spec does not allow null${shapeTypes(shape).length ? ` (it says ${shapeTypes(shape).join(" or ")})` : ""}`];
  }
  const allowedTypes = shapeTypes(shape).filter((type) => type !== "null");
  const actual = jsonType(value);
  if (allowedTypes.length > 0 && !typeFits(actual, allowedTypes)) {
    return [`${where(kind, label)} is ${/^[aeiou]/.test(actual) ? "an" : "a"} ${actual}, but the spec says ${allowedTypes.join(" or ")}`];
  }
  const constraint = constraintProblem(value, shape);
  if (constraint) {
    return [`${where(kind, label)} ${constraint}`];
  }
  if (Array.isArray(shape.enum) && typeof value !== "object") {
    return shape.enum.map(String).includes(String(value))
      ? []
      : [`${kind} example field '${label}' uses '${value}', which is not one of its allowed values (${shape.enum.join(", ")})`];
  }
  if (shape.const !== undefined && typeof value !== "object" && value !== shape.const) {
    return [`${where(kind, label)} is '${value}', but the spec allows only '${shape.const}'`];
  }
  if (Array.isArray(value)) {
    if (!shape.items) {
      return [];
    }
    // Every item, so a bad value cannot hide past the first few.
    return value.slice(0, 50).flatMap((item) => valueProblems(spec, item, [shape.items], kind, `${label}[]`, depth + 1));
  }
  if (typeof value === "object") {
    const properties = shape.properties || {};
    const extraSchema = shape.additionalProperties && typeof shape.additionalProperties === "object" ? shape.additionalProperties : null;
    const open = Boolean(shape.additionalProperties) || Object.keys(properties).length === 0;
    if (Object.keys(properties).length === 0 && !extraSchema) {
      return [];
    }
    const errors = [];
    if (kind === "request" && label) {
      // Required fields of nested objects; the top level is checked by the caller.
      for (const key of shape.required || []) {
        if (!(key in value) && properties[key] && !resolveSchema(spec, properties[key])?.readOnly) {
          errors.push(`request example field '${label}.${key}' is missing, and the spec requires it`);
        }
      }
    }
    for (const [key, child] of Object.entries(value)) {
      const childLabel = label ? `${label}.${key}` : key;
      if (!(key in properties)) {
        if (extraSchema) {
          errors.push(...valueProblems(spec, child, [extraSchema], kind, childLabel, depth + 1));
        } else if (!open) {
          errors.push(`${kind} example field '${childLabel}' is not defined`);
        }
        continue;
      }
      const propertySchema = resolveSchema(spec, properties[key]);
      if (kind === "request" && propertySchema?.readOnly) {
        errors.push(`request example sends '${childLabel}', which is readOnly`);
        continue;
      }
      if (kind === "response" && propertySchema?.writeOnly) {
        errors.push(`response example shows '${childLabel}', which is writeOnly`);
        continue;
      }
      errors.push(...valueProblems(spec, child, [properties[key]], kind, childLabel, depth + 1));
    }
    return errors;
  }
  return [];
}

// A string that matches a regular expression, built from the pattern itself.
// Supports the parts specs use: literals, escapes, classes, groups,
// alternation (the first branch) and quantifiers. Returns null when the
// result does not match, so the caller can fall back.
export function samplePattern(pattern) {
  const regex = compilePattern(pattern);
  if (!regex) {
    return null;
  }
  let index = 0;
  const source = pattern;
  const escapeSample = (character) => ({ d: "1", w: "a", s: " ", D: "a", W: "-", S: "a", b: "", B: "" }[character] ?? character);
  function parseClass() {
    // index is just past "["
    const negated = source[index] === "^";
    if (negated) index += 1;
    const members = [];
    let first = true;
    while (index < source.length && (source[index] !== "]" || first)) {
      first = false;
      let character = source[index];
      if (character === "\\") {
        index += 1;
        const escaped = source[index];
        members.push({ escaped });
        index += 1;
        continue;
      }
      if (source[index + 1] === "-" && source[index + 2] && source[index + 2] !== "]") {
        members.push({ from: character, to: source[index + 2] });
        index += 3;
        continue;
      }
      members.push({ char: character });
      index += 1;
    }
    index += 1; // "]"
    const matches = (candidate) => members.some((member) => {
      if (member.char !== undefined) return member.char === candidate;
      if (member.from !== undefined) return candidate >= member.from && candidate <= member.to;
      const map = { d: /\d/, w: /\w/, s: /\s/, D: /\D/, W: /\W/, S: /\S/ };
      return map[member.escaped] ? map[member.escaped].test(candidate) : member.escaped === candidate;
    });
    if (negated) {
      return [..."a1A-_ x"].find((candidate) => !matches(candidate)) ?? "a";
    }
    const firstMember = members[0];
    if (!firstMember) return "";
    if (firstMember.char !== undefined) return firstMember.char;
    if (firstMember.from !== undefined) return firstMember.from;
    return escapeSample(firstMember.escaped);
  }
  function parseSequence() {
    let out = "";
    while (index < source.length && source[index] !== "|" && source[index] !== ")") {
      let atom = "";
      const character = source[index];
      if (character === "(") {
        index += 1;
        if (source[index] === "?") {
          // (?:...), (?=...), (?!...), (?<name>...)
          index += 1;
          if (source[index] === "<" && source[index + 1] !== "=" && source[index + 1] !== "!") {
            while (index < source.length && source[index] !== ">") index += 1;
            index += 1;
          } else {
            const lookaround = source[index] === "=" || source[index] === "!" || source[index] === "<";
            index += source[index] === "<" ? 2 : 1;
            if (lookaround) {
              parseAlternation();
              index += 1;
              continue;
            }
          }
        }
        atom = parseAlternation();
        index += 1; // ")"
      } else if (character === "[") {
        index += 1;
        atom = parseClass();
      } else if (character === "\\") {
        index += 1;
        atom = escapeSample(source[index]);
        index += 1;
      } else if (character === "^" || character === "$") {
        index += 1;
        continue;
      } else if (character === ".") {
        atom = "a";
        index += 1;
      } else {
        atom = character;
        index += 1;
      }
      let times = 1;
      const quantifier = source[index];
      if (quantifier === "?" || quantifier === "*" || quantifier === "+") {
        index += 1;
      } else if (quantifier === "{") {
        const match = /^\{(\d+)(?:,(\d*))?\}/.exec(source.slice(index));
        if (match) {
          times = Math.max(1, Number(match[1]));
          index += match[0].length;
        }
      }
      if (source[index] === "?") index += 1; // lazy
      out += atom.repeat(Math.min(times, 256));
    }
    return out;
  }
  function parseAlternation() {
    const first = parseSequence();
    let depthCount = 0;
    // Skip the other branches.
    while (index < source.length) {
      const character = source[index];
      if (character === "\\") { index += 2; continue; }
      if (character === "[") {
        index += 1;
        while (index < source.length && source[index] !== "]") index += source[index] === "\\" ? 2 : 1;
        index += 1;
        continue;
      }
      if (character === "(") depthCount += 1;
      if (character === ")") {
        if (depthCount === 0) break;
        depthCount -= 1;
      }
      index += 1;
    }
    return first;
  }
  try {
    const sample = parseAlternation();
    return regex.test(sample) ? sample : null;
  } catch {
    return null;
  }
}

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

// mode "request" leaves out readOnly properties (the server sets them);
// mode "response" leaves out writeOnly properties (the server never returns them).
export function includeProperty(spec, propertySchema, mode) {
  const resolved = resolveSchema(spec, propertySchema);
  if (mode === "request" && resolved?.readOnly) return false;
  if (mode === "response" && resolved?.writeOnly) return false;
  return true;
}

const modeKind = (mode) => (mode === "request" ? "request" : mode === "response" ? "response" : "value");

function stringFor(shape) {
  const minLength = typeof shape.minLength === "number" ? shape.minLength : 0;
  const maxLength = typeof shape.maxLength === "number" ? shape.maxLength : Infinity;
  if (shape.format && formatExamples[shape.format]) {
    const candidate = formatExamples[shape.format];
    if (candidate.length >= minLength && candidate.length <= maxLength) {
      return candidate;
    }
  }
  if (shape.pattern) {
    const sample = samplePattern(shape.pattern);
    if (sample !== null && sample.length >= minLength && sample.length <= maxLength) {
      return sample;
    }
  }
  let text = "value";
  if (text.length < minLength) text = text.padEnd(minLength, "x");
  if (text.length > maxLength) text = text.slice(0, Math.max(maxLength, 0));
  return text;
}

function numberFor(shape, integer) {
  let low = -Infinity;
  let high = Infinity;
  if (typeof shape.minimum === "number") low = shape.exclusiveMinimum === true ? shape.minimum + (integer ? 1 : 0.5) : shape.minimum;
  if (typeof shape.exclusiveMinimum === "number") low = Math.max(low, shape.exclusiveMinimum + (integer ? 1 : 0.5));
  if (typeof shape.maximum === "number") high = shape.exclusiveMaximum === true ? shape.maximum - (integer ? 1 : 0.5) : shape.maximum;
  if (typeof shape.exclusiveMaximum === "number") high = Math.min(high, shape.exclusiveMaximum - (integer ? 1 : 0.5));
  let number = Math.min(Math.max(1, low), high);
  if (integer) number = Math.ceil(number);
  if (typeof shape.multipleOf === "number" && shape.multipleOf > 0) {
    number = Math.ceil(number / shape.multipleOf) * shape.multipleOf;
  }
  return Number.isFinite(number) ? number : 1;
}

// An example value for a schema that passes valueProblems. The spec's own
// example, examples, default, const and enum are used when they fit; a value
// that breaks the schema (such as "paymentCurrency" for a three-letter code)
// is passed over for one built from the type and its constraints.
//
// When changes is an array, every spec value that had to be converted or
// replaced is recorded there with its path, so the doc can say so.
export function exampleFor(spec, schema, mode = "any", depth = 0, path = "", changes = null) {
  const resolved = resolveSchema(spec, schema);
  if (!resolved) {
    return "value";
  }
  if (depth >= MAX_EXAMPLE_DEPTH) {
    // Deep enough: the smallest value of the right kind (a recursive schema has no end).
    const type = shapeTypes(expandShapes(spec, resolved)[0] || resolved).find((candidate) => candidate !== "null");
    return { object: {}, array: [], integer: 1, number: 1, boolean: true }[type] ?? (allowsNull(resolved) && !type ? null : "value");
  }
  const kind = modeKind(mode);
  const label = path || "(the whole example)";
  const types = shapeTypes(resolved).filter((type) => type !== "null");
  const provided = [resolved.example, Array.isArray(resolved.examples) ? resolved.examples[0] : undefined];
  const candidates = [...provided, resolved.default, resolved.const, Array.isArray(resolved.enum) ? resolved.enum[0] : undefined];
  for (const [index, candidate] of candidates.entries()) {
    if (candidate === undefined) continue;
    const fromSpecExample = index < provided.length;
    if (candidate !== null && typeof candidate === "object") {
      // An object or array example is kept and corrected where it breaks the
      // schema, provided it is the right kind of value at all.
      if (typeFits(jsonType(candidate), types)) {
        return conformValue(spec, structuredClone(candidate), resolved, mode, depth + 1, path, changes || []).value;
      }
      if (fromSpecExample) changes?.push({ path: label, action: "replaced", reason: `was ${/^[aeiou]/.test(jsonType(candidate)) ? "an" : "a"} ${jsonType(candidate)}; the schema says ${types.join(" or ")}` });
      continue;
    }
    const problems = valueProblems(spec, candidate, [resolved], kind);
    if (problems.length === 0) {
      return candidate;
    }
    if (fromSpecExample) {
      const converted = types.length > 0 && !typeFits(jsonType(candidate), types) ? convert(candidate, types) : undefined;
      if (converted !== undefined && valueProblems(spec, converted, [resolved], kind).length === 0) {
        changes?.push({ path: label, action: "converted", reason: `was ${/^[aeiou]/.test(jsonType(candidate)) ? "an" : "a"} ${jsonType(candidate)}; the schema says ${types.join(" or ")}` });
        return converted;
      }
      changes?.push({ path: label, action: "replaced", reason: problems[0].replace(/^(?:the \S+ example|\S+ example field '[^']*')\s*/, "") });
    }
  }

  // The first option of a oneOf/anyOf, at the same depth: choosing an
  // option is not a level of nesting.
  const variants = resolved.oneOf || resolved.anyOf;
  if (!resolved.properties && Array.isArray(variants) && variants.length > 0) {
    const first = expandShapes(spec, resolved)[0];
    if (first && first !== resolved && !(first.oneOf || first.anyOf)) {
      return exampleFor(spec, first, mode, depth, path, changes);
    }
    return exampleFor(spec, variants[0], mode, depth + 1, path, changes);
  }

  const allTypes = shapeTypes(resolved);
  const type = allTypes.find((candidate) => candidate !== "null") || (allTypes.includes("null") ? "null" : undefined);
  switch (type) {
    case "null":
      return null;
    case "object": {
      const payload = {};
      for (const [name, propertySchema] of Object.entries(resolved.properties || {})) {
        if (includeProperty(spec, propertySchema, mode)) {
          payload[name] = exampleFor(spec, propertySchema, mode, depth + 1, path ? `${path}.${name}` : name, changes);
        }
      }
      return payload;
    }
    case "array": {
      const count = Math.max(1, typeof resolved.minItems === "number" ? resolved.minItems : 1);
      return Array.from({ length: Math.min(count, 5) }, (_, item) => exampleFor(spec, resolved.items, mode, depth + 1, `${path}[]`, item === 0 ? changes : null));
    }
    case "integer":
      return numberFor(resolved, true);
    case "number":
      return numberFor(resolved, false);
    case "boolean":
      return true;
    default:
      return stringFor(resolved);
  }
}

// A value converted to the schema's type when the conversion is exact:
// "12" to 12, 12 to "12", "true" to true.
function convert(value, types) {
  if (typeof value === "string") {
    if (types.includes("integer") && /^-?\d+$/.test(value) && Number.isSafeInteger(Number(value))) return Number(value);
    if (types.includes("number") && /^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
    if (types.includes("boolean") && (value === "true" || value === "false")) return value === "true";
  }
  if ((typeof value === "number" || typeof value === "boolean") && types.includes("string")) {
    return String(value);
  }
  return undefined;
}

// Brings an example in line with its schema, at every depth, and lists what
// changed so the doc can say so. Fields the schema does not define are
// removed, readOnly fields leave requests and writeOnly fields leave
// responses, values of the wrong type are converted when that is exact and
// replaced when not, values outside an enum, range, length, format or pattern
// are replaced, and required fields are added.
export function conformValue(spec, value, schema, mode = "any", depth = 0, path = "", changes = []) {
  const kind = modeKind(mode);
  const shapes = expandShapes(spec, schema);
  if (shapes.length === 0 || depth >= MAX_EXAMPLE_DEPTH) {
    return { value, changes };
  }
  if (valueProblems(spec, value, shapes, kind).length === 0) {
    return { value, changes };
  }
  // The option the value already fits best.
  const fit = (shape) => {
    const problems = valueProblems(spec, value, [shape], kind).length;
    const overlap = value && typeof value === "object" && !Array.isArray(value) ? Object.keys(value).filter((key) => key in (shape.properties || {})).length : 0;
    return problems - overlap * 0.5;
  };
  const shape = shapes.reduce((winner, candidate) => (fit(candidate) < fit(winner) ? candidate : winner), shapes[0]);
  const label = path || "(the whole example)";
  const replace = (reason) => {
    changes.push({ path: label, action: "replaced", reason });
    return { value: exampleFor(spec, shape, mode, depth + 1), changes };
  };

  if (value === null) {
    return allowsNull(shape) ? { value, changes } : replace("was null, which the schema does not allow");
  }
  const types = shapeTypes(shape).filter((type) => type !== "null");
  let current = value;
  if (types.length > 0 && !typeFits(jsonType(current), types)) {
    const converted = convert(current, types);
    if (converted === undefined || valueProblems(spec, converted, [shape], kind).length > 0) {
      return replace(`was ${/^[aeiou]/.test(jsonType(current)) ? "an" : "a"} ${jsonType(current)}; the schema says ${types.join(" or ")}`);
    }
    changes.push({ path: label, action: "converted", reason: `was ${/^[aeiou]/.test(jsonType(current)) ? "an" : "a"} ${jsonType(current)}; the schema says ${types.join(" or ")}` });
    current = converted;
  }

  if (Array.isArray(current)) {
    const items = current.map((item) => conformValue(spec, item, shape.items, mode, depth + 1, `${path}[]`, changes).value);
    const problem = constraintProblem(items, shape);
    return problem ? replace(problem.replace(/^has/, "had")) : { value: items, changes };
  }

  if (typeof current === "object") {
    const properties = shape.properties || {};
    const extraSchema = shape.additionalProperties && typeof shape.additionalProperties === "object" ? shape.additionalProperties : null;
    const open = Boolean(shape.additionalProperties) || Object.keys(properties).length === 0;
    const out = {};
    for (const [key, child] of Object.entries(current)) {
      const childPath = path ? `${path}.${key}` : key;
      if (key in properties) {
        if (!includeProperty(spec, properties[key], mode)) {
          changes.push({ path: childPath, action: "removed", reason: mode === "request" ? "readOnly" : "writeOnly" });
          continue;
        }
        out[key] = conformValue(spec, child, properties[key], mode, depth + 1, childPath, changes).value;
      } else if (extraSchema) {
        out[key] = conformValue(spec, child, extraSchema, mode, depth + 1, childPath, changes).value;
      } else if (open) {
        out[key] = child;
      } else {
        changes.push({ path: childPath, action: "removed", reason: "undefined" });
      }
    }
    for (const key of shape.required || []) {
      if (!(key in out) && properties[key] && includeProperty(spec, properties[key], mode)) {
        out[key] = exampleFor(spec, properties[key], mode, depth + 1);
        changes.push({ path: path ? `${path}.${key}` : key, action: "added", reason: "required" });
      }
    }
    return { value: out, changes };
  }

  // A scalar: allowed values, then range, length, format and pattern.
  if (Array.isArray(shape.enum) && !shape.enum.map(String).includes(String(current))) {
    return replace("is not one of the allowed values");
  }
  const problem = constraintProblem(current, shape);
  if (problem) {
    // A date-time given where the schema says date keeps its date.
    if (shape.format === "date" && typeof current === "string" && formatValid(current.slice(0, 10), "date") && /^\d{4}-\d{2}-\d{2}[Tt ]/.test(current)) {
      changes.push({ path: label, action: "converted", reason: "was a date-time; the schema says date" });
      return { value: current.slice(0, 10), changes };
    }
    return replace(problem);
  }
  return { value: current, changes };
}
