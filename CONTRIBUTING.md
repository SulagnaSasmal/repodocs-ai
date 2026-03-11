# Contributing

Thank you for contributing to RepoDocs AI.

## What Contributions Are Useful

The highest-value contributions improve one of these areas:

- template clarity and completeness
- prompt quality and AI workflow guidance
- example documentation systems
- validation accuracy and developer trust
- installation flow, onboarding, and product positioning

## Before You Start

1. Read the top-level [README.md](README.md).
2. Review the relevant folder before making changes.
3. Prefer focused pull requests over broad repository-wide edits.

## Repository Conventions

- keep changes small and purpose-specific
- preserve existing naming and folder boundaries
- update examples or docs when behavior changes
- avoid unrelated refactors in the same change
- prefer Markdown assets that are easy to scan and validate

## Local Validation

Run this before opening a pull request:

```bash
npm install
npm run validate
```

If you change site pages or example systems, verify that the docs still read clearly for a first-time visitor.

## Pull Request Guidance

Include:

- what changed
- why it changed
- how you validated it
- any screenshots or rendered examples if you changed site pages

Good pull requests usually update the smallest set of files needed to solve a clear problem.

## Content Guidance

When editing templates, prompts, or examples:

- optimize for clarity over cleverness
- mark missing domain-specific details as `Needs SME input`
- do not invent API fields or product behavior
- keep examples realistic and internally consistent

## Questions and Proposals

If you want to propose larger structural changes, open an issue or a draft pull request first so the architecture direction stays coherent.