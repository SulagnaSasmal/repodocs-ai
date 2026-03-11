# RepoDocs AI

AI-native docs-as-code documentation system for SaaS API teams.

RepoDocs AI gives engineering teams a reusable template library, structured AI prompts, diagram starters, and review guardrails for Markdown-based documentation in GitHub repositories.

## What This Repo Is

RepoDocs AI is a developer product for teams that want to stand up a serious documentation repository quickly.

It is not just a folder of Markdown templates. It includes:

- reusable templates for API, feature, governance, operations, product, and architecture docs
- prompt packs for AI drafting and review
- examples that show the system in practice
- validation scripts for documentation quality and structure
- an optional hosted control plane for automation

## How To Use It

Use RepoDocs AI as the starting kit for your own documentation repository.

The shortest path is:

1. Create a docs repository for your company or product.
2. Copy the RepoDocs AI template packs into that repository.
3. Use the prompts to draft and review content.
4. Start documenting your APIs and features.
5. Run validation before publishing.

## How To Install It

If you want to evaluate RepoDocs AI itself, clone this repository, install dependencies, and run the validation suite.

If you want to adopt RepoDocs AI into your own docs repository, use the Quick Start below.

Start here if you are evaluating the product:

- `docs/installation.md` for the 5-minute install path
- `docs/product-guide.md` for product positioning and fit
- `docs/index.md` for the source docs hub
- `site/installation.html` for the published quickstart page

The repository currently implements the Phase 1 and Phase 2 foundation of the product, plus a baseline of Phase 3 automation:

- product specification and scope definition
- metadata and validation system
- product documentation templates
- API documentation templates
- AI prompt packs for generation and review
- example documentation sets
- Phase 3 validation and publishing automation
- OpenAPI-assisted document generation scaffold
- static landing and docs site for product presentation

## Scope

Version 1 focuses on:

- API documentation
- feature documentation
- documentation governance
- Markdown-first repository workflows

## Quick Start

This is the fastest way to use RepoDocs AI as a developer adopting it into a real documentation repository.

1. Create a documentation repository.
2. Copy RepoDocs AI templates.
3. Start documenting APIs.

Example on Windows PowerShell:

```powershell
mkdir company-docs
Set-Location company-docs
Copy-Item ..\repodocs-ai\templates -Destination . -Recurse
Copy-Item ..\repodocs-ai\prompts -Destination . -Recurse
Copy-Item ..\repodocs-ai\diagrams -Destination . -Recurse
```

Example on bash:

```bash
mkdir company-docs
cd company-docs
cp -R ../repodocs-ai/templates .
cp -R ../repodocs-ai/prompts .
cp -R ../repodocs-ai/diagrams .
```

Then start with:

1. `templates/api/` for API documentation
2. `templates/features/` for feature documentation
3. `templates/governance/` for review and quality guardrails
4. `prompts/` for AI-assisted drafting and review

## Install RepoDocs AI

The repository should be installable in under 5 minutes for a developer evaluating the system.

1. Clone the repository.
2. Run `npm install`.
3. Run `npm run validate` to verify the template packs, prompts, examples, and docs structure.
4. Open `docs/index.md` for the source documentation hub or `site/index.html` for the published product walkthrough.
5. Use the Quick Start section above if your goal is to create your own documentation repository from these assets.

For the optional hosted automation runtime:

1. Set `REPODOCS_CONTROL_PLANE_BOOTSTRAP_KEY`.
2. Run `npm run control-plane:stack:smoke`.
3. Confirm the Redis-backed control plane and admin flow pass the smoke test.

## Repository Layout

```text
repodocs-ai/
├── README.md
├── LICENSE
├── .github/
├── docs/
│   ├── index.md
│   ├── installation.md
│   └── product-guide.md
├── diagrams/
├── examples/
├── prompts/
├── templates/
│   ├── api/
│   ├── features/
│   └── governance/
├── site/
└── scripts/
```

Product-facing entry points inside `docs/`:

- `docs/index.md`
- `docs/product-guide.md`
- `docs/installation.md`
- `docs/ready-to-install-system.md`
- `docs/product-specification.md`

## Core Principles

1. Templates are modular and reusable.
2. Every template includes AI-ready generation or review guidance.
3. Documentation is designed for repository workflows, not isolated files.
4. Review quality is enforced through structured validation.

## Template Packs

### API

- API overview
- endpoint template

### Product

- product overview
- feature documentation
- user guide
- administrator guide

### Features

- feature overview
- user workflow documentation

### Governance

- review checklist
- quality validation guidance

### Operations

- runbook
- deployment guide

### Architecture

- system architecture
- integration architecture

## Automation

