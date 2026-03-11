---
title: "Payments API Authentication"
description: "Authentication guide for the payments platform sample"
service: "startup-payments"
component: "api-support"
owner: "platform-docs"
api_version: "v1"
status: stable
dependencies:
  - api-overview.md
last_reviewed: 2026-03-12
security_impact: high
---

# Authentication

## Overview

The Startup Payments API uses bearer token authentication for all server-to-server requests.

## How It Works

Clients send an access token in the `Authorization` header.

```bash
curl -X GET "https://api.startup-payments.example/v1/payments/pay_123" \
  -H "Authorization: Bearer <token>"
```

## Recommended Token Handling

- issue tokens per environment and client application
- rotate credentials regularly
- never expose secret tokens in browser-based flows
- store production credentials in a secret manager, not in source control

## Authorization Model

The sample assumes tokens are scoped by platform role.

Typical scopes include:

- `payments:create`
- `payments:read`
- `payments:refund`
- `webhooks:read`

## Failure Modes

Authentication failures should return `401 Unauthorized` with a structured error body that includes a stable error code and trace identifier.

## Production Notes

Teams adopting RepoDocs AI should replace the placeholder scope names and token issuance language with their actual IAM or API gateway model.