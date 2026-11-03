// @vitest-environment node
import { describe, it, expect } from "vitest";
import { REQUEST_TOOL, validateReport, ReadError } from "./readRequest.ts";
import { PLAN_TOOLS, validatePlan } from "./planRefunds.ts";
import { REASONS } from "./checks.ts";
import { createStore } from "./refunds.ts";

// The tool schemas are generated from the same Zod schemas that check the model's answers.
// These pin what the model is told, so a schema change shows up here (and in the prompt version).

type Schema = { type?: string; properties?: Record<string, Schema>; required?: string[]; items?: Schema; enum?: string[]; anyOf?: Schema[]; minimum?: number; maximum?: number; $schema?: string };
const schema = (s: unknown) => s as Schema;

describe("tool schemas from Zod", () => {
  it("report_refund_request: every field required, reasons as an enum, nullable order id and amount", () => {
    const s = schema(REQUEST_TOOL.input_schema);
    expect(s.$schema).toBeUndefined();
    expect(s.required).toEqual(["isRefundRequest", "orderId", "items", "reason", "refundShipping", "requestedAmount", "summary"]);
    expect(s.properties!.reason.enum).toEqual([...REASONS]);
    expect(s.properties!.orderId.anyOf!.map((a) => a.type)).toEqual(["string", "null"]);
    const qty = s.properties!.items.items!.properties!.quantity;
    expect(qty).toMatchObject({ type: "integer", minimum: 1 });
    expect(qty.maximum).toBeUndefined();   // the ±2^53 noise is stripped
  });

  it("propose_refunds and no_action keep their contract", () => {
    const [propose, noAction] = PLAN_TOOLS.map((t) => schema(t.input_schema));
    expect(PLAN_TOOLS.map((t) => t.name)).toEqual(["propose_refunds", "no_action"]);
    expect(propose.required).toEqual(["refunds"]);
    expect(propose.properties!.refunds.items!.required).toEqual(["orderId", "items", "reason", "refundShipping", "why"]);
    expect(noAction.required).toEqual(["reason"]);
  });
});

describe("answers checked against the same schema", () => {
  const reply = (input: unknown) => ({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "report_refund_request", input }] });
  const good = { isRefundRequest: true, orderId: " ord-1042 ", items: [{ description: "vase", quantity: 1 }], reason: "damaged", refundShipping: false, requestedAmount: null, summary: "Broken vase." };

  it("a reading that breaks the contract is rejected, saying where", () => {
    expect(validateReport(reply(good)).orderId).toBe("ORD-1042");
    expect(() => validateReport(reply({ ...good, items: [{ description: "vase", quantity: 0 }] }))).toThrow(/items\.0\.quantity/);
    expect(() => validateReport(reply({ ...good, refundShipping: undefined }))).toThrow(ReadError);
  });

  it("a malformed Bulk proposal is blocked on its own; the valid ones stand", () => {
    const plan = validatePlan({ stop_reason: "tool_use", content: [{ type: "tool_use", name: "propose_refunds", input: { refunds: [
      { orderId: "ORD-1045", items: [{ sku: "CUP-ESP-6", qty: 1 }], reason: "not_received", refundShipping: true, why: "lost" },
      { orderId: "ORD-1042", items: "everything", reason: "damaged", refundShipping: false, why: "x" },
    ] } }] }, createStore(undefined, { now: () => "2026-10-29" }));
    expect(plan.proposals.map((p) => p.draft.orderId)).toEqual(["ORD-1045"]);
    expect(plan.blocked).toContainEqual({ orderId: "ORD-1042", why: "", reasons: ["The proposal was malformed."] });
    expect(plan.invalid[0]).toMatch(/^malformed proposal: items/);
  });
});
