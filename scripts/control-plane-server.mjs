import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { loadMarkdownDocuments, pathExists, repoRoot } from "./lib/docs-automation-utils.mjs";

const port = Number(process.env.REPODOCS_CONTROL_PLANE_PORT || 4312);
const host = process.env.REPODOCS_CONTROL_PLANE_HOST || "127.0.0.1";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
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
const runHistory = [];

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

function sendHtml(response, html) {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
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

function spawnJob(jobName) {
  if (!(jobName in jobs)) {
    return Promise.reject(new Error(`Unknown job '${jobName}'`));
  }

  if (activeRun) {
    return Promise.reject(new Error(`Job '${activeRun.job}' is already running`));
  }

  return new Promise((resolve, reject) => {
    const startedAt = new Date().toISOString();
    const child = spawn(npmCommand, jobs[jobName], {
      cwd: repoRoot,
      env: process.env,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"]
    });

    const run = {
      id: `${jobName}-${Date.now()}`,
      job: jobName,
      started_at: startedAt,
      finished_at: null,
      status: "running",
      exit_code: null,
      stdout: "",
      stderr: ""
    };
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
      if (runHistory.length > 10) {
        runHistory.length = 10;
      }
      activeRun = null;

      if (code === 0) {
        resolve(run);
      } else {
        reject(Object.assign(new Error(run.stderr || run.stdout || `Job '${jobName}' failed`), { run }));
      }
    });
  });
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
    active_run: activeRun,
    recent_runs: runHistory.slice(0, 5)
  };
}

function renderDashboard(overview, artifacts) {
  const jobButtons = Object.keys(jobs)
    .map((job) => `<button data-job="${job}">${job}</button>`)
    .join("");
  const recentRuns = overview.recent_runs.length === 0
    ? "<p>No runs yet.</p>"
    : `<ul>${overview.recent_runs.map((run) => `<li><strong>${run.job}</strong> ${run.status} at ${run.finished_at || run.started_at}</li>`).join("")}</ul>`;
  const artifactList = artifacts.length === 0
    ? "<p>No artifacts available yet.</p>"
    : `<ul>${artifacts.map((artifact) => `<li><strong>${artifact.path}</strong></li>`).join("")}</ul>`;

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
      .button-row { display: flex; flex-wrap: wrap; gap: 12px; margin-top: 16px; }
      button { border: 0; border-radius: 999px; padding: 12px 18px; background: #99611f; color: white; cursor: pointer; }
      pre { padding: 16px; border-radius: 16px; background: #1f1a14; color: #f7ecdc; overflow: auto; }
      .grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-top: 20px; }
      .status { font-size: 14px; color: #6d6153; }
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
          <div class="button-row">${jobButtons}</div>
        </article>
        <article class="card">
          <p class="status">Overview</p>
          <h2>${overview.documents} docs in scope</h2>
          <p>${activeRun ? `Active job: ${activeRun.job}` : "No job is currently running."}</p>
          <p>JSON endpoints: <code>/health</code>, <code>/jobs</code>, <code>/artifacts</code>, <code>/runs</code></p>
        </article>
      </section>
      <section class="grid">
        <article class="card">
          <p class="status">Recent Runs</p>
          ${recentRuns}
        </article>
        <article class="card">
          <p class="status">Artifacts</p>
          ${artifactList}
        </article>
      </section>
      <section class="card" style="margin-top: 20px;">
        <p class="status">Response</p>
        <pre id="response">POST /jobs/:name will stream back run metadata here.</pre>
      </section>
    </main>
    <script>
      const response = document.getElementById('response');
      document.querySelectorAll('button[data-job]').forEach((button) => {
        button.addEventListener('click', async () => {
          const job = button.dataset.job;
          response.textContent = 'Running ' + job + '...';
          const result = await fetch('/jobs/' + job, { method: 'POST' });
          const text = await result.text();
          response.textContent = text;
        });
      });
    </script>
  </body>
</html>`;
}

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);

    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, { status: "ok", active_run: activeRun, uptime_seconds: Math.round(process.uptime()) });
    }

    if (request.method === "GET" && url.pathname === "/jobs") {
      return sendJson(response, 200, { jobs: Object.keys(jobs), active_run: activeRun });
    }

    if (request.method === "GET" && url.pathname === "/runs") {
      return sendJson(response, 200, { active_run: activeRun, recent_runs: runHistory });
    }

    if (request.method === "GET" && url.pathname === "/artifacts") {
      return sendJson(response, 200, { artifacts: await loadArtifacts() });
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/dashboard")) {
      const overview = await loadOverview();
      const artifacts = await loadArtifacts();
      return sendHtml(response, renderDashboard(overview, artifacts));
    }

    if (request.method === "POST" && url.pathname.startsWith("/jobs/")) {
      const jobName = url.pathname.replace(/^\/jobs\//, "");
      await readRequestBody(request);
      const run = await spawnJob(jobName);
      return sendJson(response, 200, run);
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    const payload = error.run ? error.run : { error: error.message };
    sendJson(response, 500, payload);
  }
});

server.listen(port, host, () => {
  console.log(`RepoDocs AI control plane listening at http://${host}:${port}`);
});