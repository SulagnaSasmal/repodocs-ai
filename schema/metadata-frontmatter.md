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

## Usage Notes

- Use consistent service and component names across repositories.
- Update `last_reviewed` whenever a subject matter expert approves the document.
- Treat `security_impact` as a trigger for deeper review, not a compliance label.