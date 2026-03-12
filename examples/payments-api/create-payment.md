---
title: "Create Payment"
description: "Endpoint documentation for creating a new payment"
service: "startup-payments"
component: "endpoint"
owner: "platform-docs"
api_version: "v1"
status: stable
dependencies:
  - auth-service
  - ledger-service
last_reviewed: 2026-03-12
reviewed_by: "docs-platform"
security_impact: high
---

# Endpoint: Create Payment

## Summary

Create a payment for a customer checkout session.

## Endpoint

- Method: `POST`
- URL: `/payments`

## Authentication Requirements

Bearer authentication is required.

See `authentication.md` for token handling and scope guidance.

## Parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| None | n/a | no | No path or query parameters are defined |

## Request Body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| amount | number | yes | Payment amount in major currency units |
| currency | string | yes | ISO 4217 currency code |
| customer_id | string | yes | Unique customer identifier |
| payment_method_id | string | no | Saved payment method identifier |

## Request Example

```bash
curl -X POST "https://api.startup-payments.example/v1/payments" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"amount":125.5,"currency":"USD","customer_id":"cus_123","payment_method_id":"pm_123"}'
```

## Response Example

```json
{
  "payment_id": "pay_123",
  "status": "pending",
  "amount": 125.5,
  "currency": "USD"
}
```

## Error Codes

| Code | Description |
| --- | --- |
| 400 | Invalid payment request |
| 401 | Unauthorized |
| 409 | Duplicate payment submission |

See `error-handling.md` for the shared error envelope used across the API.

## Idempotency

Clients should send an `Idempotency-Key` header on create requests.

See `idempotency.md` for retry behavior and key-reuse rules.

## Performance Notes

Monitor this endpoint for latency spikes and duplicate-submission retries during peak checkout traffic.