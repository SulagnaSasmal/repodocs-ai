# RepoDocs AI Roadmap And Spec Summary

## Current Position

RepoDocs AI now implements the full foundation described for phases 1 and 2, plus a working baseline of phase 3 automation and publishing.

The repository currently delivers:

- a documented product specification
- a reusable Markdown template library
- a shared frontmatter schema
- AI prompt packs for generation and review
- governance checklists and hallucination guardrails
- example documentation sets
- repository validation scripts and CI workflows
- a GitHub Pages-ready static site

## Phase Coverage

### Phase 1: Foundation

Status: Complete

Implemented assets:

- product specification in `docs/product-specification.md`
- repository structure for templates, prompts, diagrams, validation, schema, and examples
- shared metadata model in `schema/metadata-frontmatter.md`
- governance checklist and review guardrails
- repository README describing scope and usage

Outcome:

The repository explains the product clearly and gives every documentation asset a common metadata contract.

### Phase 2: Core Template Packs

Status: Substantially complete

Implemented assets:

- product overview template
- feature documentation template
- user guide template
- administrator guide template
- API overview template
- endpoint template
- prompts for product, feature, API, and review workflows
- example product, feature, and API documents

Outcome:

Teams can adopt the repository to document a SaaS product, a product feature, and an API using consistent Markdown-first workflows.

Remaining depth improvements:

- expand examples into a richer end-to-end complete system sample
- add broader template packs such as operations and architecture

### Phase 3: Automation And Publishing

Status: In progress, baseline implemented

Implemented assets:

- frontmatter validation script
- repository structure validation script
- documentation quality validation script
- OpenAPI schema-aware example validation script
- Markdown linting
- pull request validation workflow
- manual OpenAPI-to-Markdown generation workflow
- GitHub Pages deployment workflow
- static landing and docs site pages
- MkDocs starter integration

Outcome:

The repository now validates core docs hygiene, supports OpenAPI-assisted document generation, and publishes a presentation site through GitHub Pages.

Remaining automation gaps:

- automatic regeneration of docs from changed OpenAPI specs
- Docusaurus starter integration
- multi-channel export support for systems such as Confluence or PDF

## Spec Coverage Map

### Fully covered

- Documentation Template Library
- Metadata Schema
- AI Prompt Framework
- basic Mermaid architecture and sequence starters
- Documentation Validation System baseline with schema-aware API example checks

### Partially covered

- diagram coverage beyond architecture and sequence
- end-to-end example system
- workflow automation from OpenAPI source to generated docs
- version compatibility and deeper semantic validation beyond current OpenAPI checks

### Not yet covered

- GitLab and Bitbucket support
- workflow packaging for sellable distribution
- Notion, Confluence, and Google Docs output support
- advanced lifecycle automation and maintenance workflows

## Recommended Next Steps

1. Add automatic regeneration from changed OpenAPI specs.
2. Add a Docusaurus starter project pack.
3. Expand the complete-system example into a full end-to-end sample.
4. Add operations and architecture template packs.