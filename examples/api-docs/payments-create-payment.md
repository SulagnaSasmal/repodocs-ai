---
title: "Create Payment"
description: "Example endpoint documentation aligned to the sample OpenAPI specification"
service: "payments-platform"
component: "endpoint"
owner: "platform-docs"
api_version: "v1"
status: stable
dependencies:
  - auth-service
  - ledger-service
last_reviewed: 2026-03-11
security_impact: high
---

# Endpoint: Create Payment

## Summary

Create a new payment record for checkout processing.

## Endpoint

- Method: `POST`
- URL: `/payments`

## Authentication Requirements

Bearer authentication is required.

## Parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| None | n/a | no | No path or query parameters defined |

## Request Example

```bash
curl -X POST "https://api.example.com/payments/v1/payments" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"amount":125.5,"currency":"USD","customer_id":"cus_123"}'
```

## Response Example

```json
{
  "payment_id": "pay_123",
  "status": "pending"
}
```

## Error Codes

| Code | Description |
| --- | --- |
| 400 | Invalid payment request |
| 401 | Unauthorized |

## Performance Notes

Create operations should be monitored for latency and duplicate-submission risk.