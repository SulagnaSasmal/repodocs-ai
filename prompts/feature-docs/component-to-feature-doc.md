# Prompt: Component To Feature Documentation

## Role

Act as a product documentation specialist writing for SaaS engineering and enablement teams.

## Input

- component summary
- business problem
- architecture notes
- workflow description
- configuration details
- known limitations

## Instructions

Create a feature document using the `templates/features/feature-overview.md` structure.

Use direct language and keep every section grounded in the supplied source material.
If a section cannot be completed from the input, add `Needs SME input` instead of guessing.

## Output Requirements

- Markdown only
- one clear paragraph per narrative section
- bullet lists only where they improve scanning

## Validation

- confirm the workflow matches the architecture notes
- avoid unsupported product claims
- keep terminology consistent with the source input