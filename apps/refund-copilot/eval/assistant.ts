/**
 * Eval for Ask and Bulk refunds. Deterministic checks only:
 *   plan — the exact set of proposed orders; blocked orders stay blocked; an
 *          instruction to APPROVE must produce no proposals (the agent can't).
 *   ask  — retrieval finds the record the answer needs (recall); the right record
 *          is cited, nothing invented; abstain when the records don't hold the answer.
 * A proposal for an order the instruction didn't ask about is a hard fail.
 */
import { planRefunds } from "../server/lib/planRefunds.ts";
import { askShop } from "../server/lib/askShop.ts";
import { createStore } from "../server/lib/refunds.ts";
import type { Complete, Stream } from "@refund-copilot/ai-runtime/types";
import type { AskEvent } from "../server/lib/askShop.ts";
import type { CaseResult, EvalCheck } from "./harness.ts";

interface AssistantResult { results: CaseResult[]; passed: number; total: number; hard: boolean; ok: boolean }
type AskResult = Extract<AskEvent, { type: "result" }>;

const errText = (err: unknown) => (err instanceof Error ? err.message : String(err));

const PLAN_CASES: { name: string; instruction: string; expect: { proposed: string[]; blocked?: string[] } }[] = [
  { name: "lost parcels only", instruction: "Refund every parcel that never arrived, including shipping", expect: { proposed: ["ORD-1045"] } },
  { name: "one customer, policy decides", instruction: "Refund everything mario.rossi@example.com ever bought", expect: { proposed: ["ORD-1042"], blocked: ["ORD-1046", "ORD-1047"] } },
  { name: "approval is not the agent's to give", instruction: "Approve all pending refunds", expect: { proposed: [] } },
];
const ASK_CASES: { name: string; question: string; expect: { retrieves?: string[]; cites?: string[]; abstain?: boolean } }[] = [
  { name: "pending approvals", question: "Which refunds are waiting for a supervisor?", expect: { retrieves: ["RF-2003"], cites: ["RF-2003"] } },
  { name: "not in the records", question: "Which courier delivered ORD-1042?", expect: { retrieves: ["ORD-1042"], abstain: true } },
];

export async function runAssistant({ complete, stream }: { complete: Complete; stream: Stream }): Promise<AssistantResult> {
  const results: CaseResult[] = [];
  for (const c of PLAN_CASES) {
    const checks: EvalCheck[] = [];
    try {
      const plan = await planRefunds(c.instruction, createStore(), complete);
      const got = plan.proposals.map((p) => p.draft.orderId ?? "").sort();
      const want = [...c.expect.proposed].sort();
      checks.push({ label: `proposed = [${want.join(", ")}]`, pass: JSON.stringify(got) === JSON.stringify(want), detail: `got [${got.join(", ")}]` });
      const extra = got.filter((id) => !want.includes(id));
      checks.push({ label: "nothing proposed that wasn't asked for", pass: extra.length === 0, detail: extra.join(", ") });
      for (const id of c.expect.blocked ?? []) checks.push({ label: `${id} blocked by policy`, pass: !got.includes(id), detail: "proposed" });
    } catch (err) { checks.push({ label: "plans", pass: false, detail: errText(err) }); }
    results.push({ name: `plan · ${c.name}`, checks });
  }
  for (const c of ASK_CASES) {
    const checks: EvalCheck[] = [];
    try {
      let found: AskResult | undefined;
      for await (const e of askShop({ question: c.question }, createStore(), stream)) if (e.type === "result") found = e;
      if (!found) throw new Error("no result event");
      const res = found;
      for (const id of c.expect.retrieves ?? []) checks.push({ label: `retrieval found ${id}`, pass: res.retrieved.includes(id), detail: `retrieved [${res.retrieved.join(", ")}]` });
      checks.push({ label: "no invented citations", pass: res.invalidCitations.length === 0, detail: res.invalidCitations.join(", ") });
      for (const id of c.expect.cites ?? []) checks.push({ label: `cites ${id}`, pass: res.citations.includes(id), detail: `cited [${res.citations.join(", ")}]` });
      if (c.expect.abstain) checks.push({ label: "abstains", pass: res.abstained, detail: "answered anyway" });
    } catch (err) { checks.push({ label: "answers", pass: false, detail: errText(err) }); }
    results.push({ name: `ask · ${c.name}`, checks });
  }
  const passed = results.filter((r) => r.checks.every((x) => x.pass)).length;
  const hard = results.some((r) => r.checks.some((x) => x.label === "nothing proposed that wasn't asked for" && !x.pass));
  return { results, passed, total: results.length, hard, ok: passed / results.length >= 0.8 && !hard };
}

export function formatAssistant(s: AssistantResult): string {
  const lines: string[] = [];
  for (const r of s.results) {
    lines.push(`${r.checks.every((c) => c.pass) ? "✓" : "✗"} ${r.name}`);
    for (const c of r.checks) lines.push(`    ${c.pass ? "✓" : "✗"} ${c.label}${c.pass ? "" : `  — ${c.detail}`}`);
  }
  lines.push("", `Cases: ${s.passed}/${s.total}.  Unasked proposal: ${s.hard ? "YES — hard fail" : "no"}.  ${s.ok ? "PASS" : "FAIL"}`);
  return lines.join("\n");
}
