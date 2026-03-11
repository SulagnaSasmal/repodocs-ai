import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { loadMarkdownDocuments, pathExists, repoRoot } from "./lib/docs-automation-utils.mjs";

const port = Number(process.env.REPODOCS_CONTROL_PLANE_PORT || 4312);
const host = process.env.REPODOCS_CONTROL_PLANE_HOST || "127.0.0.1";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const configuredApiKeys = new Set(
  String(process.env.REPODOCS_CONTROL_PLANE_API_KEYS || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
);
const authEnabled = configuredApiKeys.size > 0;
const artifactTargets = [
  "agents/output/last-run.json",
  "analytics/output/report.json",
  "knowledge-graph/output/graph.json",
  "exports/manifest.json"
];

const jobs = {
  validate: ["run", "validate"],
  agent: ["run", "agent:run"],
  analytics: ["run", "analytics:report"],
  graph: ["run", "graph:build"],
  automation: ["run", "automation:run"],
  export: ["run", "export"]
};

let activeRun = null;
const queuedRuns = [];
const runHistory = [];

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

function sendHtml(response, html) {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
}

function getAuthHeader(request) {
  return request.headers["x-api-key"] || request.headers.authorization || "";
}

function isAuthorized(request) {
  if (!authEnabled) {
    return true;
  }

  const apiKeyHeader = String(request.headers["x-api-key"] || "").trim();
  if (apiKeyHeader && configuredApiKeys.has(apiKeyHeader)) {
    return true;
  }

  const authorization = String(request.headers.authorization || "").trim();
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  if (bearerMatch && configuredApiKeys.has(bearerMatch[1].trim())) {
    return true;
  }

  return false;
}

function requireAuth(request, response) {
  if (isAuthorized(request)) {
    return true;
  }

  response.writeHead(401, {
    "Content-Type": "application/json; charset=utf-8",
    "WWW-Authenticate": 'Bearer realm="RepoDocs AI Control Plane"'
  });
  response.end(JSON.stringify({
    error: "Authentication required",
    auth_enabled: authEnabled,
    accepted_headers: ["Authorization: Bearer <token>", "X-API-Key: <token>"]
  }, null, 2));
  return false;
}

function readRequestBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.on("data", (chunk) => {
      body += chunk.toString();
    });
    request.on("end", () => resolve(body));
    request.on("error", reject);
  });
}

