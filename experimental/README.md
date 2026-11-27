# Experimental

These parts of RepoDocs AI work in this repository's own tests and demos, but they are not covered by the adopter tests and may change without notice. The core (bootstrap, generate, validate, and the CI workflow for docs repositories) does not depend on any of them.

## In this folder

| Path | What it is |
| --- | --- |
| `deploy/` | Dockerfile, Docker Compose stack, and deployment manifests for Render, Fly.io and Azure Container Apps, for the hosted control plane |
| `starters/` | MkDocs, Docusaurus, GitBook and Next.js starter sites |
| `platforms/` | CI configuration for GitLab and Bitbucket |

Render and Fly.io expect their manifests at the repository root. Copy `deploy/render.yaml` or `deploy/fly.toml` to the root, or point the platform at the file, before deploying.

## Elsewhere in the repository

These stay where they are because scripts and workflows read and write these paths.

| Command | Script | Data |
| --- | --- | --- |
| `npm run control-plane:start` and `control-plane:*` | `scripts/control-plane-server.mjs`, `scripts/control-plane-smoke.mjs` | Redis, `.control-plane/` |
| `npm run agent:run` | `scripts/run-documentation-agent.mjs` | `agents/` |
| `npm run analytics:report`, `analytics:aggregate` | `scripts/generate-analytics-report.mjs`, `scripts/aggregate-analytics.mjs` | `analytics/` |
| `npm run graph:build` | `scripts/build-knowledge-graph.mjs` | `knowledge-graph/` |
| `npm run export`, `export:*` | `scripts/export-docs.mjs` | writes to `exports/` |

`npm run export` writes files formatted for Confluence, Google Docs, Notion and print. It does not upload anything.
