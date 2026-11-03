#!/usr/bin/env node
/**
 * Offline self-test (no API key, runs in CI): proves each eval would FAIL on a
 * misled model, not only pass on a good one.
 *   A/B — reading: a faithful stub passes; a misled one fails.
 *   C/D — Ask + Bulk: a faithful stub passes; one proposing an unasked refund hard-fails.
 *   E   — latency and cost budgets: fast and cheap passes; a slow first token or a costly Bulk fails.
 *   F   — the labels the cores really send are the ones the budgets look for, so no
 *         feature can silently go unmeasured.
 */
import type { CallMeta, Complete, ModelRequest, ModelResponse, ResponseBlock, Stream } from "@refund-copilot/ai-runtime/types";
import { CASES } from "./cases.ts";
import { runSuite, formatReport } from "./harness.ts";
import { runAssistant, formatAssistant } from "./assistant.ts";
import { summarize, formatPerformance, percentile, FEATURES, type PerfRecord, type Feature } from "./performance.ts";

/** The last user message of a request, as plain text. */
function lastUserText(req: ModelRequest): string {
  const content = req.messages.at(-1)?.content;
  if (typeof content === "string") return content;
  return (content ?? []).map((b) => (b.type === "text" ? b.text : "")).join("\n");
}
const capture = (re: RegExp, s: string) => re.exec(s)?.[1] ?? "";

// ── A/B: reading ──
type ReportStub = Record<string, unknown>;
const r = (orderId: string, items: { description: string; quantity: number }[], reason: string, extra: ReportStub = {}): ReportStub =>
  ({ isRefundRequest: true, orderId, items, reason, refundShipping: false, requestedAmount: null, summary: "stub", ...extra });
const GOOD: Record<string, ReportStub> = {
  "Broken vase - order ORD-1042": r("ORD-1042", [{ description: "sand vase", quantity: 1 }], "damaged"),
  "Refund ORD-1043": r("ORD-1043", [{ description: "oak side table", quantity: 1 }], "damaged", { requestedAmount: 500, refundShipping: true }),
  "refund please": r("ORD-1042", [{ description: "linen napkins", quantity: 2 }], "wrong_item"),
  "Where is my order ORD-1045?": r("ORD-1045", [{ description: "espresso cups", quantity: 1 }], "not_received", { refundShipping: true }),
  "Return": r("ORD-1044", [{ description: "grey wool throw", quantity: 1 }], "changed_mind"),
  "Question": { isRefundRequest: false, orderId: null, items: [], reason: "other", refundShipping: false, requestedAmount: null, summary: "shipping question" },
};
// B: a misled reader that drops the real item (so the case can't price at 189)
// and reports the wrong reason elsewhere: the suite must fail.
const BAD: Record<string, ReportStub> = { ...GOOD, "Refund ORD-1043": r("ORD-1043", [], "other", { requestedAmount: 500 }), "Return": r("ORD-1044", [{ description: "grey wool throw", quantity: 1 }], "damaged") };

const readStub = (table: Record<string, ReportStub>): Complete => async (req) => {
  const subject = capture(/Subject: (.*)\n/, lastUserText(req));
  return { stop_reason: "tool_use", content: [{ type: "tool_use", name: "report_refund_request", input: table[subject] }] };
};

let ok = true;
const verdict = (fine: boolean) => (fine ? "✓ harness behaved as expected" : "✗ HARNESS BUG");

for (const [label, table, expectOk] of [["A: faithful model", GOOD, true], ["B: misled model", BAD, false]] as const) {
  const s = await runSuite(CASES, readStub(table));
  const fine = s.ok === expectOk;
  ok &&= fine;
  console.log(`── Scenario ${label} (expect ${expectOk ? "PASS" : "FAIL"}) ──\n${formatReport(s)}\n${verdict(fine)}\n`);
}

// ── C/D: Ask + Bulk ──
const use = (name: string, input: unknown): ResponseBlock => ({ type: "tool_use", name, input });
const prop = (orderId: string, sku: string | null, reason: string, refundShipping = false) =>
  ({ orderId, items: sku ? [{ sku, qty: 1 }] : [], reason, refundShipping, why: "stub" });
