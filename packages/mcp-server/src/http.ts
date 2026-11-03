#!/usr/bin/env node
import { createServer } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./server.js";

/**
 * HTTP entry point — one long-running server the whole team points at, instead of
 * every developer spawning their own stdio subprocess. Run it once (locally or on a
 * shared host) and point every client's config at the URL.
 *
 * Stateless mode (sessionIdGenerator: undefined): each request is self-contained, so
 * the server holds no per-client state and scales horizontally without sticky sessions.
 */
const PORT = Number(process.env.PORT ?? 3100);
const MCP_PATH = "/mcp";

/**
 * Auth is opt-in via AUTH_TOKEN. Unset — the documented default for local/trusted-network
 * use (see README §"HTTP transport") — the server accepts any request, same as before this
 * change. Set it before exposing the port beyond localhost; anything reachable without a
 * token can call every tool this server has, including reading component source and API
 * contracts.
 */
const AUTH_TOKEN = process.env.AUTH_TOKEN;
if (!AUTH_TOKEN) {
  console.error(
    "Warning: AUTH_TOKEN not set — the HTTP transport is unauthenticated. " +
      "Fine for localhost; set AUTH_TOKEN before exposing this port publicly."
  );
}

/** Constant-time compare so a mistyped token can't be brute-forced via response timing. */
function isValidToken(provided: string): boolean {
  const expected = Buffer.from(AUTH_TOKEN!);
  const actual = Buffer.from(provided);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function isAuthorized(req: import("node:http").IncomingMessage): boolean {
  if (!AUTH_TOKEN) return true; // auth disabled — see warning above
  const header = req.headers.authorization ?? "";
  const [scheme, token] = header.split(" ");
  return scheme === "Bearer" && !!token && isValidToken(token);
}

const httpServer = createServer(async (req, res) => {
  // Health check stays open even when AUTH_TOKEN is set: load balancers and uptime
  // monitors need to probe liveness without holding a credential, and it leaks nothing
  // beyond "the process is up" — no tool access, no project data.
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ status: "ok", transport: "streamable-http" }));
    return;
  }

  if (req.url !== MCP_PATH) {
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: `Not found. MCP endpoint is ${MCP_PATH}.` }));
    return;
  }

  if (!isAuthorized(req)) {
    res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" });
    res.end(JSON.stringify({ error: "Unauthorized. Provide 'Authorization: Bearer <token>'." }));
    return;
  }

  // A fresh server + transport per request keeps the stateless guarantee airtight:
  // no shared mutable state can leak between concurrent clients.
  const server = createMcpServer();
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });

  res.on("close", () => {
    transport.close();
    server.close();
  });

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res);
  } catch (err) {
    console.error("Request handling error:", err);
    if (!res.headersSent) {
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Internal server error" }));
    }
  }
});

httpServer.listen(PORT, () => {
  console.error(`refund-copilot-mcp running on http://localhost:${PORT}${MCP_PATH}`);
  console.error(`health check: http://localhost:${PORT}/health`);
  console.error(`auth: ${AUTH_TOKEN ? "enabled" : "disabled (AUTH_TOKEN not set)"}`);
});

