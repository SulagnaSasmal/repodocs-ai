# API Documentation Guardrails

Use this checklist before approving AI-generated API documentation.

## Verify Against Source

- endpoint path matches the OpenAPI or source definition
- method matches the source definition
- request parameters exist in the source schema
- response fields exist in the source schema
- authentication model is correct

## Reject If

- the document invents endpoints
- example payloads contain fields not present in the schema
- status codes do not match documented behavior
- version labels are missing or inconsistent

## Escalate To SME If

- the source specification is incomplete
- business rules are implied but not documented
- error semantics are unclear