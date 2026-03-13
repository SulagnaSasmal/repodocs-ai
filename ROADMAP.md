# RepoDocs AI Roadmap

## Current Release — v1.0.0 (March 2026)

RepoDocs AI v1.0.0 ships the full Phase 1, Phase 2, and Phase 3 foundation.

### What is delivered

- 14 documentation templates across 6 categories (API, product, feature, operations, architecture, governance)
- 6 structured AI prompt packs for generation and review
- Complete payments API example system (9 documents + OpenAPI spec)
- 7 validation scripts: frontmatter, structure, quality, OpenAPI examples, version compatibility, doc quality, coverage
- 6 GitHub Actions workflows: PR validation, Pages deployment, OpenAPI regeneration, export, automation assets
- Platform starters for MkDocs, Docusaurus, GitBook, and Next.js
- GitLab and Bitbucket CI configurations
- Export pipelines for Confluence, Google Docs, Notion, and PDF
- Hosted control plane with Redis-backed queue, bearer token auth, Docker and cloud deployment manifests
- AI-prompt-powered documentation agent with optional live Anthropic Claude review
- Analytics report generation and knowledge graph build scripts
- Static documentation site deployed via GitHub Pages

---

## Phase 4 — AI Execution Layer (Planned)

**Goal:** Make "AI-prompt-powered" fully verifiable through live agent behavior.

| Item | Description |
|------|-------------|
| Live multi-step agent | Full generate → review → diff → suggest cycle against a live LLM, not just API overview |
| GitHub write-back | Agent commits reviewed output to a branch and opens a PR automatically |
| Multi-model support | Support OpenAI GPT-4o as an alternative to Claude via `REPODOCS_AI_PROVIDER` env variable |
| Agent run history UI | Surface `agents/output/last-run.json` in the control plane dashboard |
| Hallucination score | Numeric confidence score per generated field, computed from spec cross-reference |

---

## Phase 5 — Enterprise Control Plane (Planned)

**Goal:** Make the hosted control plane viable for teams with security and compliance requirements.

| Item | Description |
|------|-------------|
| Identity provider integration | SSO via Auth0 or Okta (OIDC/SAML) for control plane authentication |
| Multi-tenant isolation | Separate job queues and artifact namespaces per team or service |
| Horizontal worker scaling | Multiple workers consuming from shared Redis queue |
| Job retry and dead-letter queue | Automatic retry with exponential backoff; dead-letter queue for failed jobs |
| Audit logging | Structured log of every job request, auth event, and artifact access |
| Rate limiting | Per-user and per-team rate limits on job submission |
| Webhook notifications | POST to a configured webhook URL when a job finishes |

---

## Phase 6 — Commercial Delivery (Planned)

**Goal:** Make RepoDocs AI purchasable and deliverable.

| Item | Description |
|------|-------------|
| Gumroad distribution | $49 individual and $149 team tiers sold via Gumroad with download access |
| License key validation | `check-template-version.mjs` checks a license key before running automation |
| Installer package | One-command `npx repodocs-ai init` to bootstrap a docs repo without cloning |
| Version update notifications | Alert when a newer template pack version is available |
| Private template registry | Team-scoped template packs stored in a private registry |

---

## Phase 7 — Documentation Intelligence (Research)

**Goal:** Move RepoDocs AI from a documentation generation system to a documentation intelligence layer.

| Item | Description |
|------|-------------|
| Live knowledge graph queries | Query the entity graph by service, owner, or dependency via the control plane |
| Drift detection | Detect when an OpenAPI spec changes and flag affected documentation automatically |
| Coverage dashboard | Visual map of documented vs undocumented endpoints per service |
| Semantic search | Full-text search across all repository documentation via vector embeddings |
| Changelog generation | Auto-generate a changelog entry from the diff between two OpenAPI spec versions |

---

## Spec Coverage Map

See [`docs/roadmap-spec-summary.md`](docs/roadmap-spec-summary.md) for a detailed map between the
v1.0 product specification, current phase coverage, and remaining gaps.

See [`docs/spec-scorecard.md`](docs/spec-scorecard.md) for a 17-dimension scorecard against the spec.

---

## Feedback and Contributions

To suggest a feature for the roadmap, open a [Feature Request](https://github.com/SulagnaSasmal/repodocs-ai/issues/new/choose).

To report a bug, open a [Bug Report](https://github.com/SulagnaSasmal/repodocs-ai/issues/new/choose).

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for contribution guidelines.
