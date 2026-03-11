---
title: "Payments API Error Handling"
description: "Structured error model for the payments platform sample"
service: "startup-payments"
component: "api-support"
owner: "platform-docs"
api_version: "v1"
status: stable
dependencies:
  - api-overview.md
  - create-payment.md
  - retrieve-payment.md
  - refund-payment.md
last_reviewed: 2026-03-12
security_impact: medium
---

# Error Handling

## Overview

The Payments API returns standard HTTP status codes plus a structured JSON error body.

## Error Shape

```json
{
  "error": {
    "code": "duplicate_payment",
    "message": "A payment with this idempotency key already exists.",
    "trace_id": "trace_9f0e7c",
    "docs_url": "https://docs.startup-payments.example/errors#duplicate_payment"
  }
}
```

## Common Status Codes

| Status | Meaning | Typical Cause |
| --- | --- | --- |
| 400 | Bad Request | Invalid JSON, missing fields, unsupported currency |
| 401 | Unauthorized | Missing or invalid bearer token |
| 404 | Not Found | Payment or refund target does not exist |
| 409 | Conflict | Duplicate create or conflicting refund request |
| 422 | Unprocessable Entity | Business-rule failure such as refund amount too large |
| 429 | Too Many Requests | Client exceeded rate limit |
| 500 | Internal Server Error | Unexpected platform failure |

## Documentation Guidance

Endpoint docs should list operation-specific error codes, while this page defines the shared error model and envelope.

## Production Notes

Teams should document stable machine-readable error codes first. Human-readable messages may evolve, but error codes must remain predictable for client integrations.