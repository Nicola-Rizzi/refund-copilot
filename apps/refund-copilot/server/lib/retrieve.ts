/**
 * Retrieval for Ask: pick the records relevant to a question before the model
 * sees anything. Hybrid: exact, explainable signals first, plus search by meaning
 * (embeddings, semantic.ts) when VOYAGE_API_KEY is set:
 *
 *   ids        ORD-1042, RF-2003 written in the question (or the last turns)
 *   customers  an email address → that customer's orders and refunds
 *   status     "pending / waiting / supervisor", "approved", "rejected", "blocked";
 *              "never arrived / lost / not delivered / in transit" → undelivered orders
 *   reasons    "damaged / broken", "wrong item", "changed my mind", …
 *   products   a word that names an item ("vase", "lamp") → orders containing it
 *   meaning    records whose embedding is close to the question's ("anything fragile?")
 *
 * Then linked records are added (an order's refunds, a refund's order), so the
 * model can answer "is it refunded?" about an order it was asked about. With no
 * signal at all, it falls back to every record, newest first, up to a cap.
 *
 * The citation check stays the same and now runs against what was retrieved:
 * citing a real record that wasn't retrieved counts as invented. A miss here shows
 * up as "I can't tell from the shop's records", never as a made-up answer — and
 * the eval checks recall (the record the answer needs was retrieved).
 */
import type { Order, Refund } from "./types.ts";

export const MAX_CONTEXT_RECORDS = 40;

interface Retrieval {
  orders: Order[];
  refunds: Refund[];
  /** Why each record set was picked, for the status line and the logs. */
  matchedBy: string[];
  /** True when nothing in the question pointed anywhere and every record (up to the cap) was sent. */
  fallback: boolean;
}

const REFUND_STATUS: [RegExp, Refund["status"], string][] = [
  [/\b(pending|waiting|awaiting|supervisor|approval|approve)\b/i, "pending_approval", "pending"],
  [/\bapproved\b/i, "approved", "approved"],
  [/\brejected?\b/i, "rejected", "rejected"],
  [/\bblocked\b/i, "blocked", "blocked"],
];
const UNDELIVERED = /\b(never (arrived|came|got)|not (arrived|delivered|received)|didn'?t (arrive|get)|lost|missing|in transit|still shipping|undelivered)\b/i;
const REASONS: [RegExp, string][] = [
  [/\b(damaged|broken|cracked|smashed)\b/i, "damaged"],
  [/\bwrong (item|product|one)\b/i, "wrong_item"],
  [/\bchanged? (my|their|his|her) mind\b/i, "changed_mind"],
  [/\blate\b/i, "late_delivery"],
];
const ID = /\b(ORD|RF)-\d+\b/gi;
const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;

const words = (s: string) => s.toLowerCase().split(/[^a-z]+/).filter((w) => w.length >= 3);
const sameWord = (a: string, b: string) => a === b || a === `${b}s` || b === `${a}s`;

/**
 * `semanticIds`: records the semantic search (semantic.ts) found close in meaning.
 * They count as one more signal ("meaning"), so they add to the exact matches and,
 * when nothing exact matched, replace the "every record, newest first" fallback.
 */
export function retrieve(question: string, orders: Order[], refunds: Refund[], recentTurns: string[] = [], semanticIds: string[] = []): Retrieval {
  const text = [question, ...recentTurns].join("\n");
  const pickedOrders = new Set<string>();
  const pickedRefunds = new Set<string>();
  const matchedBy: string[] = [];
  const note = (why: string, n: number) => { if (n > 0) matchedBy.push(why); };

  // ids
  const ids = new Set([...text.matchAll(ID)].map((m) => m[0].toUpperCase()));
  let n = 0;
  for (const o of orders) if (ids.has(o.id)) { pickedOrders.add(o.id); n++; }
  for (const r of refunds) if (ids.has(r.id)) { pickedRefunds.add(r.id); n++; }
  note("id", n);

  // customers
  const emails = new Set([...text.matchAll(EMAIL)].map((m) => m[0].toLowerCase()));
  n = 0;
  for (const o of orders) if (emails.has(o.customerEmail)) { pickedOrders.add(o.id); n++; }
  for (const r of refunds) if (emails.has(r.customerEmail)) { pickedRefunds.add(r.id); n++; }
  note("customer", n);

  // status, delivery and reasons — from the question only: a status word in an
  // old turn shouldn't keep pulling records into every follow-up
  for (const [re, status, label] of REFUND_STATUS) {
    if (!re.test(question)) continue;
    const hits = refunds.filter((r) => r.status === status);
    hits.forEach((r) => pickedRefunds.add(r.id));
    note(`status: ${label}`, hits.length);
  }
  if (UNDELIVERED.test(question)) {
    const hits = orders.filter((o) => o.status !== "delivered");
    hits.forEach((o) => pickedOrders.add(o.id));
    note("not delivered", hits.length);
  }
  for (const [re, reason] of REASONS) {
    if (!re.test(question)) continue;
    const hits = refunds.filter((r) => r.reason === reason);
    hits.forEach((r) => pickedRefunds.add(r.id));
    note(`reason: ${reason}`, hits.length);
  }

  // products named in the question
  const qWords = words(question);
  const productHits = orders.filter((o) => o.items.some((i) => words(i.name).some((iw) => qWords.some((qw) => sameWord(iw, qw)))));
  productHits.forEach((o) => pickedOrders.add(o.id));
  note("product", productHits.length);

  // meaning: records the embedding search found
  const near = new Set(semanticIds);
  n = 0;
  for (const o of orders) if (near.has(o.id)) { pickedOrders.add(o.id); n++; }
  for (const r of refunds) if (near.has(r.id)) { pickedRefunds.add(r.id); n++; }
  note("meaning", n);

  const fallback = pickedOrders.size === 0 && pickedRefunds.size === 0;
  if (fallback) {
    return { orders: orders.slice(0, MAX_CONTEXT_RECORDS), refunds: refunds.slice(0, Math.max(0, MAX_CONTEXT_RECORDS - orders.length)), matchedBy: ["no signal: all records"], fallback };
  }

  // linked records: an order's refunds, a refund's order
  for (const r of refunds) if (pickedOrders.has(r.orderId)) pickedRefunds.add(r.id);
  for (const r of refunds) if (pickedRefunds.has(r.id)) pickedOrders.add(r.orderId);

  const os = orders.filter((o) => pickedOrders.has(o.id)).slice(0, MAX_CONTEXT_RECORDS);
  const rs = refunds.filter((r) => pickedRefunds.has(r.id)).slice(0, Math.max(0, MAX_CONTEXT_RECORDS - os.length));
  return { orders: os, refunds: rs, matchedBy, fallback };
}
