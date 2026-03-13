# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | Yes       |

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

1. Always set `REPODOCS_CONTROL_PLANE_BOOTSTRAP_KEY` to a strong random value.
2. Never expose the control plane port to the public internet without authentication.
3. Rotate API keys regularly using the `/users/:id/keys` management endpoint.
4. Use the provided Docker and Redis configurations — do not run the control plane with an unauthenticated Redis instance accessible from untrusted networks.
5. Review `docs/hosted-control-plane.md` before deploying to production.
