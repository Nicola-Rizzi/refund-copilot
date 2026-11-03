/**
 * Request-level observability + the release kill switch for the AI endpoints.
 *
 * usage.ts answers "what did this model call cost". This module answers the
 * questions around it: which user request was that call part of (trace id),
 * how did the request end (status + reason), and did the user keep the result
 * (outcome / feedback events). Every line carries the same `trace_id`, so one
 * grep over the log drain reconstructs a request end to end:
 *
 *   [request]  {"trace_id":"…","route":"ask","status":200,"latency_ms":2310,…}
 *   [usage]    {"trace_id":"…","label":"ask","model":"…","in_tokens":…,"est_usd":…}
 *   [feedback] {"trace_id":"…","feature":"ask","rating":"down","outcome":null}
 *
 * Still deliberately not a tracing platform (no spans, no exporter) — the
 * trace id is the join key a real OpenTelemetry setup would hang spans off.
 */
import { randomUUID } from "node:crypto";

const TRACE_ID_RE = /^[A-Za-z0-9-]{8,64}$/;

/** Accept the client's x-trace-id if it's well-formed, otherwise mint one. */
export function resolveTraceId(header: string | string[] | undefined): string {
  const v = Array.isArray(header) ? header[0] : header;
  return typeof v === "string" && TRACE_ID_RE.test(v) ? v : randomUUID();
}

/** One structured log line. stderr, like [usage], so it never mixes with a response. */
export function logEvent(kind: string, record: Record<string, unknown>): Record<string, unknown> {
  const line = { t: new Date().toISOString(), ...record };
  console.error(`[${kind}] ${JSON.stringify(line)}`);
  return line;
}

/**
 * Kill switch for safe release: DISABLED_AI_FEATURES=ask,plan turns those
 * endpoints into a 503 the UI renders as "use the manual path" — no redeploy
 * of the frontend, no code change. `all` disables every AI endpoint.
 */
export function isFeatureEnabled(feature: string, env: Record<string, string | undefined> = process.env): boolean {
  const off = (env.DISABLED_AI_FEATURES ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  return !(off.includes("all") || off.includes(feature));
}
