// @vitest-environment node
import { describe, it, expect } from "vitest";
import { buildPlanRequest, validatePlan, planRefunds } from "./planRefunds.ts";
import { createStore } from "./refunds.ts";
import type { LineRef } from "./types.ts";

const store = () => createStore(undefined, { now: () => "2026-10-29" });
const call = (refunds: unknown[]) => ({ type: "tool_use", name: "propose_refunds", input: { refunds } });
const p = (orderId: string, items: LineRef[], reason: string, refundShipping = false) => ({ orderId, items, reason, refundShipping, why: "matches" });

describe("planRefunds", () => {
  it("offers a batched tool plus no_action, and requires a call", () => {
    const req = buildPlanRequest("x", store().orders(), store().list());
    expect(req.tools?.map((t) => ("name" in t ? t.name : null))).toEqual(["propose_refunds", "no_action"]);
    expect(req.tool_choice).toEqual({ type: "any" });
    expect(req.max_tokens).toBeGreaterThanOrEqual(3000);
    expect(req.system).toMatch(/more than 7 days ago and still not delivered counts as lost/);
  });

  it("runs every proposal through policy: passes are proposed, blocks are listed with reasons", () => {
    const out = validatePlan({ stop_reason: "tool_use", content: [call([
      p("ORD-1045", [{ sku: "CUP-ESP-6", qty: 1 }], "not_received", true),   // lost parcel: fine
      p("ORD-1044", [{ sku: "THR-WOL-GR", qty: 1 }], "changed_mind"),       // outside the window
      p("ORD-9999", [], "other"),                                           // invented
      p("ORD-1045", [], "other", true),                                     // duplicate proposal
    ])] }, store());
    expect(out.proposals.map((x) => [x.draft.orderId, x.amount])).toEqual([["ORD-1045", 36.9]]);
    expect(out.proposals[0].draft.customerEmail).toBe("alex.moreau@example.com");
    expect(out.blocked.map((b) => b.orderId)).toEqual(["ORD-1044", "ORD-9999", "ORD-1045"]);
    expect(out.blocked[0].reasons[0]).toMatch(/outside the 30-day/);
    expect(out.truncated).toBe(false);
  });

  it("flags a plan cut off by the token limit and surfaces no_action as a note", () => {
    expect(validatePlan({ stop_reason: "max_tokens", content: [] }, store()).truncated).toBe(true);
    expect(validatePlan({ content: [{ type: "tool_use", name: "no_action", input: { reason: "Nothing matches." } }] }, store()).note).toBe("Nothing matches.");
  });

  it("creates nothing itself", async () => {
    const s = store();
    const before = s.list().length;
    await planRefunds("refund lost parcels", s, async () => ({ content: [call([p("ORD-1045", [{ sku: "CUP-ESP-6", qty: 1 }], "not_received")])] }));
    expect(s.list()).toHaveLength(before);
  });

  it("sends customers as pseudonyms; the draft keeps the order's real address", async () => {
    let sent = "";
    const complete = async (req: Parameters<Parameters<typeof planRefunds>[2]>[0]) => {
      sent = JSON.stringify(req.messages);
      return { content: [call([{ ...p("ORD-1042", [{ sku: "VAS-CER-01", qty: 1 }], "damaged"), why: "CUST-001 asked" }])] };
    };
    const plan = await planRefunds("refund everything mario.rossi@example.com bought", store(), complete);
    expect(sent).not.toMatch(/@example\.com/);
    expect(plan.proposals[0]).toMatchObject({ draft: { customerEmail: "mario.rossi@example.com" }, why: "mario.rossi@example.com asked" });
  });
});