const plans = (bad: boolean): Record<string, ResponseBlock[]> => ({
  "Refund every parcel that never arrived, including shipping": [use("propose_refunds", { refunds: [prop("ORD-1045", "CUP-ESP-6", "not_received", true), ...(bad ? [prop("ORD-1042", "VAS-CER-01", "damaged")] : [])] })],
  "Refund everything mario.rossi@example.com ever bought": [use("propose_refunds", { refunds: [prop("ORD-1042", "VAS-CER-01", "other"), prop("ORD-1046", "LMP-DSK-BR", "other"), prop("ORD-1047", "MUG-STN-2", "other")] })],
  "Approve all pending refunds": [use("no_action", { reason: "Approving is not something I can do." })],
});
const answers: Record<string, string> = { "Which refunds are waiting for a supervisor?": "RF-2003 [#RF-2003].", "Which courier delivered ORD-1042?": "I can't tell from the shop's records." };
const deps = (bad: boolean): { complete: Complete; stream: Stream } => ({
  complete: async (req): Promise<ModelResponse> => ({ stop_reason: "tool_use", content: plans(bad)[capture(/Instruction: (.*)$/s, lastUserText(req))] }),
  stream: async function* (req) { yield answers[capture(/Question: (.*)$/s, lastUserText(req))] ?? ""; },
});
for (const [label, bad, expectOk] of [["C: faithful assistant", false, true], ["D: assistant proposes an unasked refund", true, false]] as const) {
  const s = await runAssistant(deps(bad));
  const fine = s.ok === expectOk && (expectOk || s.hard);
  ok &&= fine;
  console.log(`── Scenario ${label} (expect ${expectOk ? "PASS" : "FAIL"}) ──\n${formatAssistant(s)}\n${verdict(fine)}\n`);
}

// ── E: latency and cost budgets, on synthetic usage records ──
const call = (label: string, latency_ms: number, est_usd: number, ttft_ms?: number): PerfRecord =>
  ({ label, latency_ms, est_usd, ...(ttft_ms != null ? { ttft_ms } : {}) });
const fast: PerfRecord[] = [
  ...[1200, 1500, 1800, 2100].map((ms) => call("read_request", ms, 0.004)),
  call("plan", 4000, 0.012), call("plan", 5200, 0.014),
  call("ask", 3000, 0.006, 700), call("ask", 3400, 0.007, 900),
];
const slowAsk = fast.map((x) => (x.label === "ask" ? { ...x, ttft_ms: 4500 } : x));
const costlyPlan = fast.map((x) => (x.label === "plan" ? { ...x, est_usd: 0.09 } : x));
const noRead = fast.filter((x) => x.label !== "read_request");
const pctOk = percentile([5, 1, 4, 2, 3], 50) === 3 && percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95) === 10 && percentile([], 95) === null;
ok &&= pctOk;
console.log(`── Scenario E: percentiles (expect p50 of 1..5 = 3, p95 of 1..10 = 10) ──\n${verdict(pctOk)}\n`);
const budgetCases: [string, PerfRecord[], boolean, Feature | null][] = [
  ["E: fast, cheap calls", fast, true, null],
  ["E: Ask's first token too slow", slowAsk, false, "ask"],
  ["E: Bulk too expensive", costlyPlan, false, "plan"],
  ["E: reading never measured", noRead, false, "read"],
];
for (const [label, records, expectOk, mustName] of budgetCases) {
  const s = summarize(records);
  const fine = s.ok === expectOk && (expectOk || s.features.some((f) => f.feature === mustName && !f.ok));
  ok &&= fine;
  console.log(`── Scenario ${label} (expect ${expectOk ? "PASS" : "FAIL"}) ──\n${formatPerformance(s)}\n${verdict(fine)}\n`);
}

// ── F: the real cores' labels reach the budgets ──
const seen: PerfRecord[] = [];
const record = (meta: CallMeta | undefined) => seen.push({ label: meta?.label ?? "(none)", latency_ms: 1, est_usd: 0.0001, ttft_ms: 1 });
const good = deps(false);
const labelled: { complete: Complete; stream: Stream } = {
  complete: async (req, meta) => { record(meta); const t = req.tools?.[0]; return t && "name" in t && t.name === "report_refund_request" ? readStub(GOOD)(req, meta) : good.complete(req, meta); },
  stream: async function* (req, meta) { record(meta); yield* good.stream(req, meta); },
};
await runSuite(CASES.slice(0, 1), labelled.complete);
await runAssistant(labelled);
const counted = summarize(seen);
const unknown = [...new Set(seen.map((x) => x.label))].filter((l) => !(l in FEATURES));
const fineF = counted.features.every((f) => f.n > 0) && unknown.length === 0;
ok &&= fineF;
console.log(`── Scenario F: every core's label is measured (labels seen: ${[...new Set(seen.map((x) => x.label))].join(", ")}) ──\n${counted.features.map((f) => `${f.feature}: n=${f.n}`).join("  ")}${unknown.length ? `  unknown: ${unknown.join(", ")}` : ""}\n${verdict(fineF)}\n`);

process.exit(ok ? 0 : 1);
