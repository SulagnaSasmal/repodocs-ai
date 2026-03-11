# Metadata Frontmatter Schema

All documentation files should begin with YAML frontmatter.

## Required Fields

```yaml
---
title: ""
description: ""
service: ""
component: ""
owner: ""
api_version: ""
status: draft
dependencies: []
last_reviewed: YYYY-MM-DD
security_impact: low
---
```

## Field Definitions

| Field | Meaning |
| --- | --- |
| `title` | Document title |
| `description` | Short summary of the document |
| `service` | Product, service, or domain area |
| `component` | Specific module or subsystem |
| `owner` | Team or role responsible for maintenance |
| `api_version` | API or interface version covered by the document |
| `status` | `draft`, `beta`, `stable`, or `deprecated` |
| `dependencies` | Related systems or supporting services |
| `last_reviewed` | Most recent review date |
| `security_impact` | `low`, `medium`, or `high` |

## Optional Lifecycle Fields

Use these when a document describes deprecated interfaces or migration paths.

```yaml
deprecated_since: "v1"
sunset_version: "v2"
replaced_by: "GET /payments/{payment_id}/status"
migration_guide: "docs/migration-guides/payments-retrieve-status.md"
```

| Field | Meaning |
| --- | --- |
| `deprecated_since` | Version when the endpoint or interface entered deprecation |
| `sunset_version` | Target version where the deprecated surface will be removed |
| `replaced_by` | Successor operation, service, or workflow |
| `migration_guide` | Repository path to the canonical migration guidance |

## Usage Notes

- Use consistent service and component names across repositories.
- Update `last_reviewed` whenever a subject matter expert approves the document.
- Treat `security_impact` as a trigger for deeper review, not a compliance label.
- If `status` is `deprecated`, include `Deprecation` and `Migration` sections in the body.