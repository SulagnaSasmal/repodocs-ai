# Security audit: 2026-11-28

An audit of RepoDocs AI before the v1.2.3 release, against the common checklist for apps built quickly with AI help. The checklist assumes a web app with logins and a database. RepoDocs AI is a CLI, generated Markdown, a static docs website, six GitHub workflows, and an experimental HTTP control plane with API keys and Redis. Each item below is mapped to the part it applies to.

Every fix was tested against a running server or a generated doc, and most have automated tests: `tests/control-plane-security.test.mjs` (12 tests against a real Redis, which CI now provides) and the hostile-spec tests in `tests/generate-openapi-docs.test.mjs`.

## Checklist

| Item | Where it applies | Finding | Outcome |
| --- | --- | --- | --- |
| Hide API keys | Tree and full Git history (119 commits) | No keys, tokens or private keys anywhere, ever. Only `replace-me` placeholders | Clean |
| Check env variables | `.gitignore`, `.dockerignore` | Neither listed `.env`; the Dockerfile's `COPY . .` would bake a local `.env` into the image | Fixed: `.env*`, `*.pem`, `*.key`, `.npmrc` ignored by both |
| Check Git for secrets | Full history after unshallowing the clone | None | Clean |
| Check for exposed files | Published package (`files` in `package.json`) | 75 files, no secrets, no control-plane code | Clean |
| Hide admin routes | Control plane | With no key configured, every route was open: anyone who could reach the port could create an admin, after which auth was "on" with the attacker's key. Proven from a non-loopback address | Fixed: only same-machine requests until a key is set; others get 503 |
| Proper authentication | Control plane | `replace-me` was accepted as the admin key, and the compose file defaulted to it | Fixed: keys under 24 characters or placeholders stop the server from starting; compose requires a key |
| Users only access what they should | Control plane `service_scope` | Matched by substring: scope `a` allowed `analytics`, `agent` and `automation` | Fixed: exact job names, comma separated |
| | Control plane admins | The last admin could demote or disable itself and lock everyone out | Fixed: refused with 409 |
| Hash passwords properly | Control plane API keys | Keys are 192-bit random values stored as SHA-256, which is right for random keys (slow hashes are for passwords people choose). The bootstrap key is chosen by a person, so length now matters | Fixed: minimum length; constant-time comparison |
| Sanitize forms / protect against XSS | Control plane dashboard | User names, labels and run fields went into `innerHTML` unescaped; the admin key sat in `localStorage`, where an XSS could read it | Fixed: every value escaped, nonce-based CSP, key kept for the tab only |
| | Generated docs | Raw HTML from a spec (`<script>`, `<img onerror>`, `<iframe>`, `javascript:` links) reached the doc body. On MkDocs, Jekyll, or Hugo with unsafe HTML on, that is stored XSS on the docs site | Fixed: escaped outside code; script links removed. This also stops `array<string>` being read as a tag |
| | Hand-written docs | Nothing flagged script in docs | Fixed: the quality check fails `<script>`, `<iframe>`, event handlers and script links |
| | Frontmatter | Spec text that tries to add keys (`owner: attacker`) stays inside the quoted value | Clean, now tested |
| | File names | Built from method and path only; an `operationId` of `../../../etc/passwd` has no effect | Clean, now tested |
| Rate limiting | Control plane | None; unlimited key guessing | Fixed: 120 requests a minute per address, one-minute lockout after 10 wrong keys |
| Secure API endpoints | Control plane | No body size limit (5 MB accepted); malformed JSON returned 500 with the parser message; 500s returned internal run output | Fixed: 64 KB limit (413), 400 for bad JSON or usernames, generic 500 with details in the server log |
| | Control plane `/health` | Public, and showed run details, user names, the data path and the Redis URL | Fixed: status, queue depth, auth on or off, uptime |
| Check CORS | Control plane | No CORS headers, so browsers block cross-site reads; keys travel in headers, not cookies, so cross-site requests carry no credentials | Clean |
| Security headers | Control plane | None | Fixed: CSP, `X-Frame-Options`, `nosniff`, `Referrer-Policy`, `Cache-Control: no-store` and more |
| | Docs website | GitHub Pages cannot set headers; the site has no third-party scripts or keys | Open: needs a host that sets headers |
| Turn off debug mode | Control plane | No debug switch, but errors leaked details (see above) | Fixed with the error handling |
| Secure database access | Redis in the compose stack | Published on host port 6379 with no password: anyone on the network could rewrite the user list | Fixed: password required, port not published, control plane on 127.0.0.1 only |
| | Redis password in logs | The startup log printed the full Redis URL, password included | Fixed: masked |
| | Redis resilience | A dropped Redis connection crashed the server; requests waited up to a second each behind the job worker's blocking read | Fixed: error listeners, separate worker connection (about 2,000 ms to 2 ms per request) |
| Update dependencies | Root package | `npm audit --omit=dev`: 0. Four low advisories in KaTeX, pulled in by `markdownlint-cli` (dev only); the fix is a breaking major | Open, low |
| | Website | 49 advisories, 18 critical, in Docusaurus build tooling | Fixed: `npm audit fix` and overrides for packages Docusaurus pins; 0 left, site builds |
| | Dependabot | Did not watch `website/` | Fixed |
| | Majors behind | `@anthropic-ai/sdk` 0.32 (latest 1.14), `redis` 5 (latest 6), `js-yaml` 4 (5 breaks the import, pinned on purpose) | Open: upgrade separately |
| Remove unused packages or files | Root dependencies | All four in use | Clean |
| | `archive/` (46 files) and the 3.7 MB demo video | Not used by the CLI or site build | Your call; not removed |
| Containers | Dockerfile | Ran as root | Fixed: `node` user |
| CI/CD (not on the checklist) | Workflows | Four of six had no `permissions:` block, so the token could have repository write access; one interpolated `workflow_dispatch` inputs straight into a shell script | Fixed: read-only tokens everywhere; inputs via environment variables |
| | Action pins | Pinned to major tags, not commit SHAs | Open: Dependabot keeps them current |

## Still open

- Control plane operators can read every run's output and every artifact. Per-user isolation is a roadmap item, like external identity and audit logging.
- Rate limits are kept per process. A multi-instance deployment should also rate-limit at the load balancer.
- Adopters' CI installs `github:SulagnaSasmal/repodocs-ai#v1.2.3`. Git tags can be moved; teams that need a fixed version should pin the commit SHA.
