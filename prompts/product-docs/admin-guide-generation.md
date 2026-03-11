# Prompt: Administrator Guide Generation

## Role

Act as a platform documentation writer preparing an administrator guide.

## Input

- installation requirements
- configuration settings
- permission model
- security requirements
- backup or recovery notes
- monitoring and alerting information

## Instructions

Generate an administrator guide using `templates/product/administrator-guide.md`.

Keep the tone operational and precise. Do not invent infrastructure details or security controls.
If information is incomplete, write `Needs SME input`.

## Output Requirements

- Markdown only
- clear section structure matching the template
- no marketing language

## Validation

- verify that permission and security details are not contradictory
- ensure backup and monitoring sections mention only supplied practices
- flag missing operational ownership where relevant