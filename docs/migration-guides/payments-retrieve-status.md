---
title: "Payments Retrieve Status Migration Guide"
description: "Migration guidance from the legacy retrieve endpoint to the status endpoint"
service: "payments-platform"
component: "migration-guide"
owner: "platform-docs"
api_version: "v1"
status: stable
dependencies:
  - examples/openapi/payments-openapi.yaml
  - examples/api-docs/payments-retrieve-payment.md
last_reviewed: 2026-03-11
security_impact: medium
---

# Payments Retrieve Status Migration Guide

## Why This Change Exists

`GET /payments/{payment_id}` mixed status retrieval with broader payment payload details. `GET /payments/{payment_id}/status` narrows the contract to the lifecycle status fields used by dashboards, polling clients, and notifications workflows.

## Deprecated And Replacement Operations

- Deprecated: `GET /payments/{payment_id}`
- Replacement: `GET /payments/{payment_id}/status`
- Deprecated since: `v1`
- Sunset target: `v2`

## Migration Steps

1. Update polling and dashboard integrations to call `GET /payments/{payment_id}/status`.
2. Remove any dependence on the legacy endpoint returning full payment payload fields.
3. Validate the new response model for `payment_id`, `status`, and `last_updated`.
4. Re-run RepoDocs AI validation after documentation and client updates.

## Validation Checklist

- Deprecation notice added to endpoint docs
- Migration section points to the replacement endpoint
- Source OpenAPI spec includes `deprecated`, `x-sunset-version`, and replacement metadata
- Client runbooks reference the replacement endpoint before `v2`