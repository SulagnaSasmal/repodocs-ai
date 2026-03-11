---
title: "Retrieve Payment"
description: "Endpoint documentation for retrieving a payment"
service: "startup-payments"
component: "endpoint"
owner: "platform-docs"
api_version: "v1"
status: stable
dependencies:
  - auth-service
  - ledger-service
last_reviewed: 2026-03-12
security_impact: high
---

# Endpoint: Retrieve Payment

## Summary

Retrieve the current state and metadata for a payment.

## Endpoint

- Method: `GET`
- URL: `/payments/{id}`

## Authentication Requirements

Bearer authentication is required.

See `authentication.md` for token handling and scope guidance.

## Parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| id | string | yes | Unique payment identifier |

## Request Body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| None | n/a | no | No request body |

## Request Example

```bash
curl -X GET "https://api.startup-payments.example/v1/payments/pay_123" \
  -H "Authorization: Bearer <token>"
```

## Response Example

```json
{
  "payment_id": "pay_123",
  "status": "completed",
  "amount": 125.5,
  "currency": "USD"
}
```

## Error Codes

| Code | Description |
| --- | --- |
| 401 | Unauthorized |
| 404 | Payment not found |

See `error-handling.md` for the shared error envelope used across the API.

## Related Async Flow

Polling is useful for some clients, but production integrations often pair this endpoint with webhook delivery.

See `webhooks.md` for payment lifecycle events.

## Performance Notes

This endpoint should remain low latency for status polling and internal support tooling.