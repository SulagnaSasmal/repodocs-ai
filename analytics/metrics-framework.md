# Documentation Analytics Framework

## Purpose

This asset defines the analytics model for RepoDocs AI reporting, including
per-repo metrics and cross-repo aggregation for multi-service organizations.

## Coverage Metrics

- endpoint coverage percentage (documented / total spec endpoints)
- undocumented endpoint count by service
- phantom endpoint count (in docs, not in spec)

Run `npm run coverage:check` to generate these metrics against the OpenAPI specs in `examples/openapi/`.

## Health Metrics

- total documents with valid frontmatter
- stale documents (last_reviewed older than 90 days) by service and owner
- missing owner documents
- deprecated document count
- documents missing `reviewed_by` (not yet approved)

Run `npm run analytics:report` to generate these metrics.

## Governance Metrics

- validation pass rate per pull request
- documents by `audience` field (internal vs external vs both)
- documents by `status` field breakdown (draft / beta / stable / deprecated)
- owner distribution across services

## Cross-Repo Aggregation

For multi-service organizations, aggregate per-repo `analytics/output/report.json`
files across all service repos. See `docs/multi-repo-guide.md` for the
recommended aggregation approach.

## Collection Points

- `npm run validate` — validation workflow runs on every PR
- `npm run coverage:check` — OpenAPI endpoint coverage on every PR
- `npm run analytics:report` — frontmatter ownership, staleness, and status data
- `npm run graph:build` — document-to-endpoint dependency graph
- Publication events and export pipeline runs