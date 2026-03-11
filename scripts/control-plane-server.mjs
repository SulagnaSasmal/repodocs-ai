import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { pathExists, repoRoot } from "./lib/docs-automation-utils.mjs";

const port = Number(process.env.REPODOCS_CONTROL_PLANE_PORT || 4312);
const host = process.env.REPODOCS_CONTROL_PLANE_HOST || "127.0.0.1";
const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
const configuredDataDir = process.env.REPODOCS_CONTROL_PLANE_DATA_DIR || ".control-plane";
const dataDir = path.isAbsolute(configuredDataDir)
  ? configuredDataDir
  : path.join(repoRoot, configuredDataDir);
const usersFilePath = path.join(dataDir, "users.json");
const queueStateFilePath = path.join(dataDir, "queue-state.json");
const bootstrapAdminUser = process.env.REPODOCS_CONTROL_PLANE_BOOTSTRAP_USER || "admin";
const bootstrapAdminDisplayName = process.env.REPODOCS_CONTROL_PLANE_BOOTSTRAP_DISPLAY_NAME || "RepoDocs Admin";
const bootstrapAdminKey = process.env.REPODOCS_CONTROL_PLANE_BOOTSTRAP_KEY || "";
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
let queuedRuns = [];
let runHistory = [];
let users = [];

function getAuthEnabled() {
  return users.some((user) =>
    user.status !== "disabled" && Array.isArray(user.api_keys) && user.api_keys.some((key) => !key.revoked_at)
  );
}

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function hashApiKey(apiKey) {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

function buildApiKey() {
  return `rdai_${crypto.randomBytes(24).toString("hex")}`;
}

function sanitizeKeyRecord(keyRecord) {
  return {
    id: keyRecord.id,
    label: keyRecord.label,
    key_hint: keyRecord.key_hint,
    created_at: keyRecord.created_at,
    last_used_at: keyRecord.last_used_at || null,
    revoked_at: keyRecord.revoked_at || null
  };
}

function sanitizeUser(user) {
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    status: user.status,
    created_at: user.created_at,
    updated_at: user.updated_at,
    api_keys: (user.api_keys || []).map(sanitizeKeyRecord)
  };
}

async function ensureDataDir() {
  await fs.mkdir(dataDir, { recursive: true });
}

async function readJsonFile(filePath, fallbackValue) {
  if (!(await pathExists(filePath))) {
    return fallbackValue;
  }

  const raw = await fs.readFile(filePath, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    return fallbackValue;
  }
}

async function writeJsonFile(filePath, payload) {
  await ensureDataDir();
  const tempFilePath = `${filePath}.tmp`;
  await fs.writeFile(tempFilePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  await fs.rename(tempFilePath, filePath);
}

async function persistUsers() {
  await writeJsonFile(usersFilePath, {
    version: 1,
    users
  });
}

async function persistQueueState() {
  await writeJsonFile(queueStateFilePath, {
    version: 1,
    active_run: activeRun,
    queued_runs: queuedRuns,
    run_history: runHistory
  });
}

function createApiKeyRecord(label = "default") {
  const plainTextKey = buildApiKey();
  return {
    plain_text_key: plainTextKey,
    record: {
      id: randomId("key"),
      label,
      key_hash: hashApiKey(plainTextKey),
      key_hint: plainTextKey.slice(-8),
      created_at: nowIso(),
      last_used_at: null,
      revoked_at: null
    }
  };
}

function createUserRecord({ username, displayName, role = "operator", status = "active" }) {
  return {
    id: randomId("user"),
    username,
    display_name: displayName || username,
    role,
    status,
    created_at: nowIso(),
    updated_at: nowIso(),
    api_keys: []
  };
}

function findUserById(userId) {
  return users.find((user) => user.id === userId) || null;
}

function issueKeyForUser(user, label = "default") {
  const keyBundle = createApiKeyRecord(label);
  user.api_keys.push(keyBundle.record);
  user.updated_at = nowIso();
  return keyBundle;
}

async function bootstrapAdminIfNeeded() {
  const hasAnyUsers = users.length > 0;
  if (hasAnyUsers || !bootstrapAdminKey) {
    return;
  }

  const adminUser = createUserRecord({
    username: bootstrapAdminUser,
    displayName: bootstrapAdminDisplayName,
    role: "admin"
  });
  adminUser.api_keys.push({
    id: randomId("key"),
    label: "bootstrap-admin",
    key_hash: hashApiKey(bootstrapAdminKey),
    key_hint: bootstrapAdminKey.slice(-8),
    created_at: nowIso(),
    last_used_at: null,
    revoked_at: null
  });
  users = [adminUser];
  await persistUsers();
}

async function loadPersistedState() {
  await ensureDataDir();

  const userState = await readJsonFile(usersFilePath, { version: 1, users: [] });
  users = Array.isArray(userState.users) ? userState.users : [];
  await bootstrapAdminIfNeeded();

  const queueState = await readJsonFile(queueStateFilePath, {
    version: 1,
    active_run: null,
    queued_runs: [],
    run_history: []
  });

  queuedRuns = Array.isArray(queueState.queued_runs) ? queueState.queued_runs : [];
  runHistory = Array.isArray(queueState.run_history) ? queueState.run_history : [];

  if (queueState.active_run) {
    const recoveredRun = {
      ...queueState.active_run,
      finished_at: nowIso(),
      status: "interrupted",
      stderr: `${queueState.active_run.stderr || ""}\nRecovered after process restart before completion.`.trim()
    };
    runHistory.unshift(recoveredRun);
    if (runHistory.length > 25) {
      runHistory.length = 25;
    }
  }

  activeRun = null;
  refreshQueuePositions();
  await persistQueueState();
}

const stateReady = loadPersistedState();

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload, null, 2));
}

