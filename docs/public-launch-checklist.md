---
unlisted: true
---

# RepoDocs AI Public Launch Checklist

Use this checklist to finish the last public-launch tasks that cannot be completed by code changes alone.

## Repository Settings

1. Open the repository on GitHub.
2. Go to Settings > Pages.
3. Under Build and deployment, set Source to GitHub Actions.
4. Save the setting.
5. Go to Actions and rerun the latest Deploy Site workflow if the site has not published automatically.

## Launch Verification

Run these commands from the repository root before announcing the project:

```bash
npm install
npm run validate
npm test
npm run proof:path
```

Confirm that a first-time visitor can do these three things without extra explanation:

- understand the problem and solution from the README
- find the payments example quickly
- follow the Quick Start and proof path without reading the full specification first

## Public Links To Check

- GitHub repository home page
- GitHub Pages site
- README badges and live-site link
- Docs hub and installation guide
- Discussions tab
- issue templates

## Launch-Day Actions

1. Enable GitHub Discussions if it is still off.
2. Publish the pinned feedback discussion using `docs/community-feedback-discussion.md`.
3. Keep the `Docs Generated From My Spec` issue form visible in the Issues tab.
4. Publish the design-partner intake form in whichever tool you prefer, using `docs/design-partner-intake.md` as the source.
5. Post the repository in targeted API and docs communities with the payments example and proof path as the trust anchors.