- frontmatter validation for templates and examples
- repository structure validation
- documentation quality validation for examples and generated output
- schema-aware OpenAPI validation for endpoint examples
- request-body validation against OpenAPI request schemas
- version-compatibility validation for API docs and examples
- deprecation and migration validation for versioned endpoint docs
- Markdown linting
- OpenAPI-to-Markdown generation script
- automatic regeneration workflow for changed OpenAPI specs
- runnable documentation-agent orchestration for OpenAPI sources
- runnable analytics report generation for repository coverage and freshness
- runnable knowledge-graph generation from frontmatter, dependencies, and endpoints
- export pipelines for Confluence, Google Docs, Notion, and PDF-ready artifacts
- small hosted control plane for running automation over HTTP
- per-user API-key and bearer-token authentication for control-plane endpoints
- Redis-backed durable queued execution so multiple automation requests can be accepted safely across restarts and workers
- container packaging for hosted control-plane deployment
- hosted deployment manifest for Render with persistent disk configuration
- hosted deployment manifests for Fly.io and Azure Container Apps
- pull request validation workflow
- GitHub Pages deployment workflow
- MkDocs starter integration
- Docusaurus starter integration
- GitBook starter integration
- Next.js docs starter integration

## How To Use

1. Start from a template in `templates/`.
2. Add required frontmatter from `schema/metadata-frontmatter.md`.
3. Use a matching prompt from `prompts/` to draft content with an AI assistant.
4. Validate the result against the checklists in `validation/`.
5. Commit the documentation into the product repository and review it through pull requests.

## Product Surface

If you want the repository to feel like a clean developer product, use these entry points first:

- `README.md` for the top-level promise and install path
- `docs/index.md` for the source docs hub
- `templates/README.md` for the template packs
- `prompts/README.md` for AI prompt packs
- `examples/README.md` for working reference systems
- `diagrams/README.md` for visual starters

## Phase Status

### Phase 1

- product specification stored in `docs/`
- repository structure established
- metadata schema defined
- validation and review guardrails added

### Phase 2

- product documentation template pack added
- API documentation template pack added
- prompt packs added for authoring and review
- example documentation added

### Phase 3

- validation scripts added for frontmatter and repository structure
- OpenAPI generation script and manual workflow added
- schema-aware OpenAPI example validation added
- request-body schema validation added
- automatic regeneration workflow added for changed OpenAPI specs
- GitHub Actions added for pull request checks
- static landing and docs pages added under `site/`
- GitHub Pages deployment workflow added

## Initial Roadmap

- add more template packs for operations and architecture
- add OpenAPI-to-template generation workflows
- expand quality checks to cover example payload validation

The repository now includes starter packs for both MkDocs and Docusaurus, plus an end-to-end sample under `examples/complete-system/`.

The repository also includes GitBook and Next.js starter packs, GitLab and Bitbucket support assets, pricing and bundle manifests, and runnable repository automation for documentation agents, knowledge graph indexing, and analytics.

## UI

Yes. RepoDocs AI already includes a lightweight static UI in `site/` for GitHub Pages deployment. It covers the landing page, roadmap, automation summary, and complete-system walkthrough.

## Automation Commands

- `npm run validate`
- `npm run agent:run`
- `npm run analytics:report`
- `npm run graph:build`
- `npm run automation:run`
- `npm run export`
- `npm run export:notion`
- `npm run control-plane:start`
- `npm run control-plane:smoke`
- `npm run control-plane:stack:up`
- `npm run control-plane:stack:smoke`
- `npm run control-plane:stack:down`

Control plane environment:

- `REPODOCS_CONTROL_PLANE_HOST`
- `REPODOCS_CONTROL_PLANE_PORT`
- `REDIS_URL`
- `REPODOCS_CONTROL_PLANE_DATA_DIR`
- `REPODOCS_CONTROL_PLANE_BOOTSTRAP_USER`
- `REPODOCS_CONTROL_PLANE_BOOTSTRAP_DISPLAY_NAME`
- `REPODOCS_CONTROL_PLANE_BOOTSTRAP_KEY`
- `npm run docker:control-plane:build`
- `npm run docker:control-plane:run`

The control plane now stores queue state, run metadata, and user/key records in Redis so multiple app instances can safely accept and process jobs against shared state. The legacy `.control-plane/*.json` files are only used as a one-time migration source when Redis starts empty.

For local development, the repository now includes a `compose.yaml` stack that runs Redis and the control plane together. Both services publish Docker health checks, so `docker compose ps` shows when Redis is ready and when the control plane is answering `/health`. Set `REPODOCS_CONTROL_PLANE_BOOTSTRAP_KEY` in your shell or environment, then run `npm run control-plane:stack:up`.

To run a repeatable end-to-end verification against a live stack, use `npm run control-plane:smoke`. To boot the compose stack and run the smoke test in one step, use `npm run control-plane:stack:smoke`.

Control plane management endpoints:

- `GET /users` for admin user inventory
- `POST /users` to create a user and initial key
- `PATCH /users/:id` to update role, display name, or status
- `POST /users/:id/keys` to rotate or add a user key
- `DELETE /users/:id/keys/:keyId` to revoke a key

Hosted deployment manifests:

- `render.yaml`
- `fly.toml`
- `azure-container-apps.yaml`

See `docs/roadmap-spec-summary.md` for a direct map between the specification, roadmap, current phase coverage, and remaining gaps.
For the published Pages version, use `site/spec-summary.html`.
See `docs/spec-scorecard.md` for a strict 17-section scorecard against the attached specification.

## Buyer Fit

RepoDocs AI is designed for:

- startup CTOs
- heads of engineering
- developer relations leads
- technical writers in API-first SaaS teams