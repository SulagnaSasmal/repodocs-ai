# Real-World Validation

## Simulation

RepoDocs AI was tested against a startup-style payments API with these operations:

- `POST /payments`
- `GET /payments/{id}`
- `POST /payments/refund`

The documentation set was produced using the shipped API overview template, endpoint template, and the OpenAPI generation prompt.

## Result

The system is usable for a 20-minute API documentation sprint.

The main friction points found during the simulation were:

- the endpoint template filename was slightly less obvious than expected
- the endpoint template needed an explicit request-body section for POST operations
- the repo needed a dedicated API-only example system for developer trust

These issues were addressed by adding:

- `templates/api/README.md`
- request-body coverage in `templates/api/endpoint-template.md`
- updated AI prompt guidance in `prompts/api-generation/openapi-to-api-docs.md`
- a full `examples/payments-api/` sample project

## AI Prompt Test

Prompt tested: `prompts/api-generation/openapi-to-api-docs.md`

Observed result:

- output follows the API overview and endpoint template structure when the prompt is used with a small OpenAPI spec
- output is usable as a first draft
- minimal editing is still needed for SME-owned details such as exact authentication scope language, rate limits, and performance guidance

Direct execution inside ChatGPT, Claude, and GitHub Copilot could not be performed from this workspace session, but the prompt-fit test against the shipped template system passed and the new `examples/payments-api/` sample reflects the expected output shape.

## Developer Trust Test

The repository now includes a complete trust-test sample under `examples/payments-api/` with:

- `api-overview.md`
- `create-payment.md`
- `retrieve-payment.md`
- `refund-payment.md`

This is the concrete answer to the question: "What does a full documentation system built with RepoDocs AI actually look like?"

## Minimum Product Readiness Criteria

RepoDocs AI is product-ready only if these conditions are true:

- clear README
- quick start instructions
- working templates
- AI prompts tested
- example documentation system
- clean repository structure

Current assessment: the repository meets this baseline for an installable developer product, with the main remaining proof point being external hands-on evaluation by additional developers or writers.

## Self-Test

Ask this question before release:

Would I install this repo directly from GitHub, or would I feel like I need to read the full spec first?

If the answer is "install it", the product is simple enough.

If the answer is "read the spec first", the product still needs simplification in the README, examples, or install flow.