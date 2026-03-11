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