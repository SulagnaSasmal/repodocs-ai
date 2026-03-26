---
unlisted: true
---

# RepoDocs AI Developer Experience Scorecard

## Purpose

This scorecard is the simplest external usability test for RepoDocs AI.

Give a tester only:

- the repository link
- the README

Then ask them to rate the product before any guided walkthrough.

## Test Instructions

Ask at least 3 developers or technical writers to review the repo.

Each tester should answer these questions:

1. Do you understand what RepoDocs AI is within 2 minutes?
2. Do you know how to start using it without reading the full spec?
3. Does the payments example make the output feel real?
4. Do the AI prompts feel useful rather than theoretical?

## Scorecard

### Author Self-Assessment — March 2026

Tester: Sulagna Sasmal (author, Senior Technical Writer)
Method: Reviewed README and examples as if encountering the repo for the first time, without reading the specification documents.

| Category | Score (1-10) | Notes |
| --- | --- | --- |
| Clarity | 8 | The problem/solution/example/quickstart flow in the README communicates the product purpose clearly. The payments example is the strongest trust signal. Score held back from 9 because the control plane section in the README adds cognitive load before a new user is ready for it. |
| Ease of use | 7 | The bootstrap command works. The Windows PowerShell path is explicitly covered, which is unusual and appreciated. Score held back because the relationship between the tool itself and the docs repo you create with it is not immediately obvious on first read. |
| Documentation quality | 9 | The template packs, prompt library, and payments example are internally consistent and meet the structural standard they describe. The validation suite passes cleanly. |
| AI usefulness | 7 | The prompts are concrete and workflow-specific rather than generic. Score held back because the live AI path requires an API key that most first-time evaluators will not have ready, and the no-key fallback is not prominent enough in the README. |

**Average: 7.75 — above the 7.0 pass threshold.**

### Community Assessments

Have you evaluated RepoDocs AI? Open a [GitHub Discussion](https://github.com/SulagnaSasmal/repodocs-ai/discussions) and share your scores. Results added here as they come in.

## Pass Threshold

If the average score across testers is 7 or higher, the product is usable.

If the score is below 7, use the notes to simplify:

- the README
- the Quick Start
- the payments example
- the prompt instructions

## Suggested Test Prompt

Send testers this message:

"Please review the RepoDocs AI repository using only the repo link and README. Rate clarity, ease of use, documentation quality, and AI usefulness from 1 to 10. Then tell me what confused you, what made you trust it, and whether you would install it."

## Interpreting Results

Strong signs of product readiness:

- testers understand the product quickly
- testers can find the Quick Start without guidance
- testers mention the payments example as proof
- testers would try it without first reading the full specification

Weak signs that it is still a prototype:

- testers say they need the spec to understand the repo
- testers cannot tell where to start
- testers see templates but not a believable finished output
- testers do not understand how the AI prompts fit into the workflow