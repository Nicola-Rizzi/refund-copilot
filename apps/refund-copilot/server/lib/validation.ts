/**
 * Checks on what the browser sends, before any rule runs. Bad input becomes a
 * PayloadError, which errors.ts turns into a 400 with the message as written.
 */
import type { AiProvenance, Draft } from "./types.ts";

export class PayloadError extends Error {
  constructor(message: string) { super(message); this.name = "PayloadError"; }
}

export const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** The trace id format the server mints and accepts (observability.ts). */
export const TRACE_RE = /^[A-Za-z0-9-]{8,64}$/;

/** A required, trimmed string no longer than `max`. */
export const text = (v: unknown, max: number, field: string): string => {
  if (typeof v !== "string" || !v.trim()) throw new PayloadError(`${field} is required.`);
  if (v.length > max) throw new PayloadError(`${field} is longer than ${max} characters.`);
  return v.trim();
};

/**
 * Which AI call a draft came from, as the browser reports it (it got it in the
 * read / plan response). Kept only on AI drafts; the trace id is the join key
 * to the server's own [usage] line for that call, which is the trusted record.
 */
function validateProvenance(v: unknown): AiProvenance | undefined {
  if (!isObject(v)) return undefined;
  if ((v.feature !== "read" && v.feature !== "plan") || typeof v.traceId !== "string" || !TRACE_RE.test(v.traceId)) throw new PayloadError("ai must be { feature, traceId, model, promptVersion, edited }.");
  const str = (x: unknown) => (typeof x === "string" ? x.slice(0, 60) : "");
  return { feature: v.feature, traceId: v.traceId, model: str(v.model), promptVersion: str(v.promptVersion), edited: v.edited === true };
}

/** The draft an agent submits after reviewing (and maybe correcting) what the model read. */
export function validateDraftBody(d: unknown): Draft {
  if (!isObject(d)) throw new PayloadError("Body must be a refund draft.");
  if (typeof d.orderId !== "string" || !d.orderId.trim() || d.orderId.length > 20) throw new PayloadError("orderId is required.");
  if (typeof d.customerEmail !== "string" || d.customerEmail.length > 120) throw new PayloadError("customerEmail is required.");
  const items = d.items;
  if (!Array.isArray(items) || items.length > 20 || items.some((i) => !isObject(i) || typeof i.sku !== "string" || !Number.isInteger(i.qty))) {
    throw new PayloadError("items must be a list of { sku, qty }.");
  }
  if (typeof d.reason !== "string") throw new PayloadError("reason is required.");
  if (d.requestedAmount !== undefined && d.requestedAmount !== null && typeof d.requestedAmount !== "number") throw new PayloadError("requestedAmount must be a number.");
  const source = d.source === "ai" ? "ai" : "manual";
  const ai = source === "ai" ? validateProvenance(d.ai) : undefined;
  return {
    orderId: d.orderId.trim().toUpperCase(),
    customerEmail: d.customerEmail.trim().toLowerCase(),
    items: (items as { sku: string; qty: number }[]).map((i) => ({ sku: i.sku, qty: i.qty })),
    reason: d.reason,
    refundShipping: d.refundShipping === true,
    requestedAmount: (d.requestedAmount as number | null | undefined) ?? null,
    source,
    ...(ai ? { ai } : {}),
  };
}
