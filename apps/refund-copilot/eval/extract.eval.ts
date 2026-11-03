#!/usr/bin/env node
// Refund copilot evals against the real model: reading requests, then Ask + Bulk,
// then latency and cost per feature against their budgets.
// ANTHROPIC_API_KEY=... npm run eval:extract       (EVAL_REPEAT=3 for a steadier p95)
import { makeComplete, makeStream } from "@refund-copilot/ai-runtime/anthropicClient";
import { CASES } from "./cases.ts";
import { runSuite, formatReport } from "./harness.ts";
import { runAssistant, formatAssistant } from "./assistant.ts";
import { summarize, formatPerformance } from "./performance.ts";
import type { UsageRecord } from "@refund-copilot/ai-runtime/types";

const repeat = Math.max(1, Number(process.env.EVAL_REPEAT ?? 1));
const records: UsageRecord[] = [];
const collect = (r: UsageRecord) => { records.push(r); };
const complete = makeComplete(undefined, collect);
const stream = makeStream(undefined, collect);

let quality = true;
for (let run = 1; run <= repeat; run++) {
  const reading = await runSuite(CASES, complete);
  const assistant = await runAssistant({ complete, stream });
  quality &&= reading.ok && assistant.ok;
  if (run === 1) {
    console.log("── Reading refund requests ──\n" + formatReport(reading));
    console.log("\n── Ask + Bulk refunds ──\n" + formatAssistant(assistant));
  } else {
    console.log(`\nRun ${run}/${repeat}: reading ${reading.passed}/${reading.total}, Ask + Bulk ${assistant.passed}/${assistant.total}  ${reading.ok && assistant.ok ? "PASS" : "FAIL"}`);
  }
}
const perf = summarize(records);
console.log(`\n── Latency and cost (${repeat} run${repeat > 1 ? "s" : ""}) ──\n` + formatPerformance(perf));
process.exit(quality && perf.ok ? 0 : 1);
