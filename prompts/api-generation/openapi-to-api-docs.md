# Prompt: OpenAPI To API Documentation

## Role

Act as a senior technical writer for an API-first SaaS platform.

## Input

- OpenAPI specification
- service name
- target audience
- environment notes

## Instructions

Generate documentation using the API overview and endpoint templates in this
repository.

Follow the template headings exactly, section by section, in this order:

1. **Authentication** — authentication method, token type, and required scope
2. **Path Parameters** — required path variables such as `{id}` or `{payment_id}`
3. **Query Parameters** — optional or required query string parameters
4. **Request Body** — fields table: name, type, required, description
5. **Response Schema** — fields table for the primary success response body
6. **Error Responses** — table of HTTP status codes, names, and descriptions
7. **Code Example** — a complete curl request and expected response
8. **Performance Notes** — rate limits, payload limits, or latency targets

Every section must be present. If a section has no applicable content, write
`Not applicable` under the heading rather than omitting the heading entirely.

Do not invent fields, endpoints, parameters, or status codes that are not
present in the source specification. If information is missing or ambiguous,
label it exactly as `Needs SME input`. Do not guess or infer values the spec
does not provide.

If no OpenAPI specification is available yet, document only what the source
material explicitly states. Label every field, response, and error code as
`Needs SME input` and add this notice at the top of the document:

> Source specification not yet available — all content requires SME review
> before publication.

## Self-Validation Before Output

Before returning the document, verify each item:

- [ ] Endpoint path and HTTP method match the spec definition exactly
- [ ] Every path parameter in the URL template is listed in Path Parameters
- [ ] Every query parameter in the spec is listed in Query Parameters
- [ ] All request body fields exist in the spec `requestBody` schema
- [ ] All response fields exist in the spec `responses` schema
- [ ] All HTTP status codes are drawn from the spec `responses` block
- [ ] Authentication model matches the spec `security` definition
- [ ] No section heading is missing — all eight sections are present
- [ ] Every value that could not be verified from the spec is marked `Needs SME input`

## Output Format

- Markdown only
- Clear headings matching the template structure
- Concise tables for parameters, fields, and error codes
- curl example consistent with the supplied schema

## Two-Step Workflow

This prompt is step 1. After generating the document, pass the output to
`prompts/review/documentation-review.md` for spec cross-reference and
hallucination detection before publication.
