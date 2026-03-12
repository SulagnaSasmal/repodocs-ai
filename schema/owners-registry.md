---
title: "Owners Registry"
description: "Valid team identifiers for the owner frontmatter field"
service: "repodocs-ai"
component: "governance"
owner: "docs-platform"
api_version: "n/a"
status: stable
dependencies: []
last_reviewed: 2026-03-12
security_impact: low
---

# Owners Registry

This file defines valid team identifiers for the `owner` frontmatter field.

## Purpose

The `owner` field in document frontmatter identifies which team is responsible
for keeping a document current. Using values from this registry ensures
consistent analytics grouping and prevents fragmented ownership data in
coverage reports.

Using `payments-eng`, `Payments Eng`, and `payments_eng` all pass frontmatter
validation but produce three distinct buckets in the analytics report. This
registry is the canonical source of truth for ownership identifiers.

## Registered Owners

Update this list to match your organization's team structure before adopting
RepoDocs AI across multiple service repositories.

| Owner Identifier | Team Description |
| --- | --- |
| `docs-platform` | Documentation platform and tooling |
| `platform-team` | Core platform and infrastructure |
| `payments-eng` | Payments service engineering |
| `fraud-team` | Fraud and risk engineering |
| `customers-eng` | Customer management engineering |
| `notifications-team` | Notifications and webhooks engineering |
| `security-team` | Security and compliance |
| `architecture-team` | Systems and integration architecture |
| `platform-infra` | Platform infrastructure and operations |

## Usage

Set the `owner` field in frontmatter to one of the identifiers above:

```yaml
owner: "payments-eng"
```

## Governance

- Add new identifiers when a new team is formed.
- Remove or reassign identifiers when teams are reorganized.
- The analytics report groups documents by `owner` — consistent identifiers
  are required for accurate per-team coverage reporting.
- See `CODEOWNERS` for the mapping from documentation paths to GitHub review
  assignments.
