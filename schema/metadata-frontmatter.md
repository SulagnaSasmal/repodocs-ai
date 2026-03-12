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

## Optional Governance Fields

Use these to support enterprise review workflows and publication routing.

```yaml
reviewed_by: "engineer-name"
audience: internal
sla: "Update within 5 business days of API change"
```

| Field | Meaning |
| --- | --- |
| `reviewed_by` | Name or identifier of the person who approved the document |
| `audience` | Publication target: `internal`, `external`, or `both` |
| `sla` | Update frequency or response SLA for high-velocity endpoints |

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
- Use owner identifiers from `schema/owners-registry.md` — free-form strings fragment analytics reports.
- Update `last_reviewed` whenever a subject matter expert approves the document.
- Set `reviewed_by` to the approver's identifier before merging a documentation PR.
- Treat `security_impact` as a trigger for deeper review, not a compliance label.
- If `status` is `deprecated`, include `Deprecation` and `Migration` sections in the body.
- Set `audience` to control which export pipelines receive the document (`internal` → Confluence, `external` → developer portal, `both` → all pipelines).