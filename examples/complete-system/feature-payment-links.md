---
title: "Payment Links Feature"
description: "Feature-level document for the complete-system example"
service: "payments-platform"
component: "payment-links"
owner: "product-docs"
api_version: "n/a"
status: beta
dependencies:
  - checkout-service
  - notifications-service
last_reviewed: 2026-03-11
security_impact: medium
---

# Feature: Payment Links

## Problem Statement

Merchants need a fast payment collection option when a custom checkout flow is not available.

## Feature Summary

Payment Links allows operators to generate branded payment URLs with predefined payment settings and lifecycle controls.

## Architecture Overview

The feature relies on the payments API, checkout service, and notifications service to generate links, host payment pages, and notify customers.

## Workflow

An operator creates a payment link, shares it with a customer, and tracks status changes from the merchant dashboard.

## Dependencies

- payments API
- checkout service
- notifications service
- merchant dashboard

## Configuration

Teams can configure expiry windows, payment methods, and brand presentation rules.

## Known Limitations

Partial payments and multi-use links are not supported in this example release.