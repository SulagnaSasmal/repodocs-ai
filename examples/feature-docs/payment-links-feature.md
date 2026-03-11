---
title: "Payment Links Feature"
description: "Example feature document using RepoDocs AI"
service: "payments-platform"
component: "payment-links"
owner: "product-docs"
api_version: "n/a"
status: beta
dependencies:
  - notifications-service
  - checkout-service
last_reviewed: 2026-03-11
security_impact: medium
---

# Feature: Payment Links

## Problem Statement

Merchants need a fast way to collect payments without building a custom checkout flow.

## Feature Summary

Payment Links lets users generate shareable payment URLs tied to predefined amount, currency, and expiry settings.

## Architecture Overview

The feature depends on the checkout service for hosted payment pages and the notifications service for customer messaging.

## Workflow

An operator creates a payment link, shares it with a customer, and tracks completion status from the dashboard.

## Dependencies

- checkout-service
- notifications-service
- merchant dashboard

## Configuration

Teams can configure expiry window, allowed payment methods, and branding options.

## Known Limitations

Partial payments and multi-use links are not supported in this version.