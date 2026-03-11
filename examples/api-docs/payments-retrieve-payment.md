---
title: "Retrieve Payment"
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

# Endpoint: Retrieve Payment

## Summary

Fetch the current state of a payment by identifier.

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