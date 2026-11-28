# Installation Guide

## Goal

Install the `repodocs-ai` command, set up a docs repository, generate docs from an OpenAPI spec, and validate them.

## Prerequisites

- Node.js 20 or later (`node --version`)
- npm
- Git, if you want to push the docs repository to GitHub

## Install

```bash
npm install -g github:SulagnaSasmal/repodocs-ai#v1.2.4
repodocs-ai --version
```

To run a command once without installing, use `npx --yes github:SulagnaSasmal/repodocs-ai#v1.2.4 <command>`. Run `repodocs-ai help` for every command. Paths resolve from the folder you run the command in.

## Set Up a Docs Repository

```bash
repodocs-ai init company-docs
```

This creates `company-docs/` with:

- `templates/`, `prompts/`, `diagrams/`, `schema/` and `validation/`
- empty `openapi/`, `generated/` and `docs/` folders
- `.github/workflows/docs-validate.yml`, which runs the checks in CI
- `.github/CODEOWNERS` with example rules to replace, a pull request template, and `.markdownlint.json`
- a starter `README.md`

It does not run `git init` or create the GitHub repository. Add `--with-examples` to also copy the payments example set.

## Generate Docs From Your Spec

Put your OpenAPI 3.x file in `company-docs/openapi/`, then:

```bash
repodocs-ai generate company-docs/openapi/my-api.yaml company-docs/generated --owner payments-eng
```

`--owner` sets the `owner` field in the generated frontmatter. Without it, the owner is `unassigned` and the quality check warns about it. Generated docs are drafts for SME review: sections the spec does not describe say `Needs SME input`.

## Validate

```bash
repodocs-ai validate company-docs/generated --specs company-docs/openapi
```

Each check reports PASS, WARN, FAIL or SKIP and names the folder it checked. The command exits with a non-zero code when a check fails. A skipped check, for example because you left out `--specs`, does not fail the run unless you add `--strict`. Add `company-docs/docs` once you have hand-written docs.

## Write Docs by Hand

1. Copy a template from `templates/` into `company-docs/docs/`.
2. Fill in the frontmatter fields described in `schema/metadata-frontmatter.md`. Empty required fields fail validation.
3. Validate the folder with `repodocs-ai validate company-docs/docs`.

## Turn On CI

Push `company-docs` to GitHub. The workflow in `.github/workflows/docs-validate.yml` runs on every pull request and on every push to `main`. It validates `generated/` and `docs/` against `openapi/`, with the same RepoDocs AI version that created the repository. It fails until there is at least one Markdown doc to check. To pin an exact commit instead of a release tag, replace `#v1.2.4` (or whichever version) in the workflow's `npx` line with the commit SHA.

## Work on RepoDocs AI Itself

Clone the repository instead:

```bash
git clone https://github.com/SulagnaSasmal/repodocs-ai.git
cd repodocs-ai
npm install
npm test
npm run validate
```

Running the tests needs Node.js 22 or later. Inside the clone, `node bin/repodocs.mjs <command>` runs the same CLI.

The hosted control plane and other experimental parts are described in `experimental/README.md` in the repository.
