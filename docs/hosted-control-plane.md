# Hosted Control Plane

RepoDocs AI now includes a small hosted control plane for repository-native automation.

## Purpose

- expose validation, export, agent, analytics, and graph jobs over HTTP
- provide a lightweight dashboard for hosted deployment
- surface generated artifacts without requiring shell access

## Run Locally

```bash
npm run control-plane:start
```

Default address:

- `http://127.0.0.1:4312`

Environment variables:

- `REPODOCS_CONTROL_PLANE_HOST`
- `REPODOCS_CONTROL_PLANE_PORT`

## Endpoints

- `GET /health`
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

## Current Limits

- one active job at a time
- local process execution only
- artifact storage remains filesystem-based
- no authentication layer yet