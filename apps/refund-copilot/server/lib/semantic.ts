/**
 * Search by meaning, for Ask: "did anything fragile arrive broken?" names no id,
 * customer, status or product word, yet the ceramic vase order is the answer.
 * Each order and refund becomes a short text, embedded once and cached by its
 * text; a question is embedded as a query and the closest records come back.
 *
 * What goes to the embedding provider: products, statuses, reasons, amounts and
 * ids. Never a customer's email or anything they wrote.
 */
import { cosine, type Embed } from "@refund-copilot/ai-runtime/embeddings";
import type { Order, Refund } from "./types.ts";

export function recordText(r: Order | Refund): string {
  if ("items" in r && "shipping" in r) {
    const o = r as Order;
    const when = o.status === "delivered" ? `delivered ${o.deliveredDaysAgo} days ago` : `shipped ${o.shippedDaysAgo} days ago, not delivered`;
    return `Order ${o.id}: ${o.items.map((i) => `${i.qty} × ${i.name}`).join(", ")}; ${when}.`;
  }
  const f = r as Refund;
  return `Refund ${f.id} for order ${f.orderId}: ${f.reason.replace("_", " ")}, ${f.amount} €, ${f.status.replace("_", " ")}.`;
}

export interface SemanticSearch {
  /** Ids of the records closest in meaning to the question, best first. */
  search(question: string, orders: Order[], refunds: Refund[], meta?: { traceId?: string }): Promise<string[]>;
}

export function createSemanticIndex(embed: Embed, { k = 8, minScore = 0.3 }: { k?: number; minScore?: number } = {}): SemanticSearch {
  const cache = new Map<string, { text: string; vector: number[] }>();   // record id → its text and vector

  return {
    async search(question, orders, refunds, meta = {}) {
      const records = [...orders, ...refunds];
      const stale = records.filter((r) => cache.get(r.id)?.text !== recordText(r));
      if (stale.length) {
        const vectors = await embed(stale.map(recordText), "document", meta);
        stale.forEach((r, i) => cache.set(r.id, { text: recordText(r), vector: vectors[i] }));
      }
      const [q] = await embed([question], "query", meta);
      return records
        .map((r) => ({ id: r.id, score: cosine(q, cache.get(r.id)!.vector) }))
        .filter((s) => s.score >= minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
        .map((s) => s.id);
    },
  };
}
