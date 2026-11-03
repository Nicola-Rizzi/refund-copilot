#!/usr/bin/env node
/**
 * API server for the refund copilot. The Anthropic key and the order data live
 * here; the browser only knows /api/*. All policy is in lib/handlers.ts.
 * In production (NODE_ENV=production) it also serves the built UI from dist/ and
 * sends security headers on every response: one service, one origin.
 */
import { createServer, type IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";
import { makeComplete, makeStream } from "@refund-copilot/ai-runtime/anthropicClient";
import { makeStubModel } from "./lib/stubModel.ts";
import { clientIp } from "@refund-copilot/ai-runtime/clientIp";
import { createSpendLedger } from "@refund-copilot/ai-runtime/spend";
import { embedFromEnv } from "@refund-copilot/ai-runtime/embeddings";
import { createSemanticIndex } from "./lib/semantic.ts";
import { createHandlers } from "./lib/handlers.ts";
import { createStore } from "./lib/refunds.ts";
import { SECURITY_HEADERS, staticFile } from "./lib/static.ts";

// PORT is what hosting platforms set; API_PORT is the local / e2e override.
const PORT = Number(process.env.PORT ?? process.env.API_PORT ?? 8788);
const PRODUCTION = process.env.NODE_ENV === "production";
const DIST = fileURLToPath(new URL("../dist", import.meta.url));
const securityHeaders = PRODUCTION ? SECURITY_HEADERS : {};
const MAX_BODY_BYTES = 4.5 * 1024 * 1024;
// AI_STUB=1 swaps the model for keyword rules (e2e tests, keyless demo); otherwise this fails fast without a key.
const stub = process.env.AI_STUB === "1";
if (stub) console.error("AI_STUB=1: AI features answer from keyword rules, not a model.");
// Every real call's cost goes to the user's daily budget (DAILY_AI_BUDGET_USD, default 1).
const spend = createSpendLedger();
const model = stub ? makeStubModel() : { complete: makeComplete(undefined, spend.record), stream: makeStream(undefined, spend.record) };
// VOYAGE_API_KEY turns on search by meaning in Ask; without it, exact signals only.
const embed = embedFromEnv();
const handle = createHandlers({ store: createStore(), ...model, spend, aiStub: stub, ...(embed ? { semantic: createSemanticIndex(embed) } : {}) });

class BodyError extends Error {
  status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY_BYTES) throw new BodyError("Body too large.", 413);
    chunks.push(c);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

createServer(async (req, res) => {
  for (const [k, v] of Object.entries(securityHeaders)) res.setHeader(k, v);
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end('{"status":"ok"}');
  }
  if (PRODUCTION && (req.method === "GET" || req.method === "HEAD") && !req.url?.startsWith("/api/")) {
    const file = await staticFile(DIST, req.url ?? "/");
    if (!file) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { "Content-Type": file.type, "Cache-Control": file.cache });
    return res.end(req.method === "HEAD" ? undefined : file.body);
  }
  let body: unknown;
  try {
    // Only JSON is read; any other POST reaches the handlers bodiless and gets their 415 (the CSRF rule).
    const isJson = /^application\/json\b/i.test(String(req.headers["content-type"] ?? ""));
    body = req.method === "POST" && isJson ? await readJson(req) : undefined;
  } catch (err) {
    const status = err instanceof BodyError ? err.status : 400;
    res.writeHead(status, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ error: err instanceof BodyError ? err.message : "Invalid JSON body." }));
  }
  const controller = new AbortController();
  res.on("close", () => { if (!res.writableEnded) controller.abort(); });
  const out = await handle({ method: req.method ?? "GET", path: req.url ?? "/", headers: req.headers, body, ip: clientIp(req), signal: controller.signal });
  if (out.sse) {
    res.writeHead(200, { ...out.headers, "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" });
    for await (const frame of out.sse) {
      if (res.destroyed) break;
      res.write(`event: ${frame.event}\ndata: ${JSON.stringify(frame.data)}\n\n`);
    }
    return res.end();
  }
  res.writeHead(out.status, { ...out.headers, "Content-Type": "application/json" });
  res.end(JSON.stringify(out.body));
}).listen(PORT, () => console.error(`refund copilot API on http://localhost:${PORT}`));
