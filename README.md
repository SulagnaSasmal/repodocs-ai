# RepoDocs AI

AI-native docs-as-code documentation system for SaaS API teams.

RepoDocs AI gives engineering teams a reusable template library, structured AI prompts, diagram starters, and review guardrails for Markdown-based documentation in GitHub repositories.

## Scope

Version 1 focuses on:

- API documentation
- feature documentation
- documentation governance
- Markdown-first repository workflows

## Repository Layout

```text
repodocs-ai/
├── diagrams/
├── examples/
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

### Features

- feature overview
- user workflow documentation

### Governance

- review checklist
- quality validation guidance

## How To Use

1. Start from a template in `templates/`.
2. Add required frontmatter from `schema/metadata-frontmatter.md`.
3. Use a matching prompt from `prompts/` to draft content with an AI assistant.
4. Validate the result against the checklists in `validation/`.
5. Commit the documentation into the product repository and review it through pull requests.

## Initial Roadmap

- add more template packs for operations and architecture
- add automation scripts for frontmatter and doc quality checks
- add OpenAPI-to-template generation workflows
- add static-site starter integration for MkDocs and Docusaurus

## Buyer Fit

RepoDocs AI is designed for:

- startup CTOs
- heads of engineering
- developer relations leads
- technical writers in API-first SaaS teams