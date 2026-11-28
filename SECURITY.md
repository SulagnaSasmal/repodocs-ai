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

1. Set `REPODOCS_CONTROL_PLANE_BOOTSTRAP_KEY` to a random value of at least 24 characters, for example `openssl rand -hex 24`. The server refuses to start with a shorter key or a placeholder such as `replace-me`.
2. Until a key is set, the server answers only requests from the same machine; requests from anywhere else get 503. Never put it on a public address without a key.
3. Give operators a `service_scope`: a comma-separated list of the job names they may run, matched exactly.
4. Rotate API keys with the `/users/:id/keys` endpoint, and revoke keys you no longer use. The last active admin cannot be demoted or disabled.
5. Protect Redis with a password and keep it off public networks. The compose stack requires `REDIS_PASSWORD` and does not publish the Redis port.
6. Put the control plane behind HTTPS. It sends security headers and a strict Content-Security-Policy, limits request bodies to 64 KB, and limits each address to 120 requests and 10 failed key attempts a minute. Those limits are kept per process, so a multi-instance deployment should also rate-limit at the load balancer.
7. Review `docs/hosted-control-plane.md` before deploying to production.

## Generated Documentation

OpenAPI specs often come from other teams or vendors, so the generator treats their text as untrusted. Outside code blocks, HTML from a spec is escaped and `javascript:`, `vbscript:` and `data:` links are removed, so a docs site that renders raw HTML (MkDocs, Jekyll, Hugo with unsafe HTML on) shows that text instead of running it. The quality check fails hand-written docs that contain `<script>`, `<iframe>`, inline event handlers or script links.

## Last Audit

A security audit on 2026-11-28 covered secrets in the tree and the full Git history, the control plane, the generator and validators, the GitHub workflows, the Docker setup and dependencies. The findings and fixes are in `.github/release-checks/2026-11-28-security-audit.md`.
