# Release checks

Run these before tagging a release. The automated adopter tests (`tests/adopter-path.test.mjs`) cover the core path on every pull request; this check adds a reader who has never seen the project.

## 1. Automated checks

```bash
npm ci
npm test
npm run validate
npm run proof:path
npm audit
```

All must pass. `npm audit` may report low-severity advisories that have no fix; list them in the release notes.

## 2. Fresh-agent README test

Give an AI coding agent with no prior context this prompt, in a clean environment with network access to GitHub. Do not tell it about known issues.

> You are testing an open-source documentation toolkit the way a first-time user would. Work only in a new temporary folder. Do not push anything or open pull requests.
>
> Clone https://github.com/SulagnaSasmal/repodocs-ai. Download a public OpenAPI spec you have not seen before (not one from the repository's tests or examples).
>
> Follow only README.md and the docs it links to. Do not read source code unless you are completely stuck, and log it if you do. Do not fix anything.
>
> 1. Set up a new docs repository as the README describes.
> 2. Generate API reference docs from the spec.
> 3. Validate them as the README says. Note exactly what each command checked.
> 4. Set up CI validation for the docs repository. Can you make it run?
> 5. Write one feature doc by hand from a template, with frontmatter, and validate it.
> 6. Compare one generated endpoint doc with the spec. List anything missing, wrong, invented or left as a placeholder.
>
> Report every command, every point where you stalled, guessed or hit an error, and every README claim that did not match what happened. Most serious first, under 700 words.

Save the report in this folder as `YYYY-MM-DD-vX.Y.Z.md`, with a short note on what was fixed and what was deferred. Fix or file every finding before tagging.

## 3. Tag

```bash
git tag vX.Y.Z
git push origin vX.Y.Z
```
