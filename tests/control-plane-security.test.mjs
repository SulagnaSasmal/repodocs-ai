/**
 * Security checks for the experimental control plane, run against a real
 * server and Redis. Uses REPODOCS_TEST_REDIS_URL when set (CI runs a Redis
 * service), otherwise starts a local redis-server if one is installed, and
 * skips when there is no Redis at all.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const serverScript = path.join(repoRoot, "scripts", "control-plane-server.mjs");
const localRedisAvailable = spawnSync("redis-server", ["--version"]).status === 0;
const redisAvailable = Boolean(process.env.REPODOCS_TEST_REDIS_URL) || localRedisAvailable;

// A non-loopback address of this machine, to send requests "from the network".
const networkAddress = Object.values(os.networkInterfaces())
  .flat()
  .find((entry) => entry && entry.family === "IPv4" && !entry.internal)?.address;

let redisProcess;
let redisUrl;
const servers = [];

function freePort() {
  return 20000 + Math.floor(Math.random() * 20000);
}

async function flushRedis() {
  const { createClient } = await import("redis");
  const client = createClient({ url: redisUrl });
  await client.connect();
  await client.flushDb();
  await client.quit();
}

async function startServer(env) {
  const port = freePort();
  const child = spawn(process.execPath, [serverScript], {
    cwd: repoRoot,
    env: {
      ...process.env,
      REDIS_URL: redisUrl,
      REPODOCS_CONTROL_PLANE_HOST: "0.0.0.0",
      REPODOCS_CONTROL_PLANE_PORT: String(port),
      REPODOCS_CONTROL_PLANE_DATA_DIR: path.join(os.tmpdir(), `repodocs-cp-${port}`),
      REPODOCS_CONTROL_PLANE_BOOTSTRAP_KEY: "",
      ...env
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  servers.push(child);
  let output = "";
  child.stdout.on("data", (chunk) => (output += chunk));
  child.stderr.on("data", (chunk) => (output += chunk));
  for (let attempt = 0; attempt < 50; attempt += 1) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        return { port, child, output: () => output };
      }
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`control plane did not start: ${output}`);
}

// Status of a request, with the body read so the connection is released.
async function statusOf(url, options) {
  const response = await fetch(url, options);
  await response.arrayBuffer();
  return response.status;
}

function stop(child) {
  child.kill("SIGTERM");
}

describe.skipIf(!redisAvailable)("control plane security", () => {
  beforeAll(async () => {
    if (process.env.REPODOCS_TEST_REDIS_URL) {
      redisUrl = process.env.REPODOCS_TEST_REDIS_URL;
      return;
    }
    const port = freePort();
    redisProcess = spawn("redis-server", ["--port", String(port), "--save", "", "--appendonly", "no"], { stdio: "ignore" });
    redisUrl = `redis://127.0.0.1:${port}`;
    await new Promise((resolve) => setTimeout(resolve, 500));
  });

  afterAll(() => {
    servers.forEach(stop);
    redisProcess?.kill("SIGTERM");
  });

  it.each(["replace-me", "short-key"])("refuses to start with the bootstrap key '%s'", async (key) => {
    const result = spawnSync(process.execPath, [serverScript], {
      cwd: repoRoot,
      env: { ...process.env, REDIS_URL: redisUrl, REPODOCS_CONTROL_PLANE_PORT: String(freePort()), REPODOCS_CONTROL_PLANE_BOOTSTRAP_KEY: key },
      encoding: "utf8",
      timeout: 10000
    });
    expect(result.status).not.toBe(0);
    expect(`${result.stdout}${result.stderr}`).toMatch(/placeholder|at least 24 characters/);
  });

  describe("with no bootstrap key", () => {
    let server;
    beforeAll(async () => {
      await flushRedis();
      server = await startServer({});
    });
    afterAll(() => stop(server.child));

    it("still serves requests from this machine, for local development", async () => {
      const response = await fetch(`http://127.0.0.1:${server.port}/jobs`);
      expect(response.status).toBe(200);
    });

    it.skipIf(!networkAddress)("refuses requests from other machines instead of letting them create an admin", async () => {
      const response = await fetch(`http://${networkAddress}:${server.port}/users`, {
        method: "POST",
        body: JSON.stringify({ username: "mallory", role: "admin" })
      });
      expect(response.status).toBe(503);
      expect((await response.json()).error).toContain("Authentication is not configured");
    });
  });

  describe("with a bootstrap key", () => {
    const key = crypto.randomBytes(24).toString("hex");
    let server;
    let base;
    const asAdmin = (extra = {}) => ({ "X-API-Key": key, "Content-Type": "application/json", ...extra });

    beforeAll(async () => {
      await flushRedis();
      server = await startServer({ REPODOCS_CONTROL_PLANE_BOOTSTRAP_KEY: key });
      base = `http://127.0.0.1:${server.port}`;
    });
    afterAll(() => stop(server.child));

    it("serves the dashboard with a nonce-based CSP and security headers", async () => {
      const response = await fetch(`${base}/`);
      const html = await response.text();
      const csp = response.headers.get("content-security-policy");
      const nonce = csp.match(/'nonce-([^']+)'/)[1];
      expect(html).toContain(`<script nonce="${nonce}">`);
      expect(csp).toContain("default-src 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
      expect(response.headers.get("x-content-type-options")).toBe("nosniff");
      expect(response.headers.get("x-frame-options")).toBe("DENY");
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(html).toContain("esc(user.display_name)");
      expect(html).not.toContain("localStorage");
    });

    it("keeps the public health check free of run details, paths and connection strings", async () => {
      const health = await (await fetch(`${base}/health`)).json();
      expect(Object.keys(health).sort()).toEqual(["auth_enabled", "queue_depth", "status", "storage_backend", "uptime_seconds"]);
    });

    it("never writes the Redis password or URL credentials to the log", () => {
      expect(server.output()).not.toMatch(/redis:\/\/[^*\s"]+@/);
    });

    it("rejects bodies over the size limit, malformed JSON and bad usernames", async () => {
      const big = await fetch(`${base}/users`, { method: "POST", headers: asAdmin(), body: "a".repeat(70 * 1024) });
      expect(big.status).toBe(413);
      const malformed = await fetch(`${base}/users`, { method: "POST", headers: asAdmin(), body: "{bad" });
      expect(malformed.status).toBe(400);
      const badName = await fetch(`${base}/users`, { method: "POST", headers: asAdmin(), body: JSON.stringify({ username: "../admin" }) });
      expect(badName.status).toBe(400);
    });

    it("limits a scoped user to exactly the jobs listed, not every job containing the text", async () => {
      const created = await (await fetch(`${base}/users`, {
        method: "POST",
        headers: asAdmin(),
        body: JSON.stringify({ username: "scoped", service_scope: "a" })
      })).json();
      const asScoped = { "X-API-Key": created.api_key };
      // "a" used to match analytics, agent and automation.
      for (const job of ["analytics", "agent", "automation"]) {
        expect(await statusOf(`${base}/jobs/${job}`, { method: "POST", headers: asScoped })).toBe(403);
      }
    });

    it("returns 404 for an unknown job, including inherited object keys", async () => {
      for (const job of ["nope", "__proto__", "constructor"]) {
        expect(await statusOf(`${base}/jobs/${job}`, { method: "POST", headers: asAdmin() })).toBe(404);
      }
    });

    it("will not demote or disable the last active admin", async () => {
      const { users } = await (await fetch(`${base}/users`, { headers: asAdmin() })).json();
      const admin = users.find((user) => user.role === "admin");
      const response = await fetch(`${base}/users/${admin.id}`, { method: "PATCH", headers: asAdmin(), body: JSON.stringify({ role: "operator" }) });
      expect(response.status).toBe(409);
    });

    it("locks out an address after repeated wrong keys", async () => {
      const statuses = [];
      for (let attempt = 0; attempt < 12; attempt += 1) {
        statuses.push(await statusOf(`${base}/jobs`, { headers: { "X-API-Key": `wrong-${attempt}` } }));
      }
      expect(statuses.slice(0, 10).every((status) => status === 401)).toBe(true);
      expect(statuses.at(-1)).toBe(429);
    });
  });
});
