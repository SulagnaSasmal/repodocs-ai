# Installation Guide

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

1. Verify the end-to-end proof path.

```bash
npm run proof:path
```

1. Review the product-facing documentation.

- `README.md`
- `docs/product-guide.md`
- `docs/ready-to-install-system.md`
- `docs/product-specification.md`

## Quick Start For Your Own Docs Repository

If your goal isn't to develop RepoDocs AI itself, but to use it as a documentation system starter, do this next.

1. Clone RepoDocs AI and copy the starter assets into your new docs repository.
1. Start with the API, feature, and governance template packs.

On bash:

```bash
git clone https://github.com/SulagnaSasmal/repodocs-ai.git
mkdir company-docs
cp -R repodocs-ai/templates company-docs/
cp -R repodocs-ai/prompts company-docs/
cp -R repodocs-ai/diagrams company-docs/
```

On Windows PowerShell:

```powershell
git clone https://github.com/SulagnaSasmal/repodocs-ai.git
New-Item -ItemType Directory -Name company-docs
Copy-Item repodocs-ai\templates -Destination company-docs\ -Recurse
Copy-Item repodocs-ai\prompts -Destination company-docs\ -Recurse
Copy-Item repodocs-ai\diagrams -Destination company-docs\ -Recurse
```

Or use the one-command bootstrap from inside the cloned repo:

> Requires Node.js 20 or later. Check with `node --version` before running.

```bash
git clone https://github.com/SulagnaSasmal/repodocs-ai.git
cd repodocs-ai
npm install
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
- decide whether the system fits their documentation workflow