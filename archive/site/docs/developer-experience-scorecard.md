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

| Category | Score (1-10) | Notes |
| --- | --- | --- |
| Clarity |  |  |
| Ease of use |  |  |
| Documentation quality |  |  |
| AI usefulness |  |  |

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