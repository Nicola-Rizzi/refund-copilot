/**
 * Refund policy as deterministic code. The model reads what the customer wants;
 * these checks decide whether the shop can give it. Nothing here calls a model.
 *
 * The amount is never the model's number: it is computed from the order's own
 * prices for the items being returned (+ shipping if refunded). A customer email
 * that says "refund me 500 €" changes nothing here except a warning.
 *
 * Each check: { id, level: "pass" | "warn" | "block", message }.
 */
import type { Check, CheckLevel, Draft, Order, Policy, Preview, Refund } from "./types.ts";

export const REASONS = ["damaged", "wrong_item", "not_received", "changed_mind", "late_delivery", "other"] as const;
type Reason = (typeof REASONS)[number];
const isReason = (r: unknown): r is Reason => (REASONS as readonly unknown[]).includes(r);

const DAY = 86400000;
const eur = (n: number) => `${n.toFixed(2)} €`;

export interface CheckContext { orders: Order[]; refunds: Refund[]; policy: Policy; today: string }

/** Quantity of each SKU already refunded or waiting for approval on this order. */
function refundedQty(orderId: string, refunds: Refund[]): Record<string, number> {
  const q: Record<string, number> = {};
  for (const r of refunds) {
    if (r.orderId !== orderId || r.status === "rejected") continue;
    for (const it of r.items) q[it.sku] = (q[it.sku] ?? 0) + it.qty;
  }
  return q;
}

function orderTotal(order: Order): number {
  return order.items.reduce((s, it) => s + it.qty * it.unitPrice, 0) + (order.shipping ?? 0);
}

/** The refund amount, from the order's prices. Null when an item isn't on the order. */
function computeAmount(draft: Pick<Draft, "items" | "refundShipping">, order: Order): number | null {
  let sum = 0;
  for (const it of draft.items) {
    const line = order.items.find((o) => o.sku === it.sku);
    if (!line) return null;
    sum += line.unitPrice * it.qty;
  }
  if (draft.refundShipping) sum += order.shipping ?? 0;
  return Math.round(sum * 100) / 100;
}

/** Every policy check for a draft, and the amount computed from the order. `today` is "YYYY-MM-DD". */
export function runChecks(draft: Draft, { orders, refunds, policy, today }: CheckContext): Preview {
  const out: Check[] = [];
  const add = (id: string, level: CheckLevel, message: string) => out.push({ id, level, message });
  const order = orders.find((o) => o.id === String(draft.orderId ?? "").trim().toUpperCase());

  if (!order) {
    add("order_exists", "block", draft.orderId ? `No order ${draft.orderId}.` : "No order number: find the order before refunding.");
    return { checks: out, amount: null };
  }
  add("order_exists", "pass", `Order ${order.id}, ${order.status}.`);

  if (String(draft.customerEmail ?? "").trim().toLowerCase() !== order.customerEmail) {
    add("customer_matches", "block", `The request comes from ${draft.customerEmail || "an unknown sender"}, but ${order.id} belongs to ${order.customerEmail}.`);
  } else {
    add("customer_matches", "pass", "Sender is the customer on the order.");
  }

  if (!isReason(draft.reason)) add("reason", "block", `Unknown reason "${draft.reason}".`);

  const already = refundedQty(order.id, refunds);
  if (draft.items.length === 0 && !draft.refundShipping) add("items", "block", "Pick at least one item, or shipping, to refund.");
  for (const it of draft.items) {
    const line = order.items.find((o) => o.sku === it.sku);
    if (!line) { add("items", "block", `${it.sku} is not on ${order.id}.`); continue; }
    const left = line.qty - (already[it.sku] ?? 0);
    if (!(Number.isInteger(it.qty) && it.qty > 0)) add("items", "block", `Quantity for ${line.name} must be a whole number above 0.`);
    else if (left <= 0) add("already_refunded", "block", `${line.name} has already been refunded (or is waiting for approval).`);
    else if (it.qty > left) add("items", "block", `Only ${left} × ${line.name} left to refund on ${order.id}.`);
  }

  // Time rules depend on the reason.
  if (draft.reason === "not_received") {
    if (order.status === "delivered") add("window", "block", `${order.id} is marked delivered ${order.deliveredDaysAgo} days ago: check with the courier first.`);
    else if (order.shippedDaysAgo < policy.lostAfterDays) add("window", "block", `Shipped ${order.shippedDaysAgo} days ago: treat as lost only after ${policy.lostAfterDays} days.`);
    else add("window", "pass", `Shipped ${order.shippedDaysAgo} days ago and not delivered: can be treated as lost.`);
  } else if (order.deliveredDaysAgo === null) {
    add("window", "block", `${order.id} hasn't been delivered yet.`);
  } else if (order.deliveredDaysAgo > policy.returnWindowDays) {
    add("window", "block", `Delivered ${order.deliveredDaysAgo} days ago: outside the ${policy.returnWindowDays}-day return window.`);
  } else {
    add("window", "pass", `Delivered ${order.deliveredDaysAgo} days ago, within the ${policy.returnWindowDays}-day window.`);
  }

  const amount = computeAmount(draft, order);
  if (amount !== null) {
    const refundedSoFar = refunds.filter((r) => r.orderId === order.id && r.status !== "rejected").reduce((s, r) => s + r.amount, 0);
    const left = Math.round((orderTotal(order) - refundedSoFar) * 100) / 100;
    if (amount > left) add("not_more_than_paid", "block", `${eur(amount)} is more than what's left to refund on ${order.id} (${eur(left)}).`);
    else add("not_more_than_paid", "pass", `${eur(amount)} of ${eur(left)} still refundable.`);
    if (typeof draft.requestedAmount === "number" && draft.requestedAmount > amount + 0.005) {
      add("requested_amount", "warn", `The customer asks for ${eur(draft.requestedAmount)}; the items come to ${eur(amount)}. Refund the item value, not the asked amount.`);
    }
    if (amount > policy.agentLimit) add("approval", "warn", `Over ${eur(policy.agentLimit)}: needs a supervisor's approval.`);
  }

  const since = new Date(new Date(today).getTime() - policy.historyWindowDays * DAY).toISOString().slice(0, 10);
  const recent = refunds.filter((r) => r.customerEmail === order.customerEmail && r.status !== "rejected" && r.createdAt >= since);
  if (recent.length >= policy.historyWarnAt) {
    add("customer_history", "warn", `${order.customerEmail} has had ${recent.length} refunds in the last ${policy.historyWindowDays} days.`);
  }
  return { checks: out, amount };
}

export const isBlocked = (checks: Check[]): boolean => checks.some((c) => c.level === "block");
export const daysAgoToDate = (today: string, n: number | null | undefined): string | null =>
  n === null || n === undefined ? null : new Date(new Date(today).getTime() - n * DAY).toISOString().slice(0, 10);
