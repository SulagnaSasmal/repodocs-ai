# RepoDocs AI Installation

## Goal

Install and validate RepoDocs AI in under 5 minutes.

## Prerequisites

- Node.js 20 or later
- npm
- Git

Optional for the hosted control plane path:

- Docker Desktop

## Core Installation

1. Clone the repository.

```bash
git clone https://github.com/SulagnaSasmal/repodocs-ai.git
cd repodocs-ai
```

1. Install dependencies.

```bash
npm install
```

1. Validate the repository.

```bash
npm run validate
```

1. Review the product-facing documentation.

- `README.md`
- `docs/product-guide.md`
- `docs/ready-to-install-system.md`
- `site/index.html`

## Quick Start For Your Own Docs Repository

If your goal is not to develop RepoDocs AI itself, but to use it as a documentation system starter, do this next.

1. Create a repository for your documentation.
1. Copy the RepoDocs AI starter assets into it.
1. Start with the API, feature, and governance template packs.

On Windows PowerShell:

```powershell
mkdir company-docs
Set-Location company-docs
Copy-Item ..\repodocs-ai\templates -Destination . -Recurse
Copy-Item ..\repodocs-ai\prompts -Destination . -Recurse
Copy-Item ..\repodocs-ai\diagrams -Destination . -Recurse
```

On bash:

```bash
mkdir company-docs
cd company-docs
cp -R ../repodocs-ai/templates .
cp -R ../repodocs-ai/prompts .
cp -R ../repodocs-ai/diagrams .
```

Or from the RepoDocs AI repository root, use the one-command bootstrap path:

```bash
npm run bootstrap:docs-repo -- ../company-docs
```

After copying the assets:

- start with `templates/api/` to document APIs
- use `templates/features/` for product and workflow docs
- use `templates/governance/` for review and QA checks
- use `prompts/` to draft and review content with AI

## Adopt The System

Start from these directories:

- `templates/` for documentation structure
- `prompts/` for AI drafting and review guidance
- `examples/` for reference implementations
- `schema/` and `validation/` for metadata and quality enforcement

## Optional Hosted Runtime Verification

If you want to verify the hosted automation runtime locally:

1. Set a bootstrap admin key.
1. Start the compose stack and smoke test.

```bash
export REPODOCS_CONTROL_PLANE_BOOTSTRAP_KEY=replace-me
npm run control-plane:stack:smoke
```

On Windows PowerShell:

```powershell
$env:REPODOCS_CONTROL_PLANE_BOOTSTRAP_KEY = 'replace-me'
npm run control-plane:stack:smoke
```

## Expected Outcome

After installation, a developer should be able to:

- understand the product from the README and product guide
- inspect reusable templates and prompts immediately
- validate the repository successfully
- review the published site or run the hosted control-plane smoke test