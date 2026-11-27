# Changelog

This changelog tracks product-facing changes to RepoDocs AI.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Adopter path tests that bootstrap a docs repo, generate docs, run `validate:docs` and the bootstrapped CI step, and check the output against the spec, using five third-party OpenAPI specs from the OpenAPI Initiative.
- Consistency tests: every `npm run` command in the README and CI workflows exists, every npm script points at a file that exists, and every repository path the README mentions exists.
- A release check procedure with a fresh-agent README test, in `.github/release-checks/`.

### Changed

- Replaced 81 file-exists tests with the consistency tests above.

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