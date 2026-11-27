# Changelog

This changelog tracks product-facing changes to RepoDocs AI.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.3] — 2026-11-28

Fixes from the v1.2.2 fresh-agent release check, which used the Adyen Checkout API and 101 deliberate breaks. v1.2.2 failed the run on 59 of them; v1.2.3 fails it on 96. See `.github/release-checks/2026-11-28-v1.2.2.md`.

### Added

- The OpenAPI check compares the JSON type of every example value with the schema, in request, response and error examples.
- `Default:`, `Format:`, `Minimum:` and `Maximum:` notes in Request Body rows and parameter tables are compared with the schema, as are plain allowed-value lists written by hand.
- The request example's credentials (`-u`, `Authorization: Bearer`) and `Content-Type` header are compared with the spec, and so is a Request Body that says the body is required or optional.
- `TODO`, `TBD`, `FIXME`, `<insert …>`, `{{…}}` and lorem ipsum fail the quality check.
- `last_reviewed` must be a date that exists on the calendar and is not in the future.
- A warning when a hand-written doc that follows a template drops some of its sections, and when the request URL still has a `{name}` placeholder.
- The validate summary gives the reason for each skipped check.
- The Adyen Checkout API as a third-party fixture, with probe tests for every new check.

### Changed

- The "POST returning 200" heuristic applies to hand-written docs only.
- Path and query parameters with no example appear as `{name}` in the curl URL instead of `value`.
- The generator writes allowed values in backticks, so prose in a spec's description is never read as an enum.
- When a spec's own example gives a number as a string, the generator shows the number and says so.
- The OpenAPI and version checks in `npm run validate` cover every example folder that `init --with-examples` copies.

### Fixed

- The bundled examples failed the OpenAPI check after `init --with-examples`, and their owners were missing from the owners registry.
- Parameter names written in backticks in hand-written tables were not recognised.
- A `##### Authentication` heading copied from a spec description hid the overview's Authentication section from the check; the generator now demotes such headings.
- Newlines and pipes in spec descriptions broke table rows; keywords next to `$ref` were ignored; deprecated parameters and fields were not marked; `last_reviewed` used the UTC date rather than the local one.
- Validators write their report in one call and set the exit code, so no lines are lost when output goes to a pipe.

## [1.2.2] — 2026-11-28

Fixes from the v1.2.1 fresh-agent release check, which used the Vonage Conversation API and 37 deliberate breaks. See `.github/release-checks/2026-11-28-v1.2.1.md`.

### Added

- The OpenAPI check now covers JSON examples at every depth (unknown fields, enum values, every `oneOf` shape), Request Body table rows (field exists, type, allowed values), the authentication section, the server URL, and the success status.
- Leftover template instructions and template descriptions fail the quality check.
- `last_reviewed` must be a real `YYYY-MM-DD` date.
- Owners missing from the docs repository's `schema/owners-registry.md` produce a warning.
- `validate --strict` fails the run when a check is skipped.
- Nested `oneOf` fields list each shape's fields with their option number.
- Response examples show the success status. Parameter and field defaults are listed.
- `help` lists every option.
- The Vonage Conversation API as an eighth third-party fixture, with probe tests for every break the release check tried.

### Changed

- The OpenAPI and version checks report SKIP, not PASS, when there are no docs to compare.
- When a spec's own example shows fields its schema does not define, the generator leaves them out and says which.

### Fixed

- Request bodies defined under `components/requestBodies` were documented as "Not applicable", so generated docs failed validation.
- Date examples changed with the machine's time zone.
- Deprecated operations got an invented "deprecated as of" version.

## [1.2.1] — 2026-11-27

Fixes from the v1.2.0 fresh-agent release check, which used the Ably Platform API. See `.github/release-checks/2026-11-27-v1.2.0.md`.

### Added

- `generate --owner <team>` sets the frontmatter owner. Without it the owner is `unassigned`, which the quality check flags.
- The OpenAPI check flags undefined query parameters, query values outside their allowed values, status codes the spec does not define, wrong Required flags in parameter and request body tables, readOnly fields sent in requests, and writeOnly fields shown in responses.
- `init` creates `openapi/`, `generated/` and `docs/`.
- The Ably Platform API as a seventh third-party test fixture, and probe tests that break generated docs on purpose and confirm each break is caught.

### Changed

- `oneOf` and `anyOf` request bodies are documented as numbered options, each with its own field table.
- Request field tables leave out readOnly fields, list allowed values for enums, and include nested fields as `parent.child`, two levels deep.
- Error Codes use the spec's descriptions, including shared `$ref` responses, and show an example error body.
- Authentication text includes each security scheme's description.
- The bootstrapped CI workflow fails when there are no Markdown docs to check, instead of passing.
- `docs/installation.md` is rewritten around the `repodocs-ai` command.

### Fixed

- Freshly generated docs failed the OpenAPI check when a request body used `oneOf`.
- Parameter tables in generated docs were never compared with the spec.
- Empty required frontmatter fields, such as `owner: ""`, passed validation.
- When a spec's own request example leaves out required fields, the generator adds them from the schema and says so.
- Overview titles repeated "API".

## [1.2.0] — 2026-11-27

### Added

