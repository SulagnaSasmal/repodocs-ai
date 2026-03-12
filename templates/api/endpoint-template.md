---
title: "Endpoint Template"
description: "Reusable endpoint-level API documentation template"
service: "" # e.g. payments-api, fraud-service, customer-service
component: "endpoint"
owner: "" # e.g. platform-team, payments-eng, docs-team
api_version: "v1"
status: draft
dependencies: [] # e.g. [auth-service, ledger-service]
last_reviewed: 2026-03-11
security_impact: medium
---

# Endpoint: {endpoint-name}

## Summary

Briefly describe what the endpoint does and when it should be used.

## Endpoint

- Method: `GET|POST|PUT|PATCH|DELETE`
- URL: `/path`

## Authentication Requirements

Describe required credentials, scopes, or roles.

## Path Parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| example_id | string | yes | Replace with actual path parameter details, or say `No path parameters` |

## Query Parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| example | string | no | Replace with actual query parameter details, or say `No query parameters` |

## Request Body

| Field | Type | Required | Description |
| --- | --- | --- | --- |
| example_field | string | yes | Replace with actual request body details, or say `No request body` |

## Request Example

```bash
curl -X GET "https://api.example.com/path" \
  -H "Authorization: Bearer <token>"
```

## Response Example

```json
{
  "status": "success"
}
```

## Error Codes

| Code | Description |
| --- | --- |
| 400 | Invalid request |
| 401 | Authentication failed |
| 500 | Unexpected server error |

## Performance Notes

Document rate limits, maximum payload sizes, or latency targets for this endpoint. Leave blank if not applicable.

Example: This endpoint is rate-limited to 100 requests per minute per API key. Maximum payload size is 1 MB. P99 latency target is under 500 ms.