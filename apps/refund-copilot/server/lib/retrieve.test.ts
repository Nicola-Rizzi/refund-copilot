// @vitest-environment node
import { describe, it, expect } from "vitest";
import { retrieve, MAX_CONTEXT_RECORDS } from "./retrieve.ts";
import { createStore } from "./refunds.ts";
import type { Order } from "./types.ts";

const store = createStore(undefined, { now: () => "2026-10-29" });
const orders = store.orders(), refunds = store.list();
const ids = (q: string, turns: string[] = []) => {
  const r = retrieve(q, orders, refunds, turns);
  return { orders: r.orders.map((o) => o.id).sort(), refunds: r.refunds.map((x) => x.id).sort(), fallback: r.fallback, matchedBy: r.matchedBy };
};

describe("retrieve", () => {
  it("a status word: pending refunds, plus the order each one is for", () => {
    expect(ids("Which refunds are waiting for a supervisor?")).toMatchObject({ orders: ["ORD-1043"], refunds: ["RF-2003"], fallback: false });
    expect(ids("Which refunds were approved?")).toMatchObject({ refunds: ["RF-2001", "RF-2002"] });
  });

  it("an id: that record and its linked ones", () => {
    expect(ids("Which courier delivered ORD-1042?")).toMatchObject({ orders: ["ORD-1042"], refunds: [] });
    expect(ids("tell me about rf-2003")).toMatchObject({ orders: ["ORD-1043"], refunds: ["RF-2003"] });
  });

  it("a customer email: all their orders and refunds", () => {
    expect(ids("Has mario.rossi@example.com had refunds recently?")).toMatchObject({
      orders: ["ORD-1042", "ORD-1046", "ORD-1047"], refunds: ["RF-2001", "RF-2002"],
    });
  });

  it("delivery and products, in the customer's words", () => {
    expect(ids("Which parcels never arrived?")).toMatchObject({ orders: ["ORD-1045"], refunds: [] });
    expect(ids("Was the lamp refunded?")).toMatchObject({ orders: ["ORD-1046"], refunds: ["RF-2001"] });
  });

  it("a follow-up keeps the ids from the last turns", () => {
    expect(ids("and who created it?", ["RF-2003 is waiting for a supervisor [#RF-2003]."])).toMatchObject({ refunds: ["RF-2003"] });
  });

  it("no signal: every record, and says so", () => {
    const r = ids("hello, anything new?");
    expect(r.fallback).toBe(true);
    expect(r.orders).toHaveLength(orders.length);
    expect(r.refunds).toHaveLength(refunds.length);
  });

  it("never sends more than the cap", () => {
    const many: Order[] = Array.from({ length: 100 }, (_, i) => ({ ...orders[0]!, id: `ORD-${5000 + i}`, status: "shipped" }));
    const r = retrieve("which never arrived?", many, []);
    expect(r.orders).toHaveLength(MAX_CONTEXT_RECORDS);
    expect(retrieve("hi", many, refunds).orders.length + retrieve("hi", many, refunds).refunds.length).toBeLessThanOrEqual(MAX_CONTEXT_RECORDS);
  });
});
