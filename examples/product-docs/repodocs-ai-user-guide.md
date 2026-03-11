---
title: "RepoDocs AI Quickstart"
description: "Example user guide for adopting RepoDocs AI in a repository"
service: "repodocs-ai"
component: "quickstart"
owner: "docs-platform"
api_version: "n/a"
status: beta
dependencies:
  - github
  - markdown
last_reviewed: 2026-03-11
security_impact: low
---

# User Guide: RepoDocs AI Quickstart

## Prerequisites

- a GitHub repository with Markdown documentation
- a documentation owner or reviewer
- source material such as product notes or an OpenAPI spec

## Setup

Copy the required template files into the target repository and align frontmatter values with your service and ownership model.

## Step-by-Step Usage

1. Choose a template from the `templates/` directory based on the document type.
2. Copy the template into your target repository and update the frontmatter fields.
3. Use the matching prompt from `prompts/` with your source material to draft the document.
4. Review the draft against the checklists in `validation/`.
5. Submit the document through pull request review and request SME approval.

## Visual References

Add repository screenshots or docs-site screenshots if your team needs visual onboarding.

## Expected Results

The team produces a consistent Markdown document with clear ownership, structured sections, and reviewable AI-generated content.