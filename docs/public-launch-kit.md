# Public Launch Kit

This document turns the remaining pre-launch items into concrete actions.

## 1. GitHub Pages Fix

This part still requires manual action in GitHub repository settings. It cannot be completed from the local repository alone.

### What to do in GitHub

1. Open the repository on GitHub.
2. Go to Settings > Pages.
3. Under Build and deployment, set Source to GitHub Actions.
4. Save the setting.
5. Go to Actions > Deploy Site.
6. Re-run the latest workflow or use Run workflow.

### Why this is needed

The repository already has a valid Pages workflow in `.github/workflows/deploy-site.yml` using `actions/configure-pages`, `actions/upload-pages-artifact`, and `actions/deploy-pages`.

If Pages is still configured to deploy from a branch instead of GitHub Actions, the workflow can exist and still not publish correctly.

### Expected result

After the setting is changed and the workflow runs successfully, the site should publish at:

- `https://sulagnasasmal.github.io/repodocs-ai/`

## 2. External Validation Plan

This is the missing public trust layer. The goal is not broad marketing first. The goal is credible feedback from developers and technical writers who were not involved in building the repo.

### Recommended launch-day sequence

1. Pin a GitHub Discussion in the repository asking for first-impression feedback.
2. Post in Write the Docs Slack with a specific feedback ask.
3. Publish a short dev.to launch post pointing readers to the repo, live site, and discussion thread.

## 3. GitHub Discussion Copy

Suggested title:

`RepoDocs AI launch feedback: can you review the repo in 10 minutes?`

Suggested body:

```md
I am opening RepoDocs AI for public feedback.

RepoDocs AI is an AI-prompt-powered docs-as-code system for SaaS API teams. It includes:

- reusable Markdown template packs
- structured prompts for generation and review
- validation scripts for trust and consistency
- a full payments API example
- a live GitHub Pages site

What I want to learn:

1. Can you understand what the product is within 2 minutes?
2. Can you find the Quick Start without help?
3. Does the payments example make the repo feel real and trustworthy?
4. Would you try this in a real docs workflow?

Please review using only:

- the README
- the live site
- the payments example

Repo: https://github.com/SulagnaSasmal/repodocs-ai
Site: https://sulagnasasmal.github.io/repodocs-ai/

If possible, leave:

- one thing that was immediately clear
- one thing that was confusing
- one thing that made you trust or distrust it
- a score from 1 to 10 for clarity and usability
```

Suggested pin note:

`Pinned for launch-week feedback. First-impression reviews are especially useful.`

## 4. Write the Docs Slack Copy

Suggested short post:

```text
Hi all — I just opened RepoDocs AI for feedback.

It is an AI-prompt-powered docs-as-code system for SaaS API teams: reusable templates, structured prompts, validation scripts, and a full payments API example.

I am not looking for generic launch likes — I want first-impression feedback from people who write or review technical documentation.

If you have 10 minutes, I would love feedback on:
- whether the README makes the product clear quickly
- whether the payments example feels credible
- whether the workflow feels genuinely usable

Repo: https://github.com/SulagnaSasmal/repodocs-ai
Site: https://sulagnasasmal.github.io/repodocs-ai/
Discussion thread: https://github.com/SulagnaSasmal/repodocs-ai/discussions
```

Suggested follow-up if someone asks what to review:

```text
The fastest trust check is:
1. README
2. payments example under examples/payments-api/
3. live site quickstart

I am mainly trying to learn whether the product is understandable and credible without a guided walkthrough.
```

## 5. dev.to Launch Draft

Suggested title:

`I built RepoDocs AI: a docs-as-code system for SaaS API teams`

Suggested draft:

```md
# I built RepoDocs AI: a docs-as-code system for SaaS API teams

Most SaaS teams still document APIs with some combination of scattered Markdown, inconsistent structure, and AI-generated drafts that are hard to trust.

I built RepoDocs AI to make that workflow more disciplined.

It is an AI-prompt-powered docs-as-code system that includes:

- reusable documentation templates
- structured prompts for AI drafting and review
- validation scripts for quality and structure
- a complete payments API example
- a GitHub-native workflow for versioned documentation

The goal is simple: documentation should be fast to produce, but still structured enough to trust.

## What is in the repo

- API, feature, operations, product, and architecture templates
- prompt packs for generation and review
- validation scripts for frontmatter, structure, and documentation quality
- OpenAPI-driven generation for endpoint documentation
- a payments API trust-proof example

## What I wanted to solve

I was trying to close the gap between two bad states:

1. manually written docs that drift and become inconsistent
2. low-trust AI output that looks polished but invents details

RepoDocs AI sits in the middle: use AI for speed, but constrain it with templates, prompts, and validation.

## If you want to evaluate it quickly

Start here:

1. Read the README
2. Review the payments example
3. Check the live site

Repo: https://github.com/SulagnaSasmal/repodocs-ai
Site: https://sulagnasasmal.github.io/repodocs-ai/

## What feedback would help most

If you work in engineering, developer documentation, or technical writing, I would value direct feedback on:

- clarity of the README
- credibility of the example docs
- usefulness of the prompts and validation workflow
- whether this feels like a real starting point for a documentation repository
```

## 6. Commit History Guidance

Do not run `git rebase -i --root` on `main` now unless you intentionally want to rewrite already-public history and coordinate a force-push.

That recommendation only made sense before the first public push. The repository has already been pushed publicly multiple times.

### Safe recommendation

Leave the existing public history in place and use:

- `CHANGELOG.md` for release narrative
- GitHub Releases for the public version story
- a launch post or pinned discussion for the project story

### If you still want rewritten history

Treat it as a separate, deliberate operation:

1. Freeze all other pushes.
2. Rewrite history on a temporary branch.
3. Verify every commit and workflow state.
4. Force-push with `--force-with-lease`.
5. Notify anyone who has already cloned the repository.

That is feasible, but it is a destructive public-history change and should not be done casually.

### Suggested message upgrades for the first seven commits

If you decide to rewrite anyway, these are stronger audit-driven versions of the earliest messages:

1. `Initialize RepoDocs AI trust and installation surface`
2. `Resolve developer adoption blockers in README and onboarding path`
3. `Polish first-run developer experience and local evaluation flow`
4. `Add governance guardrails for code review and repository ownership`
5. `Close remaining governance and release-readiness gaps`
6. `Harden AI review reliability and output validation`
7. `Align templates, examples, and enforcement with audit findings`