function createRun(jobName, requestedBy = "api") {
  return {
    id: `${jobName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    job: jobName,
    requested_by: requestedBy,
    accepted_at: new Date().toISOString(),
    started_at: null,
    finished_at: null,
    status: "queued",
    exit_code: null,
    queue_position: queuedRuns.length + (activeRun ? 1 : 0) + 1,
    stdout: "",
    stderr: ""
  };
}

async function executeRun(run) {
  const jobName = run.job;
  if (!(jobName in jobs)) {
    return Promise.reject(new Error(`Unknown job '${jobName}'`));
  }

  return new Promise((resolve, reject) => {
    const child = process.platform === "win32"
      ? spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", `${npmCommand} ${jobs[jobName].join(" ")}`], {
          cwd: repoRoot,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"]
        })
      : spawn(npmCommand, jobs[jobName], {
          cwd: repoRoot,
          env: process.env,
          stdio: ["ignore", "pipe", "pipe"]
        });

    run.started_at = new Date().toISOString();
    run.status = "running";
    run.queue_position = 0;
    activeRun = run;

    child.stdout.on("data", (chunk) => {
      run.stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      run.stderr += chunk.toString();
    });

    child.on("exit", (code) => {
      run.finished_at = new Date().toISOString();
      run.exit_code = code;
      run.status = code === 0 ? "succeeded" : "failed";
      runHistory.unshift(run);
      if (runHistory.length > 25) {
        runHistory.length = 25;
      }
      activeRun = null;
      processQueue().catch((error) => {
        console.error("Failed to continue queued job processing", error);
      });

      if (code === 0) {
        resolve(run);
      } else {
        reject(Object.assign(new Error(run.stderr || run.stdout || `Job '${jobName}' failed`), { run }));
      }
    });
  });
}

function refreshQueuePositions() {
  queuedRuns.forEach((run, index) => {
    run.queue_position = index + (activeRun ? 2 : 1);
  });
}

function enqueueJob(jobName, requestedBy = "api") {
  if (!(jobName in jobs)) {
    throw new Error(`Unknown job '${jobName}'`);
  }

  const run = createRun(jobName, requestedBy);
  queuedRuns.push(run);
  refreshQueuePositions();
  processQueue().catch((error) => {
    console.error("Failed to process queued jobs", error);
  });
  return run;
}

async function processQueue() {
  if (activeRun || queuedRuns.length === 0) {
    return;
  }

  const run = queuedRuns.shift();
  refreshQueuePositions();
  await executeRun(run);
}

async function loadArtifacts() {
  const artifacts = [];

  for (const relativePath of artifactTargets) {
    const fullPath = path.join(repoRoot, relativePath);
    if (!(await pathExists(fullPath))) {
      continue;
    }

    const raw = await fs.readFile(fullPath, "utf8");
    let parsed = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }

    artifacts.push({
      path: relativePath,
      data: parsed
    });
  }

  return artifacts;
}

async function loadOverview() {
  const documents = await loadMarkdownDocuments(["docs", "examples", "generated"]);
  return {
    documents: documents.length,
    jobs: Object.keys(jobs),
    auth_enabled: authEnabled,
    queue_depth: queuedRuns.length,
    active_run: activeRun,
    queued_runs: queuedRuns.map((run) => ({
      id: run.id,
      job: run.job,
      accepted_at: run.accepted_at,
      queue_position: run.queue_position,
      status: run.status
    })),
    recent_runs: runHistory.slice(0, 5)
  };
}

function renderDashboard() {
  const jobButtons = Object.keys(jobs)
    .map((job) => `<button data-job="${job}">${job}</button>`)
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>RepoDocs AI Control Plane</title>
    <style>
      body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; background: #f4efe7; color: #1f1a14; }
      main { max-width: 1100px; margin: 0 auto; padding: 32px 24px 64px; }
      .hero { display: grid; gap: 20px; grid-template-columns: 2fr 1fr; }
      .panel, .card { background: #fffaf3; border: 1px solid #e5d7bd; border-radius: 18px; padding: 20px; }
      .panel input { width: min(360px, 100%); padding: 12px 14px; border-radius: 12px; border: 1px solid #ccb89a; margin-top: 12px; }
      .button-row { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 16px; }
      button { border: 0; border-radius: 999px; padding: 12px 18px; background: #99611f; color: white; cursor: pointer; }
      button.secondary { background: #4d5b6a; }
      pre { padding: 16px; border-radius: 16px; background: #1f1a14; color: #f7ecdc; overflow: auto; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px; }
      .status { font-size: 14px; color: #6d6153; }
      ul { padding-left: 18px; }
      @media (max-width: 800px) { .hero, .grid { grid-template-columns: 1fr; } }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <article class="panel">
          <p class="status">Hosted Control Plane</p>
          <h1>RepoDocs AI automation can now run behind an HTTP endpoint.</h1>
          <p>This service exposes validation, export, agent, analytics, and graph jobs through a small control plane intended for lightweight hosted deployment.</p>
          <label for="api-key">API key</label>
          <input id="api-key" type="password" placeholder="Paste an API key or bearer token" />
          <div class="button-row">${jobButtons}</div>
          <div class="button-row">
            <button class="secondary" id="refresh">Refresh overview</button>
          </div>
        </article>
        <article class="card">
          <p class="status">Overview</p>
          <h2 id="overview-title">Loading overview…</h2>
          <p id="overview-status">Use an API key to load protected run and artifact data.</p>
          <p>JSON endpoints: <code>/health</code>, <code>/jobs</code>, <code>/artifacts</code>, <code>/runs</code>, <code>/auth/status</code></p>
        </article>
      </section>
      <section class="grid">
        <article class="card">
          <p class="status">Recent Runs</p>
          <div id="recent-runs"><p>No runs loaded yet.</p></div>
        </article>
        <article class="card">
          <p class="status">Artifacts</p>
          <div id="artifacts"><p>No artifacts loaded yet.</p></div>
        </article>
      </section>
      <section class="card" style="margin-top: 20px;">
        <p class="status">Response</p>
        <pre id="response">POST /jobs/:name will stream back run metadata here.</pre>
      </section>
    </main>
    <script>
      const apiKeyInput = document.getElementById('api-key');
      const response = document.getElementById('response');
      const overviewTitle = document.getElementById('overview-title');
      const overviewStatus = document.getElementById('overview-status');
      const recentRuns = document.getElementById('recent-runs');
      const artifacts = document.getElementById('artifacts');

      apiKeyInput.value = localStorage.getItem('repodocsApiKey') || '';

      function headers() {
        const key = apiKeyInput.value.trim();
        localStorage.setItem('repodocsApiKey', key);
        return key ? { 'X-API-Key': key } : {};
      }

      function renderList(items, emptyText, formatter) {
        if (!items || items.length === 0) {
          return '<p>' + emptyText + '</p>';
        }
        return '<ul>' + items.map(formatter).join('') + '</ul>';
      }

      async function refreshOverview() {
        try {
          const [authResult, jobsResult, runsResult, artifactsResult] = await Promise.all([
            fetch('/auth/status'),
            fetch('/jobs', { headers: headers() }),
            fetch('/runs', { headers: headers() }),
            fetch('/artifacts', { headers: headers() })
          ]);

          const authData = await authResult.json();
          if (!jobsResult.ok || !runsResult.ok || !artifactsResult.ok) {
            const failed = !jobsResult.ok ? jobsResult : (!runsResult.ok ? runsResult : artifactsResult);
            const errorText = await failed.text();
            throw new Error(errorText);
          }

          const jobsData = await jobsResult.json();
          const runsData = await runsResult.json();
          const artifactsData = await artifactsResult.json();
          overviewTitle.textContent = authData.auth_enabled
            ? ((jobsData.active_run ? 'Active: ' + jobsData.active_run.job : 'No active run') + ' • ' + jobsData.queue_depth + ' queued')
            : 'Auth disabled • local development mode';
          overviewStatus.textContent = 'Accepted headers: X-API-Key or Authorization: Bearer <token>.';
          recentRuns.innerHTML = renderList(
            (runsData.recent_runs || []).concat(runsData.queued_runs || []),
            'No runs available yet.',
            (run) => '<li><strong>' + run.job + '</strong> ' + run.status + (run.queue_position ? ' (queue #' + run.queue_position + ')' : '') + '</li>'
          );
          artifacts.innerHTML = renderList(
            artifactsData.artifacts || [],
            'No artifacts available yet.',
            (artifact) => '<li><strong>' + artifact.path + '</strong></li>'
          );
        } catch (error) {
          overviewTitle.textContent = 'Protected endpoints require a valid API key';
          overviewStatus.textContent = error.message;
          recentRuns.innerHTML = '<p>Run data unavailable.</p>';
          artifacts.innerHTML = '<p>Artifact data unavailable.</p>';
        }
      }

      document.getElementById('refresh').addEventListener('click', refreshOverview);
      document.querySelectorAll('button[data-job]').forEach((button) => {
        button.addEventListener('click', async () => {
          const job = button.dataset.job;
          response.textContent = 'Queueing ' + job + '...';
          const result = await fetch('/jobs/' + job, { method: 'POST', headers: headers() });
          const text = await result.text();
          response.textContent = text;
          refreshOverview();
        });
      });
      refreshOverview();
    </script>
  </body>
</html>`;
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);

    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, {
        status: "ok",
        active_run: activeRun,
        queue_depth: queuedRuns.length,
        auth_enabled: authEnabled,
        uptime_seconds: Math.round(process.uptime())
      });
    }

    if (request.method === "GET" && url.pathname === "/auth/status") {
      return sendJson(response, 200, {
        auth_enabled: authEnabled,
        accepted_headers: ["Authorization: Bearer <token>", "X-API-Key: <token>"],
        provided_header: getAuthHeader(request) ? "present" : "absent"
      });
    }

    if (request.method === "GET" && url.pathname === "/jobs") {
      if (!requireAuth(request, response)) {
        return;
      }
      return sendJson(response, 200, {
        jobs: Object.keys(jobs),
        active_run: activeRun,
        queue_depth: queuedRuns.length,
        queued_runs: queuedRuns.map((run) => ({
          id: run.id,
          job: run.job,
          accepted_at: run.accepted_at,
          queue_position: run.queue_position,
          status: run.status
        }))
      });
    }

    if (request.method === "GET" && url.pathname === "/runs") {
      if (!requireAuth(request, response)) {
        return;
      }
      return sendJson(response, 200, { active_run: activeRun, queued_runs: queuedRuns, recent_runs: runHistory });
    }

    if (request.method === "GET" && url.pathname === "/artifacts") {
      if (!requireAuth(request, response)) {
        return;
      }
      return sendJson(response, 200, { artifacts: await loadArtifacts() });
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/dashboard")) {
      return sendHtml(response, renderDashboard());
    }

    if (request.method === "POST" && url.pathname.startsWith("/jobs/")) {
      if (!requireAuth(request, response)) {
        return;
      }
      const jobName = url.pathname.replace(/^\/jobs\//, "");
      await readRequestBody(request);
      const run = enqueueJob(jobName, request.socket.remoteAddress || "api");
      return sendJson(response, 202, {
        accepted: true,
        message: `Job '${jobName}' queued successfully`,
        run,
        queue_depth: queuedRuns.length,
        active_run: activeRun
      });
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    const payload = error.run ? error.run : { error: error.message };
    sendJson(response, 500, payload);
  }
});

server.listen(port, host, () => {
  if (!authEnabled) {
    console.warn("RepoDocs AI control plane started without API keys. Set REPODOCS_CONTROL_PLANE_API_KEYS to enable authentication.");
  }
  console.log(`RepoDocs AI control plane listening at http://${host}:${port}`);
});