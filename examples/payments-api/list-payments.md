---
title: "List Payments"
description: "Return a paginated list of payments filtered by status, customer, or date range"
service: "payments-api"
component: "endpoint"
owner: "payments-eng"
api_version: "v1"
status: stable
dependencies: ["auth-service"]
last_reviewed: 2026-03-12
reviewed_by: "docs-platform"
security_impact: low
---

# Endpoint: List Payments

## Summary

Returns a paginated list of payment records. Supports filtering by lifecycle
status, customer identifier, and creation date range. Use this endpoint to
build dashboards, generate reports, or audit payment activity.

## Endpoint

- Method: `GET`
- URL: `/payments`

## Authentication Requirements

Bearer authentication is required.

All tokens must include the `payments:read` scope. Tokens scoped to a specific
customer return only that customer's payments regardless of the `customer_id`
filter.

See `authentication.md` for token handling and scope guidance.

## Path Parameters

Not applicable.

## Query Parameters

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `status` | string | no | Filter by lifecycle status. One of: `pending`, `completed`, `failed`, `refunded` |
| `customer_id` | string | no | Return only payments belonging to this customer identifier |
| `from_date` | string (ISO 8601 date) | no | Return payments created on or after this date. Format: `YYYY-MM-DD` |
| `to_date` | string (ISO 8601 date) | no | Return payments created on or before this date. Format: `YYYY-MM-DD` |
| `page` | integer | no | Page number. Minimum: 1. Default: 1 |
| `per_page` | integer | no | Results per page. Minimum: 1, maximum: 100. Default: 20 |

## Request Body

Not applicable.

## Request Example

```bash
curl -X GET "https://api.example.com/payments/v1/payments?status=completed&customer_id=cus_123&from_date=2026-01-01&page=1&per_page=20" \
  -H "Authorization: Bearer <token>"
```

## Response Example

```json
{
  "data": [
    {
      "payment_id": "pay_456",
      "status": "completed",
      "amount": 250.00,
      "currency": "USD",
      "customer_id": "cus_123",
      "created_at": "2026-03-10T08:45:00Z"
    },
    {
      "payment_id": "pay_123",
      "status": "completed",
      "amount": 125.50,
      "currency": "USD",
      "customer_id": "cus_123",
      "created_at": "2026-03-11T10:00:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "per_page": 20,
    "total": 2,
    "total_pages": 1
  }
}
```

## Error Codes

| Code | Name | Description |
| --- | --- | --- |
| 400 | Bad Request | One or more query parameters are invalid. Check `from_date`/`to_date` format and `per_page` bounds |
| 401 | Unauthorized | Missing or expired bearer token |

## Performance Notes

This endpoint is rate-limited to 60 requests per minute per API key. For large
exports, use `per_page=100` and paginate through results using the
`pagination.total_pages` value rather than making parallel requests. Date range
queries spanning more than 90 days may have higher latency.