function sendHtml(response, html) {
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  response.end(html);
}

function getPresentedApiKey(request) {
  const apiKeyHeader = String(request.headers["x-api-key"] || "").trim();
  if (apiKeyHeader) {
    return apiKeyHeader;
  }

  const authorization = String(request.headers.authorization || "").trim();
  const bearerMatch = authorization.match(/^Bearer\s+(.+)$/i);
  return bearerMatch ? bearerMatch[1].trim() : "";
}

async function findAuthenticatedPrincipal(request) {
  const presentedApiKey = getPresentedApiKey(request);
  if (!presentedApiKey) {
    return null;
  }

  const hashedApiKey = hashApiKey(presentedApiKey);

  for (const user of users) {
    if (user.status === "disabled") {
      continue;
    }

    for (const keyRecord of user.api_keys || []) {
      if (keyRecord.revoked_at) {
        continue;
      }

      if (keyRecord.key_hash === hashedApiKey) {
        keyRecord.last_used_at = nowIso();
        user.updated_at = nowIso();
        await persistUsers();
        return { user, key: keyRecord };
      }
    }
  }

  return null;
}

async function requireAuth(request, response) {
  const principal = await findAuthenticatedPrincipal(request);
  if (principal) {
    return principal;
  }

  if (!getAuthEnabled()) {
    return { user: null, key: null };
  }

  response.writeHead(401, {
    "Content-Type": "application/json; charset=utf-8",
    "WWW-Authenticate": 'Bearer realm="RepoDocs AI Control Plane"'
  });
  response.end(JSON.stringify({
    error: "Authentication required",
    auth_enabled: getAuthEnabled(),
    accepted_headers: ["Authorization: Bearer <token>", "X-API-Key: <token>"]
  }, null, 2));
  return null;
}

