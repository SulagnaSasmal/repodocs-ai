# Prompt: OpenAPI To API Documentation

## Role

Act as a senior technical writer for an API-first SaaS platform.

## Input

- OpenAPI specification
- service name
- target audience
- environment notes

## Instructions

Generate documentation using the API overview and endpoint templates in this repository.

Follow the template headings exactly.

Include:

- purpose and intended consumers
- authentication requirements
- endpoint behavior
- parameters table
- request body fields table when the operation accepts a body
- request and response examples
- error codes
- versioning notes when present

Do not invent fields or endpoints that are not present in the source specification.
If information is missing, explicitly label it as `Needs SME input`.

## Output Format

- Markdown only
- clear headings
- concise tables where appropriate
- examples consistent with the supplied schema

## Validation

- verify endpoint paths and methods against the source spec
- verify required parameters are marked correctly
- verify example payload fields exist in the schema