- The `repodocs-ai` command: `init`, `generate` and `validate`, with paths resolved from the current directory. Install it with `npm install -g github:SulagnaSasmal/repodocs-ai#v1.2.0`, or run it with `npx`.
- CLI tests, including one that installs the packed package in a new project and runs the full path.
- Adopter path tests that bootstrap a docs repo, generate docs, run `validate:docs` and the bootstrapped CI step, and check the output against the spec, using five third-party OpenAPI specs from the OpenAPI Initiative.
- Consistency tests: every `npm run` command in the README and CI workflows exists, every npm script points at a file that exists, and every repository path the README mentions exists.
- A release check procedure with a fresh-agent README test, in `.github/release-checks/`.

### Changed

- Replaced 81 file-exists tests with the consistency tests above.
- Bootstrapped docs repositories run validation in CI with `npx` and the same RepoDocs AI version that created them, instead of checking out this repository.
- `generate` and `init` resolve paths from the current directory instead of the RepoDocs AI folder.
- The package is no longer private and installs only `js-yaml` at runtime. The Anthropic SDK and Redis, used only by experimental scripts, are now development dependencies.

### Fixed

- Server variables in the server URL were left unresolved in generated URLs.
- Form-encoded and multipart request bodies were reported as "Not applicable". They are now documented, with matching curl examples.
- Named response examples and examples on non-JSON media types were ignored.

## [1.1.0] — 2026-11-27

This release makes validation work on your own docs and makes the README match what the tool does. The issues were found by following the README as a first-time user and as a fresh AI agent, using the public Swagger Petstore spec.

### Added

- `npm run validate:docs -- <docs> --specs <specs>` runs the frontmatter, structure and quality, OpenAPI example and API version checks on your docs, and reports PASS, WARN, FAIL or SKIP for each.
- Bootstrapped docs repositories get a CI workflow (`.github/workflows/docs-validate.yml`) that runs those checks on every pull request.
- Generated docs document header parameters, including `Idempotency-Key` in the payments example.
- The quality check warns about placeholder example values left by the generator.
- Dependabot updates for npm and GitHub Actions.
- A "What It Does Not Do" section in the README.

### Changed

- Every check names the folder it checked. Spec checks without `--specs` report SKIP, never PASS.
- The quality check lists what it checks instead of reporting "MERGE-SAFE and PUBLICATION-READY".
- The OpenAPI and version checks count only the docs they actually compared.
- Curl examples include credentials only when the spec defines security, using the scheme's real header.
- Endpoint titles fall back to `operationId`; the overview uses the spec's `info.title`.
- The bootstrapped CODEOWNERS contains commented example rules instead of this repository's owner.
- README claims now match the code: exports write files and upload nothing, generated docs are drafts for SME review, and the control plane, deployment manifests and site starters are marked experimental.
- `js-yaml` moved to runtime dependencies. Upgraded `vitest` to 5 and `markdownlint-cli` to 0.50; the test suite now needs Node.js 22 or later.
- Experimental parts moved to `experimental/`: control plane deployment files, site starters, and GitLab and Bitbucket CI. See `experimental/README.md`.
- Moved the old static site, demo video assets, pricing notes and internal planning docs to `archive/`, out of the published site.

### Fixed

- `validate:quality` ignored the folder passed to it and validated this repository's examples instead.
- The OpenAPI check skipped request and response schemas defined through `$ref`.
- `allOf` schemas lost properties and required fields in generated examples.
- A 204 response got an invented response body.
- A missing spec file printed a stack trace, and Authorization headers could appear twice in curl examples.
- 16 of 20 reported dependency vulnerabilities, including both critical ones. 4 low-severity advisories remain in a markdownlint dependency.

## [1.0.0] — 2026-03-13

First stable release of RepoDocs AI.

### Added

- Complete API documentation template pack (`templates/api/`)
- Product, feature, operations, and architecture template packs
- AI prompt packs for generation and review (`prompts/`)
- Payments API example system with 9 documents + OpenAPI spec (`examples/payments-api/`)
- Complete cross-type example system (`examples/complete-system/`)
- Six validation scripts: frontmatter, structure, quality, OpenAPI examples, version compatibility, and doc quality
- Six GitHub Actions workflows: PR validation, Pages deployment, OpenAPI regeneration, export, automation assets
- Static documentation site (`site/`) deployed via GitHub Pages
- Hosted control plane with Redis-backed queue, bearer token auth, and container deployment manifests
- Platform starters for MkDocs, Docusaurus, GitBook, and Next.js
- CI configuration for GitLab and Bitbucket
- Export pipelines for Confluence, Google Docs, Notion, and PDF
- Knowledge graph build script and entity model
- Analytics report generation
- Documentation agent orchestration script
- SECURITY.md with vulnerability disclosure policy
- ROADMAP.md at repository root
- Vitest test suite for validation scripts and prompt library
- docs/archive/ preserving original v1 product specification documents
- spec-summary.html enforced in repository structure validation

### Improved

- README first-impression flow follows Problem → Solution → Example → Quick Start
- OpenAPI example validation matches example-local specs across route-parameter naming differences
- Payments API trust-proof example added authentication, errors, idempotency, and webhook docs
- AI agent documentation: reframed from "AI-native" to "AI-prompt-powered" to accurately reflect current capabilities
- Control plane hardened with job timeouts, retry logic, and structured JSON logging

### Foundation (Pre-Release Work)

- Phase 1: product specification, repository structure, metadata schema, validation and review guardrails
- Phase 2: template packs, prompt packs, example documentation
- Phase 3: automation scripts, CI workflows, static site, GitHub Pages deployment