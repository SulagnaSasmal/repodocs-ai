# Hosted Control Plane

RepoDocs AI now includes a small hosted control plane for repository-native automation.

## Purpose

- expose validation, export, agent, analytics, and graph jobs over HTTP
- provide a lightweight dashboard for hosted deployment
- surface generated artifacts without requiring shell access
- protect automation endpoints with API-key or bearer-token authentication
- accept multiple job requests safely through queued execution

## Run Locally

```bash
npm run control-plane:start
```

Default address:

- `http://127.0.0.1:4312`

Environment variables:

- `REPODOCS_CONTROL_PLANE_HOST`
- `REPODOCS_CONTROL_PLANE_PORT`
- `REPODOCS_CONTROL_PLANE_API_KEYS`

Authentication:

- protected endpoints accept `X-API-Key: <token>`
- protected endpoints also accept `Authorization: Bearer <token>`
- set `REPODOCS_CONTROL_PLANE_API_KEYS` to a comma-separated list of valid tokens
- `GET /health` and `GET /auth/status` remain available for health and auth discovery

## Endpoints

- `GET /health`
- `GET /auth/status`
- `GET /jobs`
- `GET /runs`
- `GET /artifacts`
- `GET /dashboard`
- `POST /jobs/validate`
- `POST /jobs/agent`
- `POST /jobs/analytics`
- `POST /jobs/graph`
- `POST /jobs/automation`
- `POST /jobs/export`

## Hosting Model

This control plane is intentionally small. It is suitable for a single-process hosted deployment behind a reverse proxy or container platform. The service runs existing npm automation commands and returns run metadata plus artifact summaries.

### Container Deployment

Build:

```bash
npm run docker:control-plane:build
```

Run:

```bash
docker run --rm -p 4312:4312 -e REPODOCS_CONTROL_PLANE_HOST=0.0.0.0 -e REPODOCS_CONTROL_PLANE_API_KEYS=replace-me repodocs-ai-control-plane
```

## Current Limits

- one active worker processes queued jobs in FIFO order
- multiple requests can be accepted while work is already running
- local process execution only
- artifact storage remains filesystem-based
- authentication is API-key based rather than user/tenant based