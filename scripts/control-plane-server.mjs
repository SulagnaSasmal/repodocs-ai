import crypto from "node:crypto";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { createClient } from "redis";
import { pathExists, repoRoot } from "./lib/docs-automation-utils.mjs";

const port = Number(process.env.REPODOCS_CONTROL_PLANE_PORT || 4312);
const host = process.env.REPODOCS_CONTROL_PLANE_HOST || "127.0.0.1";

// Job execution limits
const JOB_TIMEOUT_MS = Number(process.env.REPODOCS_JOB_TIMEOUT_MS || 5 * 60 * 1000); // 5 minutes
const JOB_MAX_RETRIES = Number(process.env.REPODOCS_JOB_MAX_RETRIES || 2);
const JOB_RETRY_BASE_DELAY_MS = Number(process.env.REPODOCS_JOB_RETRY_DELAY_MS || 2000);

// ---------------------------------------------------------------------------
// Structured logger
// Emits newline-delimited JSON so log aggregators (Logtail, Datadog, etc.) can
// parse fields without regex. Falls back to plain text in development if
// REPODOCS_LOG_FORMAT=text.
// ---------------------------------------------------------------------------
const LOG_FORMAT = process.env.REPODOCS_LOG_FORMAT || "json";

function log(level, message, extra = {}) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    message,
    worker: workerId,
    ...extra
  };
  const out = LOG_FORMAT === "json" ? JSON.stringify(entry) : `[${entry.ts}] ${level.toUpperCase()} ${message}${Object.keys(extra).length ? " " + JSON.stringify(extra) : ""}`;
  if (level === "error" || level === "warn") {
    process.stderr.write(out + "\n");
  } else {
    process.stdout.write(out + "\n");
  }
}
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
// A bootstrap key is chosen by a person, so it must be long and not a
// placeholder copied from the docs. Generate one with: openssl rand -hex 24
const MIN_BOOTSTRAP_KEY_LENGTH = 24;
const PLACEHOLDER_KEYS = new Set(["replace-me", "changeme", "change-me", "admin", "password", "secret"]);
const MAX_BODY_BYTES = Number(process.env.REPODOCS_MAX_BODY_BYTES || 64 * 1024);
const MAX_RUN_OUTPUT_BYTES = 256 * 1024;
const RATE_LIMIT_WINDOW_MS = 60 * 1000;
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.REPODOCS_RATE_LIMIT_PER_MINUTE || 120);
const RATE_LIMIT_MAX_FAILED_AUTH = Number(process.env.REPODOCS_FAILED_AUTH_PER_MINUTE || 10);
const redisUrl = process.env.REDIS_URL || "redis://127.0.0.1:6379";
const workerId = `${process.pid}-${crypto.randomBytes(3).toString("hex")}`;
const queuePollTimeoutSeconds = 1;
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

const redisKeys = {
  users: "repodocs:control-plane:users",
  queue: "repodocs:control-plane:queue",
  runs: "repodocs:control-plane:runs",
  history: "repodocs:control-plane:history",
  running: "repodocs:control-plane:running"
};

const redis = createClient({ url: redisUrl });
// BLPOP holds its connection while it waits, so the worker gets its own;
// on the shared one every request would queue behind it for up to a second.
const blockingRedis = redis.duplicate();
// Without a listener, a dropped Redis connection is an unhandled 'error'
// event and takes the whole server down. The client reconnects by itself.
for (const [name, client] of [["shared", redis], ["worker", blockingRedis]]) {
  client.on("error", (error) => {
    if (!shutdownRequested) {
      log("error", "redis connection error", { connection: name, error: error.message });
    }
  });
}
let workerLoopStarted = false;
let shutdownRequested = false;

function nowIso() {
  return new Date().toISOString();
}

function randomId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
}

function hashApiKey(apiKey) {
  return crypto.createHash("sha256").update(apiKey).digest("hex");
}

