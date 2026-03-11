---
title: "Refund Payment"
description: "Endpoint documentation for issuing a refund"
service: "startup-payments"
component: "endpoint"
owner: "platform-docs"
api_version: "v1"
status: stable
dependencies:
  - auth-service
  - ledger-service
  - refunds-service
last_reviewed: 2026-03-12
security_impact: high
---

# Endpoint: Refund Payment

## Summary

Issue a refund against a completed payment.

## Endpoint

- Method: `POST`
- URL: `/payments/refund`

## Authentication Requirements

Bearer authentication is required.

## Parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| None | n/a | no | No path or query parameters are defined |

## Request Body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| payment_id | string | yes | Payment to refund |
| amount | number | yes | Refund amount in major currency units |
| reason | string | no | Optional human-readable refund reason |

## Request Example

```bash
curl -X POST "https://api.startup-payments.example/v1/payments/refund" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"payment_id":"pay_123","amount":25,"reason":"duplicate charge"}'
```

## Response Example

```json
{
  "refund_id": "ref_123",
  "payment_id": "pay_123",
  "status": "pending"
}
```

## Error Codes

| Code | Description |
| --- | --- |
| 400 | Invalid refund request |
| 401 | Unauthorized |
| 404 | Payment not found |

## Performance Notes

Refund submissions should be idempotent at the platform layer and monitored for duplicate reversal attempts.