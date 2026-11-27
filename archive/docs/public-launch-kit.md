---
unlisted: true
---

# Public Launch Kit

This document turns the remaining pre-launch items into concrete actions.

## 1. GitHub Pages Fix

This part still requires manual action in GitHub repository settings. It can't be completed from the local repository alone.

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

This is the missing public trust layer. The goal isn't broad marketing first. The goal is credible feedback from developers and technical writers who weren't involved in building the repo.

## 2.5 GitHub About Alignment

Align the repository About box with the README headline so the first public summary doesn't drift.

### What to change in GitHub

1. Open the repository homepage on GitHub.
2. In the About box on the right, click the gear icon or Edit.
3. Set the description to `AI-prompt-powered docs-as-code documentation system for SaaS API teams`.
4. Keep the website as `https://sulagnasasmal.github.io/repodocs-ai/`.
5. Save the change.

### Why this matters

The current README headline uses `AI-prompt-powered`, but the About box can drift over time because it's edited in GitHub settings. Keeping them aligned reduces message confusion on the repo homepage.

### Recommended launch-day sequence

1. Pin a GitHub Discussion in the repository asking for first-impression feedback.
2. Post in Write the Docs Slack with a specific feedback ask.
3. Publish a short dev.to launch post pointing readers to the repo, live site, and discussion thread.

## 3. GitHub Discussion Copy

Use the exact content in `docs/community-feedback-discussion.md`.

## 4. Outreach Posts

### Write the Docs Slack

```text
Hi all — I just opened RepoDocs AI for public feedback.

RepoDocs AI is a repo-native documentation system for API teams: reusable templates, structured AI prompts, validation scripts, and OpenAPI-driven generation, with a full payments API example so the output does not feel hypothetical.

I am not looking for generic launch reactions. I want blunt first-impression feedback from people who write, edit, or review technical docs.

If you have 10 minutes, I would especially value feedback on:
- whether the README makes the product clear quickly
- whether the payments example feels credible
- whether the install and proof path feel usable without a guided walkthrough

Repo: https://github.com/SulagnaSasmal/repodocs-ai
Site: https://sulagnasasmal.github.io/repodocs-ai/
Discussion: https://github.com/SulagnaSasmal/repodocs-ai/discussions
Issue form for real-spec output: https://github.com/SulagnaSasmal/repodocs-ai/issues/new/choose
```

### Developer Community

```text
I just opened RepoDocs AI for feedback.

It is a repo-native documentation system for API teams that combines reusable templates, structured AI prompts, validation scripts, and OpenAPI-driven generation. I included a full payments API example and an end-to-end proof path so the workflow can be tested instead of just described.

If you work on API docs, developer docs, or docs-as-code systems, I would value blunt feedback on whether this feels understandable and credible from the repo alone.

Repo: https://github.com/SulagnaSasmal/repodocs-ai
Site: https://sulagnasasmal.github.io/repodocs-ai/
Discussion: https://github.com/SulagnaSasmal/repodocs-ai/discussions
```

### Reddit or LinkedIn Post for Documentation Teams

```text
I am looking for direct feedback on RepoDocs AI from people who own API documentation workflows.

RepoDocs AI is an open-source, repo-native system for generating, reviewing, and validating docs from templates, prompts, and OpenAPI specs. The trust anchor is a full payments API example plus a proof path that boots a docs repo, generates docs, validates them, and exports artifacts end to end.

If you evaluate API docs tooling, I would like to know three things: what was clear immediately, what felt weak or confusing, and what still blocks you from trying this on a real spec.

Repo: https://github.com/SulagnaSasmal/repodocs-ai
Site: https://sulagnasasmal.github.io/repodocs-ai/
Discussion: https://github.com/SulagnaSasmal/repodocs-ai/discussions
```

## 5. Launch Notes

Use the Discussion thread as the primary feedback inbox.
Use the `Docs Generated From My Spec` issue form for structured real-spec reports.
Use the design-partner intake for teams that signal urgency, follow-up interest, or implementation help.

## 6. Commit History Guidance

Don't run `git rebase -i --root` on `main` now unless you intentionally want to rewrite already-public history and coordinate a force-push.

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

That's feasible, but it's a destructive public-history change and shouldn't be done casually.

### Suggested message upgrades for the first seven commits

If you decide to rewrite anyway, these are stronger audit-driven versions of the earliest messages:

1. `Initialize RepoDocs AI trust and installation surface`
2. `Resolve developer adoption blockers in README and onboarding path`
3. `Polish first-run developer experience and local evaluation flow`
4. `Add governance guardrails for code review and repository ownership`
5. `Close remaining governance and release-readiness gaps`
6. `Harden AI review reliability and output validation`
7. `Align templates, examples, and enforcement with audit findings`