function hashesMatch(storedHash, presentedHash) {
  const left = Buffer.from(String(storedHash || ""), "utf8");
  const right = Buffer.from(String(presentedHash || ""), "utf8");
  return left.length === right.length && crypto.timingSafeEqual(left, right);
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
    service_scope: user.service_scope || "",
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

function createUserRecord({ username, displayName, role = "operator", status = "active", serviceScope = "" }) {
  return {
    id: randomId("user"),
    username,
    display_name: displayName || username,
    role,
    status,
    // service_scope restricts this user to jobs whose name contains the scope string.
    // Empty string means unrestricted access to all jobs (admin behaviour).
    service_scope: serviceScope,
    created_at: nowIso(),
    updated_at: nowIso(),
    api_keys: []
  };
}

function createRun(jobName, requestedBy = "api", requestedByUser = null) {
  return {
    id: `${jobName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    job: jobName,
    requested_by: requestedBy,
    requested_by_user: requestedByUser
      ? {
          id: requestedByUser.id,
          username: requestedByUser.username,
          role: requestedByUser.role
        }
      : null,
    accepted_at: nowIso(),
    started_at: null,
    finished_at: null,
    status: "queued",
    exit_code: null,
    queue_position: null,
    stdout: "",
    stderr: "",
    worker_id: null
  };
}

async function getUsers() {
  const raw = await redis.get(redisKeys.users);
  if (!raw) {
    return [];
  }

  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

async function setUsers(users) {
  await redis.set(redisKeys.users, JSON.stringify(users));
}

async function getRun(runId) {
  const raw = await redis.hGet(redisKeys.runs, runId);
  if (!raw) {
    return null;
  }

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function saveRun(run) {
  await redis.hSet(redisKeys.runs, run.id, JSON.stringify(run));
}

async function getQueueRunIds() {
  return redis.lRange(redisKeys.queue, 0, -1);
}

async function getQueuedRuns() {
  const runIds = await getQueueRunIds();
  const runs = [];

  for (let index = 0; index < runIds.length; index += 1) {
    const run = await getRun(runIds[index]);
    if (!run) {
      continue;
    }
    run.queue_position = index + 1;
    runs.push(run);
  }

  return runs;
}

async function getRecentRuns() {
  const runIds = await redis.lRange(redisKeys.history, 0, 24);
  const runs = [];

  for (const runId of runIds) {
    const run = await getRun(runId);
    if (run) {
      runs.push(run);
    }
  }

  return runs;
}

async function getActiveRuns() {
  const entries = await redis.hGetAll(redisKeys.running);
  const runs = [];

  for (const runId of Object.keys(entries)) {
    const run = await getRun(runId);
    if (run && run.status === "running") {
      runs.push(run);
    }
  }

  runs.sort((left, right) => String(left.started_at || "").localeCompare(String(right.started_at || "")));
  return runs;
}

async function getPrimaryActiveRun() {
  const activeRuns = await getActiveRuns();
  return activeRuns[0] || null;
}

async function getAuthEnabled() {
  const users = await getUsers();
  return users.some((user) =>
    user.status !== "disabled" && Array.isArray(user.api_keys) && user.api_keys.some((key) => !key.revoked_at)
  );
}

async function findUserById(userId) {
  const users = await getUsers();
  return users.find((user) => user.id === userId) || null;
}

async function updateUser(userId, updater) {
  const users = await getUsers();
  const index = users.findIndex((candidate) => candidate.id === userId);
  if (index < 0) {
    return null;
  }

  const updatedUser = updater(users[index]);
  users[index] = updatedUser;
  await setUsers(users);
  return updatedUser;
}

function issueKeyForUser(user, label = "default") {
  const keyBundle = createApiKeyRecord(label);
  user.api_keys.push(keyBundle.record);
  user.updated_at = nowIso();
  return keyBundle;
}

function bootstrapKeyProblem(key) {
  if (!key) {
    return null;
  }
  if (PLACEHOLDER_KEYS.has(key.trim().toLowerCase())) {
    return `REPODOCS_CONTROL_PLANE_BOOTSTRAP_KEY is the placeholder '${key}'. Set a random value, for example: openssl rand -hex 24`;
  }
  if (key.length < MIN_BOOTSTRAP_KEY_LENGTH) {
    return `REPODOCS_CONTROL_PLANE_BOOTSTRAP_KEY must be at least ${MIN_BOOTSTRAP_KEY_LENGTH} characters. Generate one with: openssl rand -hex 24`;
  }
  return null;
}

async function bootstrapAdminIfNeeded() {
  const users = await getUsers();
  if (users.length > 0 || !bootstrapAdminKey) {
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
  await setUsers([adminUser]);
}

async function migrateFileStateToRedisIfNeeded() {
  await ensureDataDir();

  const currentUsers = await getUsers();
  if (currentUsers.length === 0) {
    const userState = await readJsonFile(usersFilePath, { version: 1, users: [] });
    if (Array.isArray(userState.users) && userState.users.length > 0) {
      await setUsers(userState.users);
    }
  }

  const hasRuns = await redis.hLen(redisKeys.runs);
  const hasQueue = await redis.lLen(redisKeys.queue);
  const hasHistory = await redis.lLen(redisKeys.history);
  if (hasRuns > 0 || hasQueue > 0 || hasHistory > 0) {
    return;
  }

  const queueState = await readJsonFile(queueStateFilePath, {
    version: 1,
    active_run: null,
    queued_runs: [],
    run_history: []
  });

  const pipeline = redis.multi();
  for (const queuedRun of Array.isArray(queueState.queued_runs) ? queueState.queued_runs : []) {
    pipeline.hSet(redisKeys.runs, queuedRun.id, JSON.stringify({ ...queuedRun, status: "queued" }));
    pipeline.rPush(redisKeys.queue, queuedRun.id);
  }

  if (queueState.active_run?.id) {
    const interruptedRun = {
      ...queueState.active_run,
      worker_id: "migration",
      status: "interrupted",
      finished_at: nowIso(),
      stderr: `${queueState.active_run.stderr || ""}\nRecovered from legacy filesystem queue state during Redis migration.`.trim()
    };
    pipeline.hSet(redisKeys.runs, interruptedRun.id, JSON.stringify(interruptedRun));
    pipeline.lPush(redisKeys.history, interruptedRun.id);
  }

  for (const historicalRun of Array.isArray(queueState.run_history) ? queueState.run_history : []) {
    pipeline.hSet(redisKeys.runs, historicalRun.id, JSON.stringify(historicalRun));
    pipeline.rPush(redisKeys.history, historicalRun.id);
  }

  pipeline.lTrim(redisKeys.history, 0, 24);
  await pipeline.exec();
}

// Headers on every response. Responses can carry API keys, so nothing is cached.
const baseSecurityHeaders = {
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "no-referrer",
  "Cache-Control": "no-store",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
};

function sendJson(response, statusCode, payload, extraHeaders = {}) {
  response.writeHead(statusCode, { ...baseSecurityHeaders, "Content-Type": "application/json; charset=utf-8", ...extraHeaders });
  response.end(JSON.stringify(payload, null, 2));
}

function sendHtml(response, html, nonce) {
  response.writeHead(200, {
    ...baseSecurityHeaders,
    "Content-Type": "text/html; charset=utf-8",
    // The dashboard's one script runs by nonce; nothing else may load or run.
    "Content-Security-Policy": [
      "default-src 'none'",
      `script-src 'nonce-${nonce}'`,
      "style-src 'unsafe-inline'",
      "connect-src 'self'",
      "img-src 'self'",
      "base-uri 'none'",
      "form-action 'none'",
      "frame-ancestors 'none'"
    ].join("; ")
  });
  response.end(html);
}

class HttpError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

function isLoopback(request) {
  const address = request.socket.remoteAddress || "";
  return address === "127.0.0.1" || address === "::1" || address === "::ffff:127.0.0.1";
}

// Fixed-window limits per client address, kept in memory for this process.
const rateWindows = new Map();

function overLimit(request, kind, limit) {
  const key = `${kind}:${request.socket.remoteAddress || "unknown"}`;
  const now = Date.now();
  const window = rateWindows.get(key);
  if (!window || now - window.started >= RATE_LIMIT_WINDOW_MS) {
    rateWindows.set(key, { started: now, count: 1 });
    return false;
  }
  window.count += 1;
  return window.count > limit;
}

function countFailedAuth(request) {
  overLimit(request, "failed-auth", RATE_LIMIT_MAX_FAILED_AUTH);
}

function failedAuthBlocked(request) {
  const window = rateWindows.get(`failed-auth:${request.socket.remoteAddress || "unknown"}`);
  return Boolean(window && Date.now() - window.started < RATE_LIMIT_WINDOW_MS && window.count >= RATE_LIMIT_MAX_FAILED_AUTH);
}

setInterval(() => {
  const now = Date.now();
  for (const [key, window] of rateWindows) {
    if (now - window.started >= RATE_LIMIT_WINDOW_MS) {
      rateWindows.delete(key);
    }
  }
}, RATE_LIMIT_WINDOW_MS).unref();

function appendCapped(current, chunk) {
  const next = current + chunk;
  if (next.length <= MAX_RUN_OUTPUT_BYTES) {
    return next;
  }
  return `[output truncated to the last ${MAX_RUN_OUTPUT_BYTES} characters]\n${next.slice(-MAX_RUN_OUTPUT_BYTES)}`;
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
  const users = await getUsers();

  for (const user of users) {
    if (user.status === "disabled") {
      continue;
    }

    for (const keyRecord of user.api_keys || []) {
      if (keyRecord.revoked_at) {
        continue;
      }

      if (hashesMatch(keyRecord.key_hash, hashedApiKey)) {
        keyRecord.last_used_at = nowIso();
        user.updated_at = nowIso();
        await setUsers(users);
        return { user, key: keyRecord };
      }
    }
  }

  return null;
}

async function requireAuth(request, response) {
  if (failedAuthBlocked(request)) {
    sendJson(response, 429, { error: "Too many failed authentication attempts. Try again in a minute." }, { "Retry-After": "60" });
    return null;
  }

  const principal = await findAuthenticatedPrincipal(request);
  if (principal) {
    return principal;
  }

  if (!(await getAuthEnabled())) {
    // No keys exist yet. Only this machine may use the API until a bootstrap
    // key is set; otherwise anyone who can reach the port could make
    // themselves admin.
    if (isLoopback(request)) {
      return { user: null, key: null };
    }
    sendJson(response, 503, {
      error: "Authentication is not configured. Set REPODOCS_CONTROL_PLANE_BOOTSTRAP_KEY and restart; until then only requests from this machine are accepted."
    });
    return null;
  }

  if (getPresentedApiKey(request)) {
    countFailedAuth(request);
  }

  response.writeHead(401, {
    "Content-Type": "application/json; charset=utf-8",
    "WWW-Authenticate": 'Bearer realm="RepoDocs AI Control Plane"'
  });
  response.end(JSON.stringify({
    error: "Authentication required",
    auth_enabled: true,
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
    const declared = Number(request.headers["content-length"] || 0);
    if (declared > MAX_BODY_BYTES) {
      reject(new HttpError(413, `Request body is larger than ${MAX_BODY_BYTES} bytes`));
      request.resume();
      return;
    }
    let body = "";
    let received = 0;
    let tooLarge = false;
    request.on("data", (chunk) => {
      received += chunk.length;
      if (received > MAX_BODY_BYTES) {
        tooLarge = true;
        return;
      }
      body += chunk.toString();
    });
    request.on("end", () => (tooLarge ? reject(new HttpError(413, `Request body is larger than ${MAX_BODY_BYTES} bytes`)) : resolve(body)));
    request.on("error", reject);
  });
}

async function parseJsonBody(request) {
  const rawBody = await readRequestBody(request);
  if (!rawBody.trim()) {
    return {};
  }

  try {
    const parsed = JSON.parse(rawBody);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("not an object");
    }
    return parsed;
  } catch {
    throw new HttpError(400, "Request body must be a JSON object");
  }
}

// Plain-text fields people type: trimmed, no control characters, bounded length.
function cleanText(value, maxLength = 80) {
  return String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, maxLength);
}

const USERNAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

// service_scope lists the job names a user may run, comma separated.
function scopeAllows(serviceScope, jobName) {
  const allowed = String(serviceScope || "").split(",").map((entry) => entry.trim()).filter(Boolean);
  return allowed.length === 0 || allowed.includes(jobName);
}

function isLastActiveAdmin(users, userId) {
  const admins = users.filter((user) => user.role === "admin" && user.status !== "disabled");
  return admins.length === 1 && admins[0].id === userId;
}

async function enqueueJob(jobName, requestedBy = "api", requestedByUser = null) {
  if (!Object.hasOwn(jobs, jobName)) {
    throw new HttpError(404, `Unknown job '${jobName}'`);
  }

  const run = createRun(jobName, requestedBy, requestedByUser);
  await saveRun(run);
  await redis.rPush(redisKeys.queue, run.id);
  return run;
}

async function appendRunHistory(run) {
  await saveRun(run);
  await redis.multi().lPush(redisKeys.history, run.id).lTrim(redisKeys.history, 0, 24).exec();
}

async function markRunStarted(run) {
  run.started_at = nowIso();
  run.status = "running";
  run.queue_position = 0;
  run.worker_id = workerId;
  await redis.multi().hSet(redisKeys.runs, run.id, JSON.stringify(run)).hSet(redisKeys.running, run.id, workerId).exec();
}

async function markRunFinished(run, exitCode, stderrAppend = "") {
  run.finished_at = nowIso();
  run.exit_code = exitCode;
  run.status = exitCode === 0 ? "succeeded" : "failed";
  if (stderrAppend) {
    run.stderr = `${run.stderr}\n${stderrAppend}`.trim();
  }
  await redis.multi().hDel(redisKeys.running, run.id).hSet(redisKeys.runs, run.id, JSON.stringify(run)).exec();
  await appendRunHistory(run);
}

async function executeRun(run) {
  const jobName = run.job;
  if (!Object.hasOwn(jobs, jobName)) {
    throw new Error(`Unknown job '${jobName}'`);
  }

  await markRunStarted(run);
  log("info", "job started", { run_id: run.id, job: jobName });

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

    // Job timeout — kill the child process if the job runs too long
    const timeoutHandle = setTimeout(async () => {
      child.kill("SIGTERM");
      const msg = `Job '${jobName}' timed out after ${JOB_TIMEOUT_MS}ms`;
      log("warn", "job timed out", { run_id: run.id, job: jobName, timeout_ms: JOB_TIMEOUT_MS });
      try {
        await markRunFinished(run, 1, msg);
      } catch {
        // ignore persistence error; the timeout error takes precedence
      }
      reject(Object.assign(new Error(msg), { run, timed_out: true }));
    }, JOB_TIMEOUT_MS);

    child.stdout.on("data", (chunk) => {
      run.stdout = appendCapped(run.stdout, chunk.toString());
    });

    child.stderr.on("data", (chunk) => {
      run.stderr = appendCapped(run.stderr, chunk.toString());
    });

    child.on("exit", async (code) => {
      clearTimeout(timeoutHandle);
      try {
        await markRunFinished(run, code ?? 1);
        if ((code ?? 1) === 0) {
          log("info", "job succeeded", { run_id: run.id, job: jobName });
          resolve(run);
          return;
        }
        log("warn", "job failed", { run_id: run.id, job: jobName, exit_code: code ?? 1 });
        reject(Object.assign(new Error(run.stderr || run.stdout || `Job '${jobName}' failed`), { run }));
      } catch (error) {
        reject(error);
      }
    });

    child.on("error", async (error) => {
      clearTimeout(timeoutHandle);
      log("error", "job spawn error", { run_id: run.id, job: jobName, error: error.message });
      try {
        await markRunFinished(run, 1, error.message);
      } catch {
        // ignore secondary persistence errors here and return the original process error
      }
      reject(Object.assign(error, { run }));
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

function renderDashboard(nonce) {
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
      :root { color-scheme: light; }
      body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; background: linear-gradient(180deg, #f5efe6 0%, #efe8de 100%); color: #1f1a14; }
      main { max-width: 1240px; margin: 0 auto; padding: 28px 24px 64px; }
      .hero, .grid { display: grid; gap: 20px; }
      .hero { grid-template-columns: 2fr 1fr; }
      .grid { grid-template-columns: 1fr 1fr; margin-top: 20px; }
      .panel, .card { background: rgba(255, 250, 243, 0.95); border: 1px solid #e5d7bd; border-radius: 20px; padding: 20px; box-shadow: 0 10px 30px rgba(81, 52, 15, 0.08); }
      .status { font-size: 13px; text-transform: uppercase; letter-spacing: 0.08em; color: #7e6e5d; }
      h1, h2, h3 { margin-top: 0; }
      .button-row, .form-grid { display: flex; flex-wrap: wrap; gap: 10px; }
      .form-grid { margin-top: 14px; }
      .field { display: grid; gap: 6px; min-width: 180px; flex: 1; }
      .field.compact { min-width: 120px; }
      input, select { width: 100%; box-sizing: border-box; padding: 11px 12px; border-radius: 12px; border: 1px solid #ccb89a; background: white; }
      button { border: 0; border-radius: 999px; padding: 11px 16px; background: #99611f; color: white; cursor: pointer; }
      button.secondary { background: #4d5b6a; }
      button.ghost { background: #e6d7bf; color: #533918; }
      button.warn { background: #8b3a22; }
      pre { padding: 16px; border-radius: 16px; background: #1f1a14; color: #f7ecdc; overflow: auto; }
      code { background: rgba(31, 26, 20, 0.08); padding: 2px 6px; border-radius: 6px; }
      ul { padding-left: 18px; }
      .pill { display: inline-block; padding: 4px 10px; border-radius: 999px; background: #e8dbc6; font-size: 12px; margin-right: 8px; }
      .user-card { border: 1px solid #eadbc6; border-radius: 16px; padding: 16px; margin-top: 12px; background: #fffdf9; }
      .user-head { display: flex; justify-content: space-between; gap: 12px; align-items: center; }
      .keys { margin-top: 10px; display: grid; gap: 8px; }
      .key-row { display: flex; justify-content: space-between; gap: 12px; align-items: center; padding: 10px 12px; border-radius: 12px; background: #f4ede2; }
      .muted { color: #726454; }
      .flash { margin-top: 12px; min-height: 20px; color: #5f3c16; }
      @media (max-width: 900px) { .hero, .grid { grid-template-columns: 1fr; } .user-head, .key-row { flex-direction: column; align-items: flex-start; } }
    </style>
  </head>
  <body>
    <main>
      <section class="hero">
        <article class="panel">
          <p class="status">Hosted Control Plane</p>
          <h1>RepoDocs AI automation runs behind an HTTP endpoint with shared Redis state.</h1>
          <p>This service exposes validation, export, agent, analytics, and graph jobs through a small control plane intended for lightweight hosted deployment with Redis-backed queue persistence and per-user API keys.</p>
          <div class="field">
            <label for="api-key">User API key</label>
            <input id="api-key" type="password" placeholder="Paste a user key or bearer token" />
          </div>
          <div class="button-row" style="margin-top: 16px;">${jobButtons}</div>
          <div class="button-row" style="margin-top: 12px;">
            <button class="secondary" id="refresh">Refresh overview</button>
          </div>
          <div class="flash" id="flash"></div>
        </article>
        <article class="card">
          <p class="status">Overview</p>
          <h2 id="overview-title">Loading overview…</h2>
          <p id="overview-status">Use a user API key to load protected run, artifact, and admin data.</p>
          <p>JSON endpoints: <code>/health</code>, <code>/jobs</code>, <code>/artifacts</code>, <code>/runs</code>, <code>/auth/status</code>, <code>/users</code></p>
          <p class="muted" id="overview-storage">Redis-backed queue and user store.</p>
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
        <p class="status">Admin</p>
        <h2>User and key management</h2>
        <p class="muted">Create users, change roles and status, rotate keys, and revoke old credentials without leaving the control plane.</p>
        <div class="form-grid">
          <div class="field"><label for="new-username">Username</label><input id="new-username" placeholder="operator2" /></div>
          <div class="field"><label for="new-display-name">Display name</label><input id="new-display-name" placeholder="Operator Two" /></div>
          <div class="field compact"><label for="new-role">Role</label><select id="new-role"><option value="operator">operator</option><option value="admin">admin</option></select></div>
          <div class="field"><label for="new-key-label">Initial key label</label><input id="new-key-label" value="initial" /></div>
        </div>
        <div class="button-row" style="margin-top: 12px;">
          <button id="create-user">Create user</button>
        </div>
        <div id="users" style="margin-top: 16px;"><p>No users loaded yet.</p></div>
      </section>

      <section class="card" style="margin-top: 20px;">
        <p class="status">Response</p>
        <pre id="response">POST /jobs/:name and admin actions will stream metadata here.</pre>
      </section>
    </main>
    <script nonce="${nonce}">
      const apiKeyInput = document.getElementById('api-key');
      const response = document.getElementById('response');
      const flash = document.getElementById('flash');
      const overviewTitle = document.getElementById('overview-title');
      const overviewStatus = document.getElementById('overview-status');
      const overviewStorage = document.getElementById('overview-storage');
      const recentRuns = document.getElementById('recent-runs');
      const artifacts = document.getElementById('artifacts');
      const users = document.getElementById('users');

      // The key lives only as long as this browser tab.
      apiKeyInput.value = sessionStorage.getItem('repodocsApiKey') || '';

      // Every value from the API is escaped before it goes into HTML.
      function esc(value) {
        return String(value == null ? '' : value)
          .replace(/&/g, '&amp;')
          .replace(/</g, '&lt;')
          .replace(/>/g, '&gt;')
          .replace(/"/g, '&quot;')
          .replace(/'/g, '&#39;');
      }

      function headers() {
        const key = apiKeyInput.value.trim();
        sessionStorage.setItem('repodocsApiKey', key);
        return key ? { 'X-API-Key': key, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' };
      }

      function showFlash(message) {
        flash.textContent = message || '';
      }

      function renderList(items, emptyText, formatter) {
        if (!items || items.length === 0) {
          return '<p>' + esc(emptyText) + '</p>';
        }
        return '<ul>' + items.map(formatter).join('') + '</ul>';
      }

      function userCard(user) {
        const keys = (user.api_keys || []).map((key) => {
          const revokeButton = key.revoked_at
            ? '<span class="pill">revoked</span>'
            : '<button class="warn" data-action="revoke-key" data-user-id="' + esc(user.id) + '" data-key-id="' + esc(key.id) + '">Revoke</button>';
          return '<div class="key-row">'
            + '<div><strong>' + esc(key.label) + '</strong> <span class="pill">••••' + esc(key.key_hint) + '</span><div class="muted">created ' + esc(key.created_at) + (key.last_used_at ? ' • used ' + esc(key.last_used_at) : '') + '</div></div>'
            + '<div>' + revokeButton + '</div>'
            + '</div>';
        }).join('');

        return '<article class="user-card">'
          + '<div class="user-head">'
          + '<div><h3>' + esc(user.display_name) + '</h3><p class="muted">@' + esc(user.username) + ' • ' + esc(user.id) + '</p></div>'
          + '<div><span class="pill">' + esc(user.role) + '</span><span class="pill">' + esc(user.status) + '</span></div>'
          + '</div>'
          + '<div class="form-grid">'
          + '<div class="field"><label>Display name</label><input data-field="display_name" data-user-id="' + esc(user.id) + '" value="' + esc(user.display_name) + '" /></div>'
          + '<div class="field compact"><label>Role</label><select data-field="role" data-user-id="' + esc(user.id) + '"><option value="operator"' + (user.role === 'operator' ? ' selected' : '') + '>operator</option><option value="admin"' + (user.role === 'admin' ? ' selected' : '') + '>admin</option></select></div>'
          + '<div class="field compact"><label>Status</label><select data-field="status" data-user-id="' + esc(user.id) + '"><option value="active"' + (user.status === 'active' ? ' selected' : '') + '>active</option><option value="disabled"' + (user.status === 'disabled' ? ' selected' : '') + '>disabled</option></select></div>'
          + '<div class="field"><label>New key label</label><input data-field="key_label" data-user-id="' + esc(user.id) + '" value="rotated" /></div>'
          + '</div>'
          + '<div class="button-row" style="margin-top: 12px;">'
          + '<button class="ghost" data-action="save-user" data-user-id="' + esc(user.id) + '">Save user</button>'
          + '<button data-action="rotate-key" data-user-id="' + esc(user.id) + '">Rotate key</button>'
          + '</div>'
          + '<div class="keys">' + (keys || '<p class="muted">No keys issued yet.</p>') + '</div>'
          + '</article>';
      }

      async function apiRequest(path, options) {
        const result = await fetch(path, { ...options, headers: { ...headers(), ...(options && options.headers ? options.headers : {}) } });
        const text = await result.text();
        response.textContent = text;
        let parsed = null;
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
        if (!result.ok) {
          throw new Error(typeof parsed === 'string' ? parsed : (parsed.error || text));
        }
        return parsed;
      }

      async function refreshOverview() {
        try {
          const [authData, jobsData, runsData, artifactsData, usersData] = await Promise.all([
            fetch('/auth/status', { headers: headers() }).then((result) => result.json()),
            apiRequest('/jobs'),
            apiRequest('/runs'),
            apiRequest('/artifacts'),
            apiRequest('/users')
          ]);

          overviewTitle.textContent = authData.auth_enabled
            ? (((jobsData.active_run ? 'Active: ' + jobsData.active_run.job : 'No active run')) + ' • ' + jobsData.queue_depth + ' queued')
            : 'Auth disabled • local development mode';
          overviewStatus.textContent = authData.authenticated_user
            ? ('Signed in as ' + authData.authenticated_user.username + ' (' + authData.authenticated_user.role + ')')
            : 'Accepted headers: X-API-Key or Authorization: Bearer <token>.';
          overviewStorage.textContent = 'Redis-backed queue/users • queue depth ' + jobsData.queue_depth + ' • workers ' + ((jobsData.active_runs || []).length || 0);

          recentRuns.innerHTML = renderList(
            (runsData.active_runs || []).concat(runsData.queued_runs || []).concat(runsData.recent_runs || []),
            'No runs available yet.',
            (run) => '<li><strong>' + esc(run.job) + '</strong> ' + esc(run.status) + (run.queue_position ? ' (queue #' + esc(run.queue_position) + ')' : '') + (run.worker_id ? ' • ' + esc(run.worker_id) : '') + '</li>'
          );

          artifacts.innerHTML = renderList(
            artifactsData.artifacts || [],
            'No artifacts available yet.',
            (artifact) => '<li><strong>' + esc(artifact.path) + '</strong></li>'
          );

          users.innerHTML = (usersData.users || []).length
            ? usersData.users.map(userCard).join('')
            : '<p>No users available yet.</p>';
          bindUserActions();
          showFlash('');
        } catch (error) {
          overviewTitle.textContent = 'Protected endpoints require a valid admin API key';
          overviewStatus.textContent = error.message;
          recentRuns.innerHTML = '<p>Run data unavailable.</p>';
          artifacts.innerHTML = '<p>Artifact data unavailable.</p>';
          users.innerHTML = '<p>User data unavailable.</p>';
        }
      }

      async function createUser() {
        const payload = {
          username: document.getElementById('new-username').value.trim(),
          display_name: document.getElementById('new-display-name').value.trim(),
          role: document.getElementById('new-role').value,
          key_label: document.getElementById('new-key-label').value.trim() || 'initial'
        };
        const result = await apiRequest('/users', { method: 'POST', body: JSON.stringify(payload) });
        showFlash('Created user ' + result.user.username + '. New key: ' + result.api_key);
        await refreshOverview();
      }

      async function saveUser(userId) {
        const payload = {
          display_name: document.querySelector('[data-field="display_name"][data-user-id="' + CSS.escape(userId) + '"]').value.trim(),
          role: document.querySelector('[data-field="role"][data-user-id="' + CSS.escape(userId) + '"]').value,
          status: document.querySelector('[data-field="status"][data-user-id="' + CSS.escape(userId) + '"]').value
        };
        await apiRequest('/users/' + encodeURIComponent(userId), { method: 'PATCH', body: JSON.stringify(payload) });
        showFlash('Updated user ' + userId + '.');
        await refreshOverview();
      }

      async function rotateKey(userId) {
        const keyLabel = document.querySelector('[data-field="key_label"][data-user-id="' + CSS.escape(userId) + '"]').value.trim() || 'rotated';
        const result = await apiRequest('/users/' + encodeURIComponent(userId) + '/keys', { method: 'POST', body: JSON.stringify({ key_label: keyLabel }) });
        showFlash('Issued new key for ' + result.user.username + ': ' + result.api_key);
        await refreshOverview();
      }

      async function revokeKey(userId, keyId) {
        await apiRequest('/users/' + encodeURIComponent(userId) + '/keys/' + encodeURIComponent(keyId), { method: 'DELETE' });
        showFlash('Revoked key ' + keyId + '.');
        await refreshOverview();
      }

      function bindUserActions() {
        document.querySelectorAll('[data-action="save-user"]').forEach((button) => {
          button.addEventListener('click', () => saveUser(button.dataset.userId).catch((error) => showFlash(error.message)));
        });
        document.querySelectorAll('[data-action="rotate-key"]').forEach((button) => {
          button.addEventListener('click', () => rotateKey(button.dataset.userId).catch((error) => showFlash(error.message)));
        });
        document.querySelectorAll('[data-action="revoke-key"]').forEach((button) => {
          button.addEventListener('click', () => revokeKey(button.dataset.userId, button.dataset.keyId).catch((error) => showFlash(error.message)));
        });
      }

      document.getElementById('refresh').addEventListener('click', () => refreshOverview().catch((error) => showFlash(error.message)));
      document.getElementById('create-user').addEventListener('click', () => createUser().catch((error) => showFlash(error.message)));
      document.querySelectorAll('button[data-job]').forEach((button) => {
        button.addEventListener('click', async () => {
          try {
            const job = button.dataset.job;
            showFlash('Queueing ' + job + '...');
            await apiRequest('/jobs/' + job, { method: 'POST' });
            await refreshOverview();
          } catch (error) {
            showFlash(error.message);
          }
        });
      });
      refreshOverview();
    </script>
  </body>
</html>`;
}

async function executeRunWithRetry(run) {
  let attempt = 0;
  while (attempt <= JOB_MAX_RETRIES) {
    try {
      await executeRun(run);
      return; // success
    } catch (error) {
      const isTimedOut = error.timed_out === true;
      // Do not retry timed-out jobs — they likely have side effects
      if (isTimedOut || attempt >= JOB_MAX_RETRIES) {
        log("error", "job exhausted retries", {
          run_id: run.id,
          job: run.job,
          attempt,
          max_retries: JOB_MAX_RETRIES,
          error: error.message,
          timed_out: isTimedOut
        });
        return;
      }
      attempt += 1;
      const delay = JOB_RETRY_BASE_DELAY_MS * (2 ** (attempt - 1)); // exponential backoff
      log("warn", "job retrying", {
        run_id: run.id,
        job: run.job,
        attempt,
        delay_ms: delay
      });
      // Reset run state to queued for the retry
      run.status = "queued";
      run.started_at = null;
      run.finished_at = null;
      run.exit_code = null;
      run.stdout = "";
      run.stderr = "";
      await saveRun(run);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function startWorkerLoop() {
  if (workerLoopStarted) {
    return;
  }

  workerLoopStarted = true;
  log("info", "worker loop started", { worker: workerId });

  while (!shutdownRequested) {
    try {
      const next = await blockingRedis.blPop(redisKeys.queue, queuePollTimeoutSeconds);
      if (!next?.element) {
        continue;
      }

      const run = await getRun(next.element);
      if (!run || run.status !== "queued") {
        continue;
      }

      await executeRunWithRetry(run);
    } catch (error) {
      log("error", "worker loop error", { error: error.message });
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }

  log("info", "worker loop stopped", { worker: workerId });
}

async function shutdown() {
  shutdownRequested = true;
  for (const client of [blockingRedis, redis]) {
    try {
      await client.quit();
    } catch {
      await client.disconnect().catch(() => {});
    }
  }
}

const stateReady = (async () => {
  const keyProblem = bootstrapKeyProblem(bootstrapAdminKey);
  if (keyProblem) {
    throw new Error(keyProblem);
  }
  await redis.connect();
  await blockingRedis.connect();
  await migrateFileStateToRedisIfNeeded();
  await bootstrapAdminIfNeeded();
  startWorkerLoop().catch((error) => {
    log("error", "failed to start control-plane worker loop", { error: error.message });
  });
})();

const server = http.createServer(async (request, response) => {
  try {
    await stateReady;
    // Parse the path only; the Host header is not trusted.
    const url = new URL(request.url || "/", "http://control-plane.local");

    if (url.pathname !== "/health" && overLimit(request, "requests", RATE_LIMIT_MAX_REQUESTS)) {
      return sendJson(response, 429, { error: "Too many requests. Try again in a minute." }, { "Retry-After": "60" });
    }

    if (request.method === "GET" && url.pathname === "/health") {
      // Public, so it says only whether the service is up: no run details,
      // user names, file paths or connection strings.
      return sendJson(response, 200, {
        status: "ok",
        queue_depth: await redis.lLen(redisKeys.queue),
        auth_enabled: await getAuthEnabled(),
        storage_backend: "redis",
        uptime_seconds: Math.round(process.uptime())
      });
    }

    if (request.method === "GET" && url.pathname === "/auth/status") {
      const principal = await findAuthenticatedPrincipal(request);
      return sendJson(response, 200, {
        auth_enabled: await getAuthEnabled(),
        accepted_headers: ["Authorization: Bearer <token>", "X-API-Key: <token>"],
        provided_header: getPresentedApiKey(request) ? "present" : "absent",
        authenticated_user: principal?.user
          ? {
              id: principal.user.id,
              username: principal.user.username,
              role: principal.user.role
            }
          : null
      });
    }

    if (request.method === "GET" && url.pathname === "/jobs") {
      const principal = await requireAuth(request, response);
      if (!principal) {
        return;
      }
      const activeRuns = await getActiveRuns();
      const queuedRuns = await getQueuedRuns();
      return sendJson(response, 200, {
        jobs: Object.keys(jobs),
        active_run: activeRuns[0] || null,
        active_runs: activeRuns,
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
      return sendJson(response, 200, {
        active_run: await getPrimaryActiveRun(),
        active_runs: await getActiveRuns(),
        queued_runs: await getQueuedRuns(),
        recent_runs: await getRecentRuns()
      });
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
      return sendJson(response, 200, { users: (await getUsers()).map(sanitizeUser) });
    }

    if (request.method === "GET" && (url.pathname === "/" || url.pathname === "/dashboard")) {
      const nonce = crypto.randomBytes(16).toString("base64");
      return sendHtml(response, renderDashboard(nonce), nonce);
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
      if (!USERNAME_PATTERN.test(username)) {
        return sendJson(response, 400, { error: "username is required: 1 to 64 letters, digits, dots, hyphens or underscores, starting with a letter or digit" });
      }

      const users = await getUsers();
      if (users.some((user) => user.username === username)) {
        return sendJson(response, 409, { error: `User '${username}' already exists` });
      }

      const role = body.role === "admin" ? "admin" : "operator";
      const serviceScope = cleanText(body.service_scope, 200);
      const user = createUserRecord({
        username,
        displayName: cleanText(body.display_name || username) || username,
        role,
        serviceScope
      });
      const keyBundle = issueKeyForUser(user, cleanText(body.key_label || "default", 40) || "default");
      users.push(user);
      await setUsers(users);
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
      const existingUser = await findUserById(userId);
      if (!existingUser) {
        return sendJson(response, 404, { error: "User not found" });
      }

      const body = await parseJsonBody(request);
      const demotesOrDisables = (body.role === "operator" && existingUser.role === "admin") || (body.status === "disabled" && existingUser.status !== "disabled");
      if (demotesOrDisables && isLastActiveAdmin(await getUsers(), userId)) {
        return sendJson(response, 409, { error: "This is the last active admin. Make another user admin first." });
      }
      const user = await updateUser(userId, (candidate) => {
        if (body.display_name) {
          candidate.display_name = cleanText(body.display_name) || candidate.display_name;
        }
        if (body.role === "admin" || body.role === "operator") {
          candidate.role = body.role;
        }
        if (body.status === "active" || body.status === "disabled") {
          candidate.status = body.status;
        }
        if (body.service_scope !== undefined) {
          candidate.service_scope = cleanText(body.service_scope, 200);
        }
        candidate.updated_at = nowIso();
        return candidate;
      });
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
      const existingUser = await findUserById(userId);
      if (!existingUser) {
        return sendJson(response, 404, { error: "User not found" });
      }

      const body = await parseJsonBody(request);
      let plainTextKey = "";
      const user = await updateUser(userId, (candidate) => {
        const keyBundle = issueKeyForUser(candidate, cleanText(body.key_label || "rotated", 40) || "rotated");
        plainTextKey = keyBundle.plain_text_key;
        return candidate;
      });
      return sendJson(response, 201, {
        user: sanitizeUser(user),
        api_key: plainTextKey
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
      const existingUser = await findUserById(keyMatch?.[1] || "");
      if (!existingUser) {
        return sendJson(response, 404, { error: "User not found" });
      }

      let revokedKeyId = "";
      const user = await updateUser(keyMatch?.[1] || "", (candidate) => {
        const keyRecord = (candidate.api_keys || []).find((entry) => entry.id === keyMatch?.[2]);
        if (!keyRecord) {
          throw new Error("KEY_NOT_FOUND");
        }
        keyRecord.revoked_at = nowIso();
        candidate.updated_at = nowIso();
        revokedKeyId = keyRecord.id;
        return candidate;
      }).catch((error) => {
        if (error.message === "KEY_NOT_FOUND") {
          return null;
        }
        throw error;
      });

      if (!user) {
        return sendJson(response, 404, { error: "Key not found" });
      }

      return sendJson(response, 200, { user: sanitizeUser(user), revoked_key_id: revokedKeyId });
    }

    if (request.method === "POST" && url.pathname.startsWith("/jobs/")) {
      const principal = await requireAuth(request, response);
      if (!principal) {
        return;
      }

      const jobName = url.pathname.replace(/^\/jobs\//, "");
      const serviceScope = principal.user?.service_scope || "";
      if (!scopeAllows(serviceScope, jobName)) {
        return sendJson(response, 403, {
          error: `User '${principal.user?.username}' is scoped to service '${serviceScope}' and cannot trigger job '${jobName}'`
        });
      }

      await readRequestBody(request);
      const run = await enqueueJob(
        jobName,
        principal.user?.username || request.socket.remoteAddress || "api",
        principal.user || null
      );
      return sendJson(response, 202, {
        accepted: true,
        message: `Job '${jobName}' queued successfully`,
        run,
        queue_depth: await redis.lLen(redisKeys.queue),
        active_run: await getPrimaryActiveRun()
      });
    }

    sendJson(response, 404, { error: "Not found" });
  } catch (error) {
    if (error instanceof HttpError) {
      return sendJson(response, error.statusCode, { error: error.message });
    }
    // Details go to the server log, not to the client.
    log("error", "request failed", { method: request.method, path: request.url, error: error.message });
    if (!response.headersSent) {
      sendJson(response, 500, { error: "Internal server error" });
    }
  }
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, async () => {
    server.close();
    await shutdown();
    process.exit(0);
  });
}

stateReady.then(() => {
  server.listen(port, host, () => {
    log("info", "control plane started", { url: `http://${host}:${port}`, redis: redisUrl.replace(/\/\/([^@/]*)@/, "//***@") });
    if (!bootstrapAdminKey && host !== "127.0.0.1" && host !== "localhost" && host !== "::1") {
      log("warn", `listening on ${host} with no bootstrap key: requests from other machines get 503 until REPODOCS_CONTROL_PLANE_BOOTSTRAP_KEY is set`);
    }
    if (!bootstrapAdminKey) {
      log("warn", "no bootstrap admin key set — existing Redis users will still work but new environments should set REPODOCS_CONTROL_PLANE_BOOTSTRAP_KEY");
    }
  });
}).catch((error) => {
  log("error", "failed to initialize control plane", { error: error.message });
  process.exitCode = 1;
});