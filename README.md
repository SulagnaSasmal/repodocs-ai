# RepoDocs AI

AI-native docs-as-code documentation system for SaaS API teams.

RepoDocs AI gives engineering teams a reusable template library, structured AI prompts, diagram starters, and review guardrails for Markdown-based documentation in GitHub repositories.

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

## Repository Layout

```text
repodocs-ai/
├── .github/
├── docs/
├── diagrams/
├── examples/
├── scripts/
├── site/
├── prompts/
├── schema/
├── templates/
└── validation/
```

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

## Automation

- frontmatter validation for templates and examples
- repository structure validation
- documentation quality validation for examples and generated output
- schema-aware OpenAPI validation for endpoint examples
- Markdown linting
- OpenAPI-to-Markdown generation script
- pull request validation workflow
- GitHub Pages deployment workflow
- MkDocs starter integration

## How To Use

1. Start from a template in `templates/`.
2. Add required frontmatter from `schema/metadata-frontmatter.md`.
3. Use a matching prompt from `prompts/` to draft content with an AI assistant.
4. Validate the result against the checklists in `validation/`.
5. Commit the documentation into the product repository and review it through pull requests.

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
- GitHub Actions added for pull request checks
- static landing and docs pages added under `site/`
- GitHub Pages deployment workflow added

## Initial Roadmap

- add more template packs for operations and architecture
- add OpenAPI-to-template generation workflows
- add Docusaurus starter integration
- expand quality checks to cover example payload validation

See `docs/roadmap-spec-summary.md` for a direct map between the specification, roadmap, current phase coverage, and remaining gaps.

## Buyer Fit

RepoDocs AI is designed for:

- startup CTOs
- heads of engineering
- developer relations leads
- technical writers in API-first SaaS teams