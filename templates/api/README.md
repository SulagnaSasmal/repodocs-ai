---
title: "RepoDocs AI API Templates"
description: "Guide for using the API overview and endpoint templates together"
service: "repodocs-ai"
component: "api-templates"
owner: "product-docs"
api_version: "n/a"
status: stable
dependencies: []
last_reviewed: 2026-03-12
security_impact: low
---

# API Templates

## Purpose

This folder contains the core templates for documenting an API product.

## Files

- `api-overview.md` for the service-level API overview
- `endpoint-template.md` for one endpoint per file

## Recommended Workflow

1. Write one API overview for the service.
2. Create one endpoint document per operation.
3. Name endpoint files by user intent, such as `create-payment.md` or `refund-payment.md`.
4. Pair these templates with `prompts/api-generation/openapi-to-api-docs.md` when generating docs from OpenAPI.