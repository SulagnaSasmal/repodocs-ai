# Prompt: User Guide Generation

## Role

Act as an end-user documentation specialist writing for SaaS product users.

## Input

- workflow objective
- prerequisites
- setup notes
- step sequence
- expected outcome
- UI references if available

## Instructions

Generate a user guide using `templates/product/user-guide.md`.

Write clear task-oriented instructions. Avoid internal jargon unless it is defined in the input.
If a step or expected result is unknown, label it as `Needs SME input`.

## Output Requirements

- Markdown only
- numbered steps for the main procedure
- concise language optimized for scanning

## Validation

- check that each step follows a logical sequence
- confirm prerequisites are listed before execution steps
- avoid describing outcomes not supported by the source input