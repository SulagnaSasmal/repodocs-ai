---
title: "Payments API Idempotency"
description: "Idempotency guidance for payment creation and refund workflows"
service: "startup-payments"
component: "api-support"
owner: "platform-docs"
api_version: "v1"
status: stable
dependencies:
  - create-payment.md
  - refund-payment.md
last_reviewed: 2026-03-12
reviewed_by: "docs-platform"
security_impact: medium
---

# Idempotency

## Why It Matters

Payment creation and refund operations must be safe against retries caused by client timeouts, network failures, or repeated submissions.

## Header

Clients should send an `Idempotency-Key` header for all `POST /payments` and `POST /payments/refund` requests.

```bash
curl -X POST "https://api.startup-payments.example/v1/payments" \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -H "Idempotency-Key: 3d8f7d89-a0c5-4f54-97f2-3a4ef83da3b4" \
  -d '{"amount":125.5,"currency":"USD","customer_id":"cus_123"}'
```

## Expected Behavior

- the first valid request creates the resource
- repeated requests with the same idempotency key return the original result
- reusing a key with a different payload should return a conflict error

## Retention Window

This sample assumes keys are retained for 24 hours. Production systems should document the exact retention policy.

## Documentation Guidance

If an endpoint depends on idempotency for correctness, call it out explicitly in the endpoint doc and in any SDK examples.