/**
 * Latency and cost, measured in the same run as quality. Every model call goes
 * through the ai-runtime client, which reports one usage record per call
 * (latency_ms, ttft_ms on streams, est_usd); this module groups them by feature
 * and checks each feature against a budget. Over budget is a FAIL, like a
 * quality miss: a correct answer that takes 30 s or costs 10x is a regression.
 *
 * p95 over a handful of calls is close to the max — run with EVAL_REPEAT=3 (or
 * more) when the number matters. The budgets are first estimates: calibrate them
 * on a real run, then tighten.
 */

import type { UsageRecord } from "@refund-copilot/ai-runtime/types";

// Usage records carry the label each core passes to the client (meta.label).
// A feature with no records fails the run: a budget nothing was measured against proves nothing.
export const FEATURES: Record<string, Feature> = { read_request: "read", plan: "plan", ask: "ask" };

export type Feature = "read" | "plan" | "ask";
interface Budget { p95Ms: number; ttftP95Ms?: number; avgUsd: number }
export type PerfRecord = Pick<UsageRecord, "label" | "latency_ms" | "ttft_ms" | "est_usd">;
interface FeatureRow {
  feature: Feature; n: number; p50Ms: number | null; p95Ms: number | null; ttftP95Ms: number | null;
  avgUsd: number | null; totalUsd: number; budget: Budget; over: string[]; ok: boolean;
}
interface PerfSummary { features: FeatureRow[]; totalUsd: number; ok: boolean }

const BUDGETS: Record<Feature, Budget> = {
  read: { p95Ms: 8000, avgUsd: 0.01 },
  plan: { p95Ms: 20000, avgUsd: 0.03 },
  // Ask streams: what the user feels is the first token, so that has its own budget.
  ask: { p95Ms: 12000, ttftP95Ms: 3000, avgUsd: 0.02 },
};

/** Nearest-rank percentile; null for no samples. */
export function percentile(values: (number | null | undefined)[], p: number): number | null {
  const xs = values.filter((v): v is number => typeof v === "number").sort((a, b) => a - b);
  if (xs.length === 0) return null;
  return xs[Math.min(xs.length - 1, Math.ceil((p / 100) * xs.length) - 1)];
}

export function summarize(records: PerfRecord[], budgets: Record<Feature, Budget> = BUDGETS): PerfSummary {
  const features = (Object.entries(budgets) as [Feature, Budget][]).map(([feature, budget]): FeatureRow => {
    const rs = records.filter((r) => FEATURES[r.label] === feature);
    const lat = rs.map((r) => r.latency_ms);
    const usd = rs.map((r) => r.est_usd).filter((v): v is number => typeof v === "number");
    const row = {
      feature,
      n: rs.length,
      p50Ms: percentile(lat, 50),
      p95Ms: percentile(lat, 95),
      ttftP95Ms: percentile(rs.map((r) => r.ttft_ms), 95),
      avgUsd: usd.length ? usd.reduce((a, b) => a + b, 0) / usd.length : null,
      totalUsd: usd.reduce((a, b) => a + b, 0),
      budget,
    };
    const over: string[] = [];
    if (rs.length === 0) over.push("no calls measured");
    if (row.p95Ms != null && row.p95Ms > budget.p95Ms) over.push(`p95 ${row.p95Ms} ms > ${budget.p95Ms}`);
    if (budget.ttftP95Ms && row.ttftP95Ms != null && row.ttftP95Ms > budget.ttftP95Ms) over.push(`first token p95 ${row.ttftP95Ms} ms > ${budget.ttftP95Ms}`);
    if (row.avgUsd != null && row.avgUsd > budget.avgUsd) over.push(`avg $${row.avgUsd.toFixed(4)} > $${budget.avgUsd}`);
    return { ...row, over, ok: over.length === 0 };
  });
  const totalUsd = features.reduce((a, f) => a + f.totalUsd, 0);
  return { features, totalUsd, ok: features.every((f) => f.ok) };
}

export function formatPerformance(s: PerfSummary): string {
  const ms = (v: number | null) => (v == null ? "—" : `${v} ms`);
  const lines = s.features.map((f) => {
    const ttft = f.budget.ttftP95Ms ? `  first token p95 ${ms(f.ttftP95Ms)}` : "";
    const usd = f.avgUsd == null ? "—" : `$${f.avgUsd.toFixed(4)}`;
    return `${f.ok ? "✓" : "✗"} ${f.feature.padEnd(5)} n=${f.n}  p50 ${ms(f.p50Ms)}  p95 ${ms(f.p95Ms)}${ttft}  avg ${usd}/call${f.ok ? "" : `  — over budget: ${f.over.join("; ")}`}`;
  });
  lines.push("", `Total spent: $${s.totalUsd.toFixed(4)}.  Within budget: ${s.ok ? "yes  PASS" : "NO  FAIL"}`);
  return lines.join("\n");
}