function requireAdmin(principal, response) {
  if (!principal?.user) {
    return true;
  }

  if (principal.user.role === "admin") {
    return true;
  }

  sendJson(response, 403, { error: "Admin role required" });
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

async function parseJsonBody(request) {
  const rawBody = await readRequestBody(request);
  if (!rawBody.trim()) {
    return {};
  }

  return JSON.parse(rawBody);
}

function createRun(jobName, requestedBy = "api", requestedByUser = null) {
  return {
    id: `${jobName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    job: jobName,
    requested_by: requestedBy,
    requested_by_user: requestedByUser ? {
      id: requestedByUser.id,
      username: requestedByUser.username,
      role: requestedByUser.role
    } : null,
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
    persistQueueState().catch((error) => {
      console.error("Failed to persist queue state for running job", error);
    });

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
      persistQueueState().catch((error) => {
        console.error("Failed to persist queue state after job completion", error);
      });
      processQueue().catch((error) => {
        console.error("Failed to continue queued job processing", error);
      });

      if (code === 0) {
        resolve(run);
      } else {
        reject(Object.assign(new Error(run.stderr || run.stdout || `Job '${jobName}' failed`), { run }));
      }
    });

    child.on("error", (error) => {
      run.finished_at = nowIso();
      run.status = "failed";
      run.exit_code = 1;
      run.stderr = `${run.stderr}\n${error.message}`.trim();
      runHistory.unshift(run);
      if (runHistory.length > 25) {
        runHistory.length = 25;
      }
      activeRun = null;
      persistQueueState().catch((persistError) => {
        console.error("Failed to persist queue state after process error", persistError);
      });
      reject(Object.assign(error, { run }));
    });
  });
}

function refreshQueuePositions() {
  queuedRuns.forEach((run, index) => {
    run.queue_position = index + (activeRun ? 2 : 1);
  });
}

function enqueueJob(jobName, requestedBy = "api", requestedByUser = null) {
  if (!(jobName in jobs)) {
    throw new Error(`Unknown job '${jobName}'`);
  }

  const run = createRun(jobName, requestedBy, requestedByUser);
  queuedRuns.push(run);
  refreshQueuePositions();
  persistQueueState().catch((error) => {
    console.error("Failed to persist queued jobs", error);
  });
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
  await persistQueueState();
  await executeRun(run).catch(() => {
    return null;
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
          <p>This service exposes validation, export, agent, analytics, and graph jobs through a small control plane intended for lightweight hosted deployment with durable queue state and per-user keys.</p>
          <label for="api-key">User API key</label>
          <input id="api-key" type="password" placeholder="Paste a user key or bearer token" />
          <div class="button-row">${jobButtons}</div>
          <div class="button-row">
            <button class="secondary" id="refresh">Refresh overview</button>
          </div>
        </article>
        <article class="card">
          <p class="status">Overview</p>
          <h2 id="overview-title">Loading overview…</h2>
          <p id="overview-status">Use a user API key to load protected run and artifact data.</p>
          <p>JSON endpoints: <code>/health</code>, <code>/jobs</code>, <code>/artifacts</code>, <code>/runs</code>, <code>/auth/status</code>, <code>/users</code></p>
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
          overviewStatus.textContent = authData.authenticated_user
            ? ('Signed in as ' + authData.authenticated_user.username + ' (' + authData.authenticated_user.role + ')')
            : 'Accepted headers: X-API-Key or Authorization: Bearer <token>.';
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
    await stateReady;
    const url = new URL(request.url || "/", `http://${request.headers.host || `${host}:${port}`}`);

    if (request.method === "GET" && url.pathname === "/health") {
      return sendJson(response, 200, {
        status: "ok",
        active_run: activeRun,
        queue_depth: queuedRuns.length,
        auth_enabled: getAuthEnabled(),
        durable_queue_storage: queueStateFilePath,
        user_store: usersFilePath,
        uptime_seconds: Math.round(process.uptime())
      });
    }

    if (request.method === "GET" && url.pathname === "/auth/status") {
      const principal = await findAuthenticatedPrincipal(request);
      return sendJson(response, 200, {
        auth_enabled: getAuthEnabled(),
        accepted_headers: ["Authorization: Bearer <token>", "X-API-Key: <token>"],
        provided_header: getPresentedApiKey(request) ? "present" : "absent",
        authenticated_user: principal?.user ? {
          id: principal.user.id,
          username: principal.user.username,
          role: principal.user.role
        } : null
      });
    }

    if (request.method === "GET" && url.pathname === "/jobs") {
      const principal = await requireAuth(request, response);
      if (!principal) {
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
      const principal = await requireAuth(request, response);
      if (!principal) {
        return;
      }
      return sendJson(response, 200, { active_run: activeRun, queued_runs: queuedRuns, recent_runs: runHistory });
    }

    if (request.method === "GET" && url.pathname === "/artifacts") {
      const principal = await requireAuth(request, response);
      if (!principal) {
        return;
      }
      return sendJson(response, 200, { artifacts: await loadArtifacts() });
    }

    if (request.method === "GET" && url.pathname === "/users") {
      const principal = await requireAuth(request, response);
      if (!principal) {
        return;
      }
      if (!requireAdmin(principal, response)) {
        return;
      }
      return sendJson(response, 200, { users: users.map(sanitizeUser) });
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/dashboard")) {
      return sendHtml(response, renderDashboard());
    }

    if (request.method === "POST" && url.pathname === "/users") {
      const principal = await requireAuth(request, response);
      if (!principal) {
        return;
      }
      if (!requireAdmin(principal, response)) {
        return;
      }

      const body = await parseJsonBody(request);
      const username = String(body.username || "").trim();
      if (!username) {
        return sendJson(response, 400, { error: "username is required" });
      }

      if (users.some((user) => user.username === username)) {
        return sendJson(response, 409, { error: `User '${username}' already exists` });
      }

      const role = body.role === "admin" ? "admin" : "operator";
      const user = createUserRecord({
        username,
        displayName: String(body.display_name || username).trim(),
        role
      });
      const keyBundle = issueKeyForUser(user, String(body.key_label || "default").trim() || "default");
      users.push(user);
      await persistUsers();
      return sendJson(response, 201, {
        user: sanitizeUser(user),
        api_key: keyBundle.plain_text_key
      });
    }

    if (request.method === "PATCH" && url.pathname.startsWith("/users/")) {
      const principal = await requireAuth(request, response);
      if (!principal) {
        return;
      }
      if (!requireAdmin(principal, response)) {
        return;
      }

      const userId = url.pathname.replace(/^\/users\//, "");
      const user = findUserById(userId);
      if (!user) {
        return sendJson(response, 404, { error: "User not found" });
      }

      const body = await parseJsonBody(request);
      if (body.display_name) {
        user.display_name = String(body.display_name).trim();
      }
      if (body.role === "admin" || body.role === "operator") {
        user.role = body.role;
      }
      if (body.status === "active" || body.status === "disabled") {
        user.status = body.status;
      }
      user.updated_at = nowIso();
      await persistUsers();
      return sendJson(response, 200, { user: sanitizeUser(user) });
    }

    if (request.method === "POST" && /^\/users\/[^/]+\/keys$/.test(url.pathname)) {
      const principal = await requireAuth(request, response);
      if (!principal) {
        return;
      }
      if (!requireAdmin(principal, response)) {
        return;
      }

      const userId = url.pathname.match(/^\/users\/([^/]+)\/keys$/)?.[1] || "";
      const user = findUserById(userId);
      if (!user) {
        return sendJson(response, 404, { error: "User not found" });
      }

      const body = await parseJsonBody(request);
      const keyBundle = issueKeyForUser(user, String(body.key_label || "rotated").trim() || "rotated");
      await persistUsers();
      return sendJson(response, 201, {
        user: sanitizeUser(user),
        api_key: keyBundle.plain_text_key
      });
    }

    if (request.method === "DELETE" && /^\/users\/[^/]+\/keys\/[^/]+$/.test(url.pathname)) {
      const principal = await requireAuth(request, response);
      if (!principal) {
        return;
      }
      if (!requireAdmin(principal, response)) {
        return;
      }

      const keyMatch = url.pathname.match(/^\/users\/([^/]+)\/keys\/([^/]+)$/);
      const user = findUserById(keyMatch?.[1] || "");
      if (!user) {
        return sendJson(response, 404, { error: "User not found" });
      }

      const keyRecord = (user.api_keys || []).find((candidate) => candidate.id === keyMatch?.[2]);
      if (!keyRecord) {
        return sendJson(response, 404, { error: "Key not found" });
      }

      keyRecord.revoked_at = nowIso();
      user.updated_at = nowIso();
      await persistUsers();
      return sendJson(response, 200, { user: sanitizeUser(user), revoked_key_id: keyRecord.id });
    }

    if (request.method === "POST" && url.pathname.startsWith("/jobs/")) {
      const principal = await requireAuth(request, response);
      if (!principal) {
        return;
      }
      const jobName = url.pathname.replace(/^\/jobs\//, "");
      await readRequestBody(request);
      const run = enqueueJob(
        jobName,
        principal.user?.username || request.socket.remoteAddress || "api",
        principal.user || null
      );
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

stateReady.then(() => {
  server.listen(port, host, () => {
    if (!getAuthEnabled()) {
      console.warn("RepoDocs AI control plane started without user API keys. Set REPODOCS_CONTROL_PLANE_BOOTSTRAP_KEY to bootstrap an admin user.");
    }
    console.log(`RepoDocs AI control plane listening at http://${host}:${port}`);
  });
}).catch((error) => {
  console.error("Failed to initialize RepoDocs AI control plane", error);
  process.exitCode = 1;
});