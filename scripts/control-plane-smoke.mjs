const baseUrl = process.env.REPODOCS_CONTROL_PLANE_URL || "http://127.0.0.1:4312";
const bootstrapKey = process.env.REPODOCS_CONTROL_PLANE_BOOTSTRAP_KEY || "replace-me";
const waitTimeoutMs = Number.parseInt(process.env.REPODOCS_CONTROL_PLANE_SMOKE_TIMEOUT_MS || "90000", 10);

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function requestJson(pathname, { method = "GET", apiKey, body, expectedStatus } = {}) {
  const headers = { Accept: "application/json" };
  if (apiKey) {
    headers["X-API-Key"] = apiKey;
  }
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  const response = await fetch(new URL(pathname, baseUrl), {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  const text = await response.text();
  let payload = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
  }

  if (expectedStatus !== undefined && response.status !== expectedStatus) {
    throw new Error(
      `${method} ${pathname} returned ${response.status} instead of ${expectedStatus}: ${typeof payload === "string" ? payload : JSON.stringify(payload)}`
    );
  }

  return { response, payload };
}

async function waitForHealthyControlPlane() {
  const startedAt = Date.now();
  let lastError = null;

  while (Date.now() - startedAt < waitTimeoutMs) {
    try {
      const { payload } = await requestJson("/health", { expectedStatus: 200 });
      if (payload?.status === "ok" && payload?.storage_backend === "redis") {
        return payload;
      }
      lastError = new Error(`Unexpected health payload: ${JSON.stringify(payload)}`);
    } catch (error) {
      lastError = error;
    }

    await delay(2000);
  }

  throw new Error(`Control plane did not become healthy within ${waitTimeoutMs}ms. ${lastError ? lastError.message : "No response received."}`);
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  console.log(`Waiting for control plane readiness at ${baseUrl} ...`);
  const health = await waitForHealthyControlPlane();
  console.log(`Health OK: queue=${health.queue_depth} backend=${health.storage_backend}`);

  const auth = await requestJson("/auth/status", {
    apiKey: bootstrapKey,
    expectedStatus: 200
  });
  assert(auth.payload?.authenticated_user?.role === "admin", "Bootstrap key did not authenticate as an admin user.");
  console.log(`Authenticated as ${auth.payload.authenticated_user.username}`);

  const username = `smoke-${Date.now().toString(36)}`;
  const displayName = "Smoke Test Operator";
  const initialKeyLabel = "smoke-initial";
  const rotatedKeyLabel = "smoke-rotated";

  const created = await requestJson("/users", {
    method: "POST",
    apiKey: bootstrapKey,
    expectedStatus: 201,
    body: {
      username,
      display_name: displayName,
      role: "operator",
      key_label: initialKeyLabel
    }
  });
  assert(created.payload?.user?.id, "User creation did not return a user id.");
  assert(typeof created.payload?.api_key === "string" && created.payload.api_key.startsWith("rdai_"), "User creation did not return an API key.");
  console.log(`Created smoke user ${username}`);

  const users = await requestJson("/users", {
    apiKey: bootstrapKey,
    expectedStatus: 200
  });
  const createdUser = users.payload?.users?.find((candidate) => candidate.id === created.payload.user.id);
  assert(createdUser, "Created user was not returned by GET /users.");

  const updatedDisplayName = "Smoke Test Operator Updated";
  const updated = await requestJson(`/users/${created.payload.user.id}`, {
    method: "PATCH",
    apiKey: bootstrapKey,
    expectedStatus: 200,
    body: {
      display_name: updatedDisplayName
    }
  });
  assert(updated.payload?.user?.display_name === updatedDisplayName, "PATCH /users did not persist the display name update.");
  console.log("Updated smoke user metadata");

  const rotated = await requestJson(`/users/${created.payload.user.id}/keys`, {
    method: "POST",
    apiKey: bootstrapKey,
    expectedStatus: 201,
    body: {
      key_label: rotatedKeyLabel
    }
  });
  const rotatedKeyId = rotated.payload?.user?.api_keys?.find((key) => key.label === rotatedKeyLabel && !key.revoked_at)?.id;
  assert(rotatedKeyId, "Key rotation did not return a usable key id.");
  assert(typeof rotated.payload?.api_key === "string" && rotated.payload.api_key.startsWith("rdai_"), "Key rotation did not return a new API key.");
  console.log("Issued a rotated key for the smoke user");

  const rotatedAuth = await requestJson("/auth/status", {
    apiKey: rotated.payload.api_key,
    expectedStatus: 200
  });
  assert(rotatedAuth.payload?.authenticated_user?.id === created.payload.user.id, "Rotated key did not authenticate as the smoke user.");

  await requestJson(`/users/${created.payload.user.id}/keys/${rotatedKeyId}`, {
    method: "DELETE",
    apiKey: bootstrapKey,
    expectedStatus: 200
  });
  console.log("Revoked the rotated key");

  await requestJson("/auth/status", {
    apiKey: rotated.payload.api_key,
    expectedStatus: 200
  }).then(({ payload }) => {
    assert(payload?.authenticated_user === null, "Revoked key should no longer authenticate.");
  });

  await requestJson("/jobs", {
    apiKey: bootstrapKey,
    expectedStatus: 200
  });
  console.log("Smoke test passed: readiness, auth, users, key rotation, revocation, and admin jobs access are working.");
}

main().catch((error) => {
  console.error(`Control-plane smoke test failed: ${error.message}`);
  process.exitCode = 1;
});