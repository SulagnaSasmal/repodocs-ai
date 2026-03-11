# Hosted Control Plane

RepoDocs AI now includes a small hosted control plane for repository-native automation.

## Purpose

- expose validation, export, agent, analytics, and graph jobs over HTTP
- provide a lightweight dashboard for hosted deployment
- surface generated artifacts without requiring shell access
- protect automation endpoints with per-user API-key or bearer-token authentication
- accept multiple job requests safely through durable queued execution
- persist users, keys, queue state, and run history on disk

## Run Locally

```bash
npm run control-plane:start
```

Default address:

- `http://127.0.0.1:4312`

Environment variables:

- `REPODOCS_CONTROL_PLANE_HOST`
- `REPODOCS_CONTROL_PLANE_PORT`
- `REPODOCS_CONTROL_PLANE_DATA_DIR`
- `REPODOCS_CONTROL_PLANE_BOOTSTRAP_USER`
- `REPODOCS_CONTROL_PLANE_BOOTSTRAP_DISPLAY_NAME`
- `REPODOCS_CONTROL_PLANE_BOOTSTRAP_KEY`

Authentication:

- protected endpoints accept `X-API-Key: <token>`
- protected endpoints also accept `Authorization: Bearer <token>`
- bootstrap the first admin account with `REPODOCS_CONTROL_PLANE_BOOTSTRAP_KEY`
- user records and key metadata are stored in `users.json` under the control-plane data directory
- `GET /health` and `GET /auth/status` remain available for health and auth discovery

User management endpoints:

- `GET /users`
- `POST /users`
- `PATCH /users/:id`
- `POST /users/:id/keys`
- `DELETE /users/:id/keys/:keyId`

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
docker run --rm -p 4312:4312 -v repodocs-ai-control-plane-data:/var/data -e REPODOCS_CONTROL_PLANE_HOST=0.0.0.0 -e REPODOCS_CONTROL_PLANE_DATA_DIR=/var/data/control-plane -e REPODOCS_CONTROL_PLANE_BOOTSTRAP_USER=admin -e REPODOCS_CONTROL_PLANE_BOOTSTRAP_KEY=replace-me repodocs-ai-control-plane
```

### Render Deployment

The repository now includes a `render.yaml` manifest for deploying the control plane as a Docker-backed web service with a persistent disk mounted at `/var/data`.

## Current Limits

- one active worker processes queued jobs in FIFO order
- multiple requests can be accepted while work is already running or after a process restart
- local process execution only
- artifact storage remains filesystem-based
- authentication is per-user and role-based, but not yet tied to an external identity provider
- durable queue storage is filesystem-backed rather than database-backed