/**
 * Eval harness for reading refund requests. All checks are deterministic: the
 * order id, which SKUs were matched, the reason, the computed amount, and which
 * policy checks block. A computed amount equal to the customer's asked-for figure
 * when the items are worth something else is a HARD FAIL: it would mean the
 * model's number leaked into the price.
 */
import { readRequest } from "../server/lib/readRequest.ts";
import { createStore } from "../server/lib/refunds.ts";
import type { Complete } from "@refund-copilot/ai-runtime/types";
import type { ReadingCase } from "./cases.ts";

export interface EvalCheck { label: string; pass: boolean; detail: string }
export interface CaseResult { name: string; checks: EvalCheck[] }
interface SuiteResult { results: CaseResult[]; passed: number; total: number; rate: number; leaked: boolean; ok: boolean }

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const CASE_PASS_THRESHOLD = 0.85;

async function runCase(c: ReadingCase, complete: Complete): Promise<CaseResult> {
  const checks: EvalCheck[] = [];
  const add = (label: string, pass: boolean, detail: string) => checks.push({ label, pass, detail });
  const store = createStore();          // fresh seed per case
  let out;
  try {
    out = await readRequest({ message: c.message }, complete, store);
  } catch (err) {
    add("reads the request", false, errText(err));
    return { name: c.name, checks };
  }
  const e = c.expect;
  add(`isRefundRequest = ${e.isRefundRequest}`, out.report.isRefundRequest === e.isRefundRequest, `got ${out.report.isRefundRequest}`);
  if (!e.isRefundRequest) return { name: c.name, checks };

  add(`order = ${e.orderId}`, out.draft?.orderId === e.orderId, `got ${out.draft?.orderId}`);
  const skus = (out.draft?.items ?? []).map((i) => i.sku).sort();
  const want = e.skus ?? [];
  add(`items = [${want.join(", ")}]`, JSON.stringify(skus) === JSON.stringify([...want].sort()), `got [${skus.join(", ")}]`);
  if (e.reason) add(`reason = ${e.reason}`, out.draft?.reason === e.reason, `got ${out.draft?.reason}`);
  if (e.amount !== undefined) add(`amount = ${e.amount}`, out.amount === e.amount, `got ${out.amount}`);
  const blocking = (out.checks ?? []).filter((x) => x.level === "block").map((x) => x.id);
  for (const id of e.blocks ?? []) add(`blocks on ${id}`, blocking.includes(id), `blocking: [${blocking.join(", ")}]`);
  for (const id of e.noBlocks ?? []) add(`no block on ${id}`, !blocking.includes(id), `blocking: [${blocking.join(", ")}]`);
  if (e.neverAmount !== undefined) add(`amount never follows the asked ${e.neverAmount}`, out.amount !== e.neverAmount, `got ${out.amount}`);
  return { name: c.name, checks };
}

export async function runSuite(cases: ReadingCase[], complete: Complete): Promise<SuiteResult> {
  const results: CaseResult[] = [];
  for (const c of cases) results.push(await runCase(c, complete));
  const passed = results.filter((r) => r.checks.every((x) => x.pass)).length;
  const leaked = results.some((r) => r.checks.some((x) => x.label.startsWith("amount never follows") && !x.pass));
  const rate = passed / results.length;
  return { results, passed, total: results.length, rate, leaked, ok: rate >= CASE_PASS_THRESHOLD && !leaked };
}

export function formatReport(s: SuiteResult): string {
  const lines: string[] = [];
  for (const r of s.results) {
    lines.push(`${r.checks.every((c) => c.pass) ? "✓" : "✗"} ${r.name}`);
    for (const c of r.checks) lines.push(`    ${c.pass ? "✓" : "✗"} ${c.label}${c.pass ? "" : `  — ${c.detail}`}`);
  }
  lines.push("", `Cases: ${s.passed}/${s.total} (${Math.round(s.rate * 100)}%, need ${Math.round(CASE_PASS_THRESHOLD * 100)}%).  Asked amount leaked into the price: ${s.leaked ? "YES — hard fail" : "no"}.  ${s.ok ? "PASS" : "FAIL"}`);
  return lines.join("\n");
}
