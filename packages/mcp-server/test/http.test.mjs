/**
 * Tests the HTTP transport's bearer-token auth against a REAL running server —
 * spawned as a subprocess, hit with real fetch() requests, exactly like a
 * client (or an attacker) would. No mocking of req/res: if the auth check has
 * a bug in how it reads headers, this is the level that catches it.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HTTP_ENTRY = resolve(__dirname, "../dist/http.js");
const REPO_ROOT = resolve(__dirname, "../../..");

const baseEnv = {
  ...process.env,
  SHARED_UI_PATH: resolve(REPO_ROOT, "packages/ui/src"),
  API_CONTRACT_PATH: resolve(REPO_ROOT, "apps/refund-copilot/api.json"),
  PROMPTS_PATH: resolve(REPO_ROOT, "prompts"),
};

/** Spawns the http.js server and resolves once it prints its "running on" line. */
function startServer(port, extraEnv = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, [HTTP_ENTRY], {
      env: { ...baseEnv, PORT: String(port), ...extraEnv },
    });
    const timeout = setTimeout(() => reject(new Error("server did not start in time")), 5000);
    child.stderr.on("data", (chunk) => {
      if (chunk.toString().includes("running on")) {
        clearTimeout(timeout);
        resolvePromise(child);
      }
    });
    child.on("error", reject);
  });
}

function stopServer(child) {
  return new Promise((res) => {
    child.on("exit", res);
    child.kill();
  });
}

// ─── Auth ENABLED (AUTH_TOKEN set) ────────────────────────────────────────────

let authedServer;
const AUTH_PORT = 3211;
const TOKEN = "test-secret-token-do-not-use-in-prod";

before(async () => {
  authedServer = await startServer(AUTH_PORT, { AUTH_TOKEN: TOKEN });
});
after(async () => {
  await stopServer(authedServer);
});

test("health check stays open even with AUTH_TOKEN set (no header needed)", async () => {
  const res = await fetch(`http://localhost:${AUTH_PORT}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, "ok");
});

test("MCP endpoint rejects requests with no Authorization header", async () => {
  const res = await fetch(`http://localhost:${AUTH_PORT}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(res.status, 401);
  assert.equal(res.headers.get("www-authenticate"), "Bearer");
});

test("MCP endpoint rejects a wrong token", async () => {
  const res = await fetch(`http://localhost:${AUTH_PORT}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer wrong-token" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(res.status, 401);
});

test("MCP endpoint rejects a malformed Authorization header (missing 'Bearer' scheme)", async () => {
  const res = await fetch(`http://localhost:${AUTH_PORT}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: TOKEN }, // no "Bearer " prefix
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
  });
  assert.equal(res.status, 401);
});

test("MCP endpoint accepts the correct token (request reaches the transport, not blocked at auth)", async () => {
  const res = await fetch(`http://localhost:${AUTH_PORT}/mcp`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      Authorization: `Bearer ${TOKEN}`,
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "http-auth-test", version: "0.0.0" },
      },
    }),
  });
  // The point of this test is specifically that auth did NOT block it — 401 is
  // the one status that would mean the auth layer itself is broken.
  assert.notEqual(res.status, 401);
});

// ─── Auth DISABLED (no AUTH_TOKEN — the documented localhost default) ────────

test("with AUTH_TOKEN unset, the MCP endpoint stays open (backward compatible)", async () => {
  const port = 3212;
  const server = await startServer(port); // no AUTH_TOKEN in env
  try {
    const res = await fetch(`http://localhost:${port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "http-noauth-test", version: "0.0.0" },
        },
      }),
    });
    assert.notEqual(res.status, 401); // no token required — never asked for one
  } finally {
    await stopServer(server);
  }
});
