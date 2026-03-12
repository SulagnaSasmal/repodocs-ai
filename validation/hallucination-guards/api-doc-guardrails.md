# API Documentation Guardrails

Use this checklist before approving AI-generated API documentation.

The automated validator (`npm run validate:quality`) catches structural and
placeholder issues automatically on every pull request. This checklist covers
correctness checks that require the source specification and cannot be
automated without it.

## Automated Checks (npm run validate:quality)

The following are detected automatically on every pull request:

- Unresolved placeholder content (`{endpoint-name}`, `Replace with actual...`)
- Missing structured section headings
- Invalid HTTP method values (anything other than GET, POST, PUT, PATCH, DELETE)
- Missing required endpoint sections: Authentication, Response Schema,
  Error Responses, Code Example
- Suspicious HTTP status codes (200 on POST create, 201 on GET, flagged as warnings)
- `Needs SME input` label count (reported as warnings — must reach zero before publication)

## Manual Spec Cross-Reference (required before merge)

- [ ] Endpoint path matches the OpenAPI or source definition exactly
- [ ] HTTP method matches the source definition
- [ ] Every path parameter in the URL exists in the spec `parameters` list
- [ ] Every query parameter listed exists in the spec `parameters` list
- [ ] All request body fields exist in the spec request schema — no invented fields
- [ ] All response fields exist in the spec response schema — no invented fields
- [ ] Authentication model matches the spec security definition
- [ ] All HTTP status codes are drawn from the spec `responses` block

## Reject If

- The document contains request or response fields not present in the spec schema
- Example payloads contain invented fields
- Status codes do not match the spec `responses` block
- Version labels are missing or inconsistent with the spec `info.version`
- Any required section heading is absent

## Escalate To SME If

- The source specification is incomplete or contradictory
- Business rules are implied but not documented in the spec
- Error semantics are unclear or undocumented
- Any `Needs SME input` label remains unresolved at merge time

## Two-Prompt Workflow

1. Generate: `prompts/api-generation/openapi-to-api-docs.md`
2. Review: `prompts/review/documentation-review.md`

Both prompts must be used together. Generation without review leaves
hallucination risk undetected. Review without the source spec can only catch
structural issues — it cannot detect invented field names.
