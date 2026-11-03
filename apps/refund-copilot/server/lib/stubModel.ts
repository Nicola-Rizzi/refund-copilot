/**
 * AI_STUB=1: a rule-based stand-in for the model, so the app runs end to end
 * with no API key: for the Playwright tests and for a demo anyone can start.
 *
 * It is NOT a model and doesn't pretend to read well: keyword rules that answer
 * through the same contract as the real one (the forced tool calls, the streamed
 * Ask text with [#…] citations). Everything after the model call (matching,
 * pricing, policy, roles, citation checks, pseudonyms) is the real code, which is
 * what the e2e tests exercise.
 */
import type { Complete, ModelRequest, ModelResponse, Stream } from "@refund-copilot/ai-runtime/types";
import { ABSTAIN } from "./askShop.ts";

const textOf = (request: ModelRequest): string =>
  request.messages.map((m) => (typeof m.content === "string" ? m.content : m.content.map((b) => ("text" in b ? b.text : "")).join("\n"))).join("\n");

const toolCall = (name: string, input: unknown): ModelResponse => ({ stop_reason: "tool_use", content: [{ type: "tool_use", name, input }] });

/** The JSON lines inside <shop_records>. */
function records(text: string): Record<string, unknown>[] {
  const block = /<shop_records>\n([\s\S]*?)\n<\/shop_records>/.exec(text)?.[1] ?? "";
  return block.split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, unknown>);
}

const REASONS: [RegExp, string][] = [
  [/broken|cracked|damaged|scratch|chipped/i, "damaged"],
  [/never arrived|not arrived|lost|not delivered|hasn't arrived/i, "not_received"],
  [/wrong (item|colou?r|size)|not what I ordered/i, "wrong_item"],
  [/late/i, "late_delivery"],
  [/changed my mind|don't want|no longer need/i, "changed_mind"],
];

function readRequest(request: ModelRequest): ModelResponse {
  const text = /<customer_message>\n([\s\S]*?)\n<\/customer_message>/.exec(textOf(request))?.[1];
  if (!text) return toolCall("report_refund_request", { isRefundRequest: true, orderId: null, items: [], reason: "other", refundShipping: false, requestedAmount: null, summary: "The stub model can't read photos: fill in the refund by hand." });
  const body = text.replace(/^Subject: .*\n\n/, "");
  const isRefund = /refund|money back|return|broken|cracked|damaged|never arrived|wrong/i.test(text);
  const amount = /(\d+(?:[.,]\d+)?)\s*(?:€|eur)/i.exec(body)?.[1];
  const firstSentence = body.split(/(?<=[.!?])\s/)[0]?.slice(0, 200) ?? "";
  return toolCall("report_refund_request", {
    isRefundRequest: isRefund,
    orderId: /ORD-\d{4}/i.exec(text)?.[0] ?? null,
    items: isRefund ? [{ description: firstSentence.slice(0, 120), quantity: 1 }] : [],
    reason: REASONS.find(([re]) => re.test(text))?.[1] ?? "other",
    refundShipping: /shipping/i.test(body),
    requestedAmount: amount ? Number(amount.replace(",", ".")) : null,
    summary: isRefund ? firstSentence : `Not a refund request: ${firstSentence}`,
  });
}

function planRefunds(request: ModelRequest): ModelResponse {
  const text = textOf(request);
  const instruction = /Instruction: (.*)$/m.exec(text)?.[1] ?? "";
  const lostAfter = Number(/more than (\d+) days ago and still not delivered/.exec(String(request.system))?.[1] ?? 7);
  const orders = records(text).filter((r) => typeof r.id === "string" && Array.isArray(r.items)) as { id: string; customer: string; status: string; shippedDaysAgo: number; items: { sku: string; qty: number }[] }[];
  const customer = /CUST-\d{3}/.exec(instruction)?.[0];
  const lost = /never arrived|lost|not delivered|didn't arrive/i.test(instruction);
  const matching = customer ? orders.filter((o) => o.customer === customer)
    : lost ? orders.filter((o) => o.status === "shipped" && o.shippedDaysAgo > lostAfter)
    : [];
  if (!matching.length) return toolCall("no_action", { reason: "The stub model only handles lost parcels and one customer's orders." });
  return toolCall("propose_refunds", {
    refunds: matching.map((o) => ({
      orderId: o.id,
      items: o.items.map((i) => ({ sku: i.sku, qty: i.qty })),
      reason: lost ? "not_received" : "changed_mind",
      refundShipping: /shipping/i.test(instruction),
      why: lost ? `Shipped ${o.shippedDaysAgo} days ago, still not delivered.` : `An order of ${o.customer}.`,
    })),
  });
}

function answer(request: ModelRequest): string {
  const text = textOf(request);
  const question = /Question: (.*)$/m.exec(text)?.[1] ?? "";
  const rs = records(text);
  const refunds = rs.filter((r) => typeof r.order === "string");
  const pending = refunds.filter((r) => r.status === "pending_approval");
  if (/pending|wait|supervisor|approv/i.test(question) && pending.length) {
    return pending.map((r) => `${r.id} (${Number(r.amount).toFixed(2)} €, ${r.customer}) is waiting for approval [#${r.id}].`).join(" ");
  }
  if (!rs.length) return ABSTAIN;
  return rs.slice(0, 3).map((r) => `${r.id}: ${r.status}${r.customer ? `, ${r.customer}` : ""} [#${r.id}].`).join(" ");
}

export function makeStubModel(): { complete: Complete; stream: Stream } {
  return {
    complete: async (request) => {
      const first = request.tools?.[0];
      const tool = first && "name" in first ? first.name : undefined;
      if (tool === "report_refund_request") return readRequest(request);
      if (tool === "propose_refunds") return planRefunds(request);
      return { stop_reason: "end_turn", content: [] };
    },
    stream: async function* (request, meta = {}) {
      for (const word of answer(request).split(/(?<= )/)) {
        if (meta.signal?.aborted) return;
        await new Promise((r) => setTimeout(r, 15));
        yield word;
      }
    },
  };
}
