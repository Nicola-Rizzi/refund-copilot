/**
 * Lightweight production instrumentation for the LLM features.
 *
 * Every model call shipped to users costs money and takes time. This module is
 * the minimum that any real AI feature needs: per-request token counts, latency,
 * and an estimated cost — logged as one structured line you can ship to a log
 * drain and aggregate. Each line carries the request's trace id and the prompt
 * version (see observability.ts), so cost and quality regressions can be pinned
 * to a request and a prompt change. It is deliberately NOT a full observability
 * platform: no span exporter, no dashboards.
 */
import type { UsageRecord } from "./types.ts";

export interface TokenUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
}

// Per-million-token list rates (USD), current as of the last update. Confirm
// against Anthropic's pricing page before trusting `est_usd` for real billing —
// list prices move, and Batch / caching / priority tiers all change the number.
// The primary model's rates can be overridden at runtime with
// PRICE_IN_PER_MTOK / PRICE_OUT_PER_MTOK (e.g. to model a negotiated rate).
const RATES_USD_PER_MTOK: Record<string, { input: number; output: number }> = {
  "claude-sonnet-5": {
    input: Number(process.env.PRICE_IN_PER_MTOK ?? 2.0),
    output: Number(process.env.PRICE_OUT_PER_MTOK ?? 10.0),
  },
};

export function estimateCostUsd(model: string, usage: TokenUsage | null | undefined): number | null {
  const r = RATES_USD_PER_MTOK[model];
  if (!r || !usage) return null;
  const inTok = usage.input_tokens ?? 0;
  const outTok = usage.output_tokens ?? 0;
  return (inTok * r.input + outTok * r.output) / 1_000_000;
}

export interface UsageInput {
  label: string;
  model: string;
  usage: TokenUsage | null | undefined;
  latencyMs?: number | null;
  ttftMs?: number | null;
  traceId?: string;
  user?: string;
  promptVersion?: string;
}

/**
 * Emit one structured usage record. Goes to stderr so it never mixes with the
 * SSE/JSON written to the client on stdout-equivalent channels.
 */
export function logUsage({ label, model, usage, latencyMs, ttftMs, traceId, user, promptVersion }: UsageInput): UsageRecord {
  const cost = estimateCostUsd(model, usage);
  const record: UsageRecord = {
    t: new Date().toISOString(),
    ...(traceId ? { trace_id: traceId } : {}),
    ...(user ? { user } : {}),
    label,
    ...(promptVersion ? { prompt_version: promptVersion } : {}),
    model,
    in_tokens: usage?.input_tokens ?? null,
    out_tokens: usage?.output_tokens ?? null,
    latency_ms: latencyMs != null ? Math.round(latencyMs) : null,
    // Time to first token — the latency a user actually feels on a streamed answer.
    ...(ttftMs != null ? { ttft_ms: Math.round(ttftMs) } : {}),
    ...(cost != null ? { est_usd: Number(cost.toFixed(6)) } : {}),
  };
  console.error("[usage] " + JSON.stringify(record));
  return record;
}
