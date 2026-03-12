# Prompt: Documentation Review

## Role

Act as a senior documentation reviewer checking for accuracy, completeness,
and hallucination risk in AI-generated API documentation.

## Input

- Markdown document to review
- Source OpenAPI specification or source material
- Target audience

## Review Checklist

### 1. Spec Cross-Reference

Compare every value in the document against the source specification:

- [ ] Endpoint path matches the spec `paths` definition exactly
- [ ] HTTP method matches the spec operation (`get`, `post`, `put`, `patch`, `delete`)
- [ ] Every path parameter in the URL exists in the spec `parameters` list with `in: path`
- [ ] Every query parameter listed exists in the spec `parameters` list with `in: query`
- [ ] Every request body field in the Request Example and Request Body table exists in the spec `requestBody.content.*.schema`
- [ ] Every response field in the Response Example exists in the spec `responses.*.content.*.schema`
- [ ] Every HTTP status code in the Error Codes table exists in the spec `responses` block
- [ ] Authentication method matches the spec `security` or `securitySchemes` definition

### 2. Completeness

Check that no required section is missing. All ten sections must be present:

- [ ] Summary
- [ ] Endpoint (Method and URL lines)
- [ ] Authentication Requirements
- [ ] Path Parameters (even if `Not applicable`)
- [ ] Query Parameters (even if `Not applicable`)
- [ ] Request Body (even if `Not applicable`)
- [ ] Request Example
- [ ] Response Example
- [ ] Error Codes
- [ ] Performance Notes

### 3. Hallucination Indicators

Flag any of the following as critical issues:

- Request or response fields that do not appear in the spec schema
- Invented path segments or query strings not in the spec
- Status codes not listed in the spec `responses` block
- Authentication flows not defined in the spec `securitySchemes`
- Version labels that do not match the spec `info.version`

### 4. SME Input Tracking

List all `Needs SME input` labels found in the document. Each one represents a
gap that must be resolved by a subject matter expert before publication.

### 5. Language and Usability

- [ ] No unclear abbreviations without expansion on first use
- [ ] curl example is syntactically valid and runnable
- [ ] Tables are complete — no empty required cells
- [ ] Descriptions are specific, not generic placeholder text

## Output Format

Return:

1. **Critical issues** — spec mismatches, invented fields, missing required sections
2. **Moderate issues** — unclear language, incomplete tables, suspicious status codes
3. **SME inputs required** — list every `Needs SME input` label with its location
4. **Suggested edits** — improvements that do not affect accuracy

Do not rewrite the whole document unless explicitly asked.

## Two-Step Workflow

This prompt is step 2. Step 1 is `prompts/api-generation/openapi-to-api-docs.md`.

Always run this review against the same spec that was used for generation. A
review without the source spec can only catch structural and language issues —
it cannot detect hallucinated fields.
