# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.2.x   | Yes       |
| < 1.2   | No        |

## Reporting a Vulnerability

RepoDocs AI is an open-source documentation system. Security issues may affect:

- the hosted control plane server (`scripts/control-plane-server.mjs`)
- API key handling and authentication logic
- script-level command injection risks in automation scripts
- dependency vulnerabilities in `package.json`

**Please do not report security vulnerabilities through public GitHub issues.**

### How to Report

Report vulnerabilities using GitHub's private security advisory system:

1. Go to the [Security Advisories page](https://github.com/SulagnaSasmal/repodocs-ai/security/advisories/new).
2. Click **New draft security advisory**.
3. Fill in the title, description, severity, and affected versions.
4. Submit the draft. The maintainer will acknowledge within **5 business days**.

Alternatively, email [sulagnasasmal@gmail.com](mailto:sulagnasasmal@gmail.com) with the subject line:

```text
[SECURITY] RepoDocs AI — <brief description>
```

Include:

- a description of the vulnerability
- steps to reproduce
- potential impact
- any suggested fix (optional)

### What to Expect

- **Acknowledgement:** within 5 business days
- **Triage and status update:** within 10 business days
- **Fix or mitigation:** coordinated with the reporter before public disclosure
- **Credit:** reporters who follow responsible disclosure will be credited in the release notes unless they prefer to remain anonymous

## Scope

**In scope:**

- Authentication and authorization bypasses in the control plane
- Command injection or path traversal in automation scripts
- Dependency vulnerabilities with a realistic exploitation path
- Sensitive data exposure (API keys, tokens)

**Out of scope:**

- Template or Markdown content quality issues
- Theoretical vulnerabilities without a realistic attack vector
- Issues in the `node_modules/` directory without a clear exploitation path from the published scripts
- Missing rate limiting in local development configurations

## Security Best Practices for Adopters

If you deploy the RepoDocs AI hosted control plane:

1. Set `REPODOCS_CONTROL_PLANE_BOOTSTRAP_KEY` to a random value of at least 24 characters, for example `openssl rand -hex 24`. The server refuses to start with a shorter key, a key containing a placeholder word such as `replace-me` or `password`, or a guessable one (fewer than 10 distinct characters, a short pattern repeated, or a run along the keyboard, the alphabet or the digits, such as `qwertyuiop…`).
2. Until a key is set, the server answers only requests from the same machine, addressed to `localhost` or `127.0.0.1`; other requests get 503, and other Host names get 421, so a site that rebinds its DNS name to this machine cannot read the API. Never put it on a public address without a key.
3. Requests that change something are refused from any other origin (403), and their bodies must be JSON (415), so a web page open in the same browser cannot create users or queue jobs.
4. Give operators a `service_scope`: a comma-separated list of the job names they may run, matched exactly.
5. Rotate API keys with the `/users/:id/keys` endpoint, and revoke keys you no longer use. The last active admin cannot be demoted or disabled.
6. Protect Redis with a password and keep it off public networks. The compose stack requires `REDIS_PASSWORD` and does not publish the Redis port.
7. Put the control plane behind HTTPS. It sends security headers on every response and a strict Content-Security-Policy on the dashboard, limits request bodies to 64 KB, and limits each client to 120 requests and 10 failed key attempts a minute. The counts live in Redis, so every instance shares them. Behind a load balancer or reverse proxy, set `REPODOCS_TRUST_PROXY=1` so limits apply per client rather than per proxy; requests that arrive through a proxy are never treated as local.
8. Operators see only the runs they started and the artifacts of jobs their scope allows. Admins see everything.
9. Review `docs/hosted-control-plane.md` before deploying to production.

## Supply Chain

- Every GitHub Action in this repository, and in the workflow `init` writes for adopters, is pinned to a full commit SHA, with the version in a comment. Dependabot updates both.
- Workflow tokens are read-only.
- Dependabot watches the root package, the website and the actions. `npm audit` reports no advisories in either package.
- Releases are installed from Git tags (`#v1.2.6`). To make a release's tag impossible to move, the maintainer enables immutable releases in the repository settings. Teams that want certainty regardless can pin a commit SHA instead of a tag.

## Generated Documentation

OpenAPI specs often come from other teams or vendors, so the generator treats their text as untrusted.

- Outside code blocks, HTML from a spec is escaped, entities are shown as written, and `javascript:`, `vbscript:` and `data:` links are removed in every form (inline, reference-style, entity-encoded, split by whitespace). A docs site that renders raw HTML (MkDocs, Jekyll, Hugo with unsafe HTML on) shows that text instead of running it.
- The curl examples are safe to paste into a shell. Characters the shell acts on are percent-encoded in URLs and escaped in header values, header names are reduced to valid header characters, and line breaks are removed, so a crafted server URL, parameter or security scheme cannot run a command. The test suite runs the generated example for a hostile spec with `curl` stubbed out and checks nothing ran. `!` is quoted so shell history expansion cannot rewrite a value. Multipart text fields use `--form-string`, which sends a value as text even when it starts with `@` or `<`; only fields the spec marks as files use `-F "name=@<file>"`, and the OpenAPI check fails an example that names a real local file, such as `@/etc/passwd`, so a copied example cannot upload one.
- The quality check fails hand-written docs that contain `<script>`, `<iframe>`, `<object>`, `<embed>`, `<form>`, `<style>`, `<meta http-equiv>`, inline event handlers or script links.

## Last Audit

A security audit on 2026-11-28 covered secrets in the tree and the full Git history, the control plane, the generator and validators, the GitHub workflows, the Docker setup and dependencies. The findings and fixes are in `.github/release-checks/2026-11-28-security-audit.md`.
