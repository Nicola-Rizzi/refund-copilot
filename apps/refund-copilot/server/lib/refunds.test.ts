// @vitest-environment node
import { describe, it, expect } from "vitest";
import { createStore } from "./refunds.ts";
import type { Check, CheckLevel, Draft, User } from "./types.ts";

const NOW = () => "2026-10-29";
const fresh = () => createStore(undefined, { now: NOW });
const luca: User = { id: "luca", role: "agent" }, sara: User = { id: "sara", role: "agent" }, elena: User = { id: "elena", role: "supervisor" };
const draft = (over: Partial<Draft> = {}): Draft => ({ orderId: "ORD-1042", customerEmail: "mario.rossi@example.com", items: [{ sku: "VAS-CER-01", qty: 1 }], reason: "damaged", refundShipping: false, ...over });
const ids = (checks: Check[], level: CheckLevel) => checks.filter((c) => c.level === level).map((c) => c.id);

describe("refund checks", () => {
  it("computes the amount from the order's prices, never from the request", () => {
    const { amount, checks } = fresh().preview(draft({ requestedAmount: 500 }));
    expect(amount).toBe(39.9);
    expect(ids(checks, "warn")).toContain("requested_amount");
    expect(ids(checks, "block")).toEqual([]);
  });

  it("blocks a sender who isn't the customer on the order", () => {
    const { checks } = fresh().preview(draft({ customerEmail: "someone.else@example.com" }));
    expect(ids(checks, "block")).toContain("customer_matches");
  });

  it("blocks outside the 30-day window, an unknown order, and an item not on the order", () => {
    const s = fresh();
    expect(ids(s.preview(draft({ orderId: "ORD-1044", customerEmail: "k.jensen@example.com", items: [{ sku: "THR-WOL-GR", qty: 1 }] })).checks, "block")).toContain("window");
    expect(ids(s.preview(draft({ orderId: "ORD-9999" })).checks, "block")).toEqual(["order_exists"]);
    expect(ids(s.preview(draft({ items: [{ sku: "TBL-OAK-S", qty: 1 }] })).checks, "block")).toContain("items");
  });

  it("blocks more than ordered and anything already refunded", () => {
    const s = fresh();
    expect(ids(s.preview(draft({ items: [{ sku: "NAP-LIN-04", qty: 3 }] })).checks, "block")).toContain("items");
    expect(ids(s.preview(draft({ orderId: "ORD-1046", items: [{ sku: "LMP-DSK-BR", qty: 1 }] })).checks, "block")).toContain("already_refunded");
  });

  it("treats not-received by the courier timeline, not by the customer's word", () => {
    const s = fresh();
    const lost = s.preview({ orderId: "ORD-1045", customerEmail: "alex.moreau@example.com", items: [{ sku: "CUP-ESP-6", qty: 1 }], reason: "not_received", refundShipping: true });
    expect(ids(lost.checks, "block")).toEqual([]);
    expect(lost.amount).toBe(36.9);
    expect(ids(s.preview(draft({ reason: "not_received" })).checks, "block")).toContain("window");
  });

  it("warns on a customer with repeated recent refunds", () => {
    expect(ids(fresh().preview(draft()).checks, "warn")).toContain("customer_history");
  });
});

describe("seeded history", () => {
  it("doesn't re-check past refunds against today's date", () => {
    const old = fresh().list().find((r) => r.id === "RF-2002");
    expect(old?.status).toBe("approved");
    expect(old?.checks).toEqual([]);
    expect(fresh().list().find((r) => r.id === "RF-2003")?.checks.length).toBeGreaterThan(0);
  });
});

describe("who may do what", () => {
  it("only agents create; a blocking check makes the refund blocked", () => {
    const s = fresh();
    expect(() => s.create(elena, draft())).toThrow(/Only a support agent/);
    expect(s.create(luca, draft({ customerEmail: "x@example.com" })).status).toBe("blocked");
  });

  it("an agent approves within 100 €, including their own", () => {
    const s = fresh();
    const r = s.create(luca, draft());
    expect(s.approve(luca, r.id)).toMatchObject({ status: "approved", approvedBy: "luca" });
  });

  it("over 100 € needs a supervisor, who can't approve their own", () => {
    const s = fresh();
    expect(() => s.approve(sara, "RF-2003")).toThrow(/only a supervisor/);
    expect(s.approve(elena, "RF-2003").status).toBe("approved");
  });

  it("nobody can approve a blocked refund", () => {
    const s = fresh();
    const r = s.create(luca, draft({ orderId: "ORD-1044", customerEmail: "k.jensen@example.com", items: [{ sku: "THR-WOL-GR", qty: 1 }] }));
    expect(() => s.approve(elena, r.id)).toThrow(/blocking check/);
  });

  it("reject: the creating agent or a supervisor, not another agent", () => {
    const s = fresh();
    const r = s.create(luca, draft());
    expect(() => s.reject(sara, r.id)).toThrow(/Only the agent who created it/);
    expect(s.reject(luca, r.id, "duplicate ticket").status).toBe("rejected");
  });
});

describe("audit trail", () => {
  const ai = { feature: "read" as const, traceId: "trace-read-1", model: "claude-sonnet-5", promptVersion: "read-refund-request@2", edited: true };
  const clocked = () => createStore(undefined, { now: NOW, clock: () => "2026-10-29T10:00:00.000Z" });

  it("records who did what, in which role and request, on every change", () => {
    const s = clocked();
    const r = s.create(luca, draft({ requestedAmount: null }), { traceId: "trace-create" });
    s.approve(sara, r.id, { traceId: "trace-approve" });
    const history = s.list().find((x) => x.id === r.id)!.history;
    expect(history).toEqual([
      { at: "2026-10-29T10:00:00.000Z", by: "luca", role: "agent", action: "created", traceId: "trace-create" },
      { at: "2026-10-29T10:00:00.000Z", by: "sara", role: "agent", action: "approved", traceId: "trace-approve" },
    ]);
  });

  it("a refused action leaves no trace in the history", () => {
    const s = clocked();
    const before = s.list().find((x) => x.id === "RF-2003")!.history.length;
    expect(() => s.approve(sara, "RF-2003")).toThrow(/only a supervisor/);
    expect(s.list().find((x) => x.id === "RF-2003")!.history).toHaveLength(before);
  });

  it("keeps the AI provenance on AI drafts only", () => {
    const s = clocked();
    expect(s.create(luca, draft({ source: "ai", ai })).ai).toEqual(ai);
    expect(s.create(sara, draft({ source: "manual", ai })).ai).toBeUndefined();
  });

  it("seeded refunds start with the history they would have had", () => {
    for (const r of fresh().list()) expect(r.history[0]).toMatchObject({ action: "created", by: r.createdBy });
  });
});
