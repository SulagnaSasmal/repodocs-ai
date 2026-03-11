---
title: "Retrieve Payment"
description: "Endpoint example for retrieving a payment in the complete-system sample"
service: "payments-platform"
component: "endpoint"
owner: "platform-docs"
api_version: "v1"
status: deprecated
dependencies:
  - auth-service
  - ledger-service
last_reviewed: 2026-03-11
security_impact: high
deprecated_since: "v1"
sunset_version: "v2"
replaced_by: "GET /payments/{payment_id}/status"
migration_guide: "docs/migration-guides/payments-retrieve-status.md"
---

# Endpoint: Retrieve Payment

## Summary

Fetch the current state of a payment by identifier.

This legacy endpoint remains available for compatibility but should not be used for new integrations.

## Endpoint

- Method: `GET`
- URL: `/payments/{payment_id}`

## Authentication Requirements

Bearer authentication is required.

## Parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| payment_id | string | yes | Unique payment identifier |

## Request Example

```bash
curl -X GET "https://api.example.com/payments/v1/payments/pay_123" \
  -H "Authorization: Bearer <token>"
```

## Response Example

```json
{
  "payment_id": "pay_123",
  "status": "completed",
  "amount": 125.5
}
```

## Error Codes

| Code | Description |
| --- | --- |
| 404 | Payment not found |

## Performance Notes

Read operations should stay low latency to support dashboard refresh patterns.

## Deprecation

This endpoint was deprecated in v1 and is scheduled to sunset in v2.

## Migration

Move clients to `GET /payments/{payment_id}/status`.

Migration guide: `docs/migration-guides/payments-retrieve-status.md`.