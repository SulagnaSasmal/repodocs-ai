---
title: "Multi-Repo Adoption Guide"
description: "How to use RepoDocs AI across multiple service repositories"
service: "repodocs-ai"
component: "governance"
owner: "docs-platform"
api_version: "n/a"
status: stable
dependencies: []
last_reviewed: 2026-03-12
security_impact: low
---

# Multi-Repo Adoption Guide

This guide describes how to adopt RepoDocs AI across a microservices organization
where each service has its own documentation repository.

## The Problem

RepoDocs AI ships as a single repository. A microservices organization with
independent service repositories (payments, fraud, customers, notifications)
needs a way to:

1. Bootstrap each service repo from RepoDocs AI templates.
1. Keep templates synchronized when governance changes.
1. Aggregate coverage and analytics across all service repos.
1. Enforce consistent ownership and review standards across teams.

## Recommended Repository Structure

```text
company-docs/               # Optional: shared governance repo
├── schema/                 # Shared metadata schema and owners registry
├── templates/              # Shared template packs (synced from RepoDocs AI)
├── prompts/                # Shared AI prompt packs
└── validation/             # Shared validation scripts

payments-api-docs/          # Per-service documentation repository
├── templates/ → symlink or copy from company-docs
├── prompts/
├── examples/
│   └── openapi/            # Service OpenAPI specs
└── generated/              # AI-generated endpoint docs

fraud-api-docs/             # Second service repo — same structure
customers-api-docs/         # Third service repo — same structure
```

## Bootstrap Each Service Repo

Use the RepoDocs AI bootstrap script once per service:

```bash
git clone https://github.com/SulagnaSasmal/repodocs-ai.git
cd repodocs-ai
npm install
npm run bootstrap:docs-repo -- ../payments-api-docs
npm run bootstrap:docs-repo -- ../fraud-api-docs
npm run bootstrap:docs-repo -- ../customers-api-docs
```

Each bootstrapped repo receives the full template pack, prompt packs, and
validation scripts. It is then independent and can be committed to its own
Git repository.

## Synchronize Templates Across Repos

When the governance team updates a template or adds a required frontmatter
field, downstream repos need to receive the update.

Recommended sync approach:

1. Tag a new version in repodocs-ai (e.g., `v1.1.0`).
1. Each service repo maintainer runs `npm run bootstrap:docs-repo` against
   the updated repodocs-ai clone to pull refreshed templates and prompts.
1. Run `npm run validate` in the service repo to identify fields or structural
   changes that require updates to existing documentation.

A future automated sync workflow can be added as a GitHub Actions workflow
that opens a pull request in each downstream repo when a new repodocs-ai
release is tagged.

## Cross-Repo Analytics Aggregation

Each service repo produces its own analytics report at
`analytics/output/report.json` when you run `npm run analytics:report`.

To aggregate reports across all service repos:

1. Ensure each service repo has run `npm run analytics:report` recently.
1. Collect the `report.json` files from each service repo.
1. Merge them manually or with a script to get cross-service totals.

Example aggregation (run from a shared docs coordination repo):

```bash
node -e "
const fs = require('fs');
const paths = [
  '../payments-api-docs/analytics/output/report.json',
  '../fraud-api-docs/analytics/output/report.json',
  '../customers-api-docs/analytics/output/report.json'
];
let total = 0, stale = 0, missing = 0;
for (const p of paths) {
  const r = JSON.parse(fs.readFileSync(p, 'utf8'));
  total += r.total_documents;
  stale += r.stale_documents;
  missing += r.missing_owner_documents;
}
console.log({ total_documents: total, stale_documents: stale, missing_owner_documents: missing });
"
```

A dedicated `scripts/aggregate-analytics.mjs` script for this use case is
on the roadmap.

## Owner Consistency Across Repos

All service repos should use the same `schema/owners-registry.md` file so
that ownership identifiers are consistent across analytics reports.

Recommended approach:

1. Maintain a single `owners-registry.md` in a shared governance repository.
1. Copy or reference it into each service repo during bootstrap.
1. When a team is renamed, update the registry and run `npm run validate` in
   each service repo to surface documents with stale owner values.

## CODEOWNERS Per Service Repo

Each service repo should have its own `.github/CODEOWNERS` mapping its
documentation directories to the teams responsible for review. Use the
template at `.github/CODEOWNERS` in RepoDocs AI as the starting point and
replace the example team handles with your organization's GitHub team slugs.

## Endpoint Coverage Across Services

Run `npm run coverage:check` in each service repo to detect undocumented
endpoints relative to that service's OpenAPI spec.

To get a cross-service coverage summary, run the command in each repo and
aggregate the output:

```bash
for repo in payments-api-docs fraud-api-docs customers-api-docs; do
  echo "=== $repo ===";
  (cd ../$repo && npm run coverage:check) || true;
done
```
