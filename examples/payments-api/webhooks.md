---
title: "Payments API Webhooks"
description: "Webhook delivery model and sample events for the payments platform"
service: "startup-payments"
component: "api-support"
owner: "platform-docs"
api_version: "v1"
status: stable
dependencies:
  - api-overview.md
  - retrieve-payment.md
last_reviewed: 2026-03-12
reviewed_by: "docs-platform"
security_impact: high
---

# Webhooks

## Overview

The Payments API can notify downstream systems when payment state changes asynchronously.

## Delivery Model

- events are delivered with `POST` requests to a customer-configured HTTPS endpoint
- deliveries should be signed and timestamped
- receivers should acknowledge successful processing with a `2xx` response
- non-`2xx` responses should trigger retries with backoff

## Example Events

| Event | Description |
| --- | --- |
| `payment.created` | A payment record was accepted for processing |
| `payment.completed` | A payment settled successfully |
| `payment.failed` | A payment attempt failed permanently |
| `payment.refunded` | A refund was created for an existing payment |

## Example Payload

```json
{
  "id": "evt_123",
  "type": "payment.completed",
  "created": "2026-03-12T11:42:00Z",
  "data": {
    "payment_id": "pay_123",
    "status": "completed",
    "amount": 125.5,
    "currency": "USD"
  }
}
```

## Signature Verification

Production webhook docs should describe:

- which signature header is sent
- how to compute the expected signature
- replay-window rules
- how to rotate webhook secrets

## Documentation Guidance

Webhook docs are part of the trust story for payment platforms because they show how asynchronous integrations actually work beyond request-response endpoints.