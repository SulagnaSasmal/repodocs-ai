# Changelog

This changelog tracks product-facing changes to RepoDocs AI.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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