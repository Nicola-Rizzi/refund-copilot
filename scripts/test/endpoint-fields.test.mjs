// Unit tests for the pure logic behind scripts/verify-endpoint-fields.js.
// Run: node --test scripts/test/*.test.mjs  (also wired into ci.yml)
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseInterface,
  contractFieldsFromText,
  parseApiCalls,
  pathMatches,
  resolvePath,
  checkType,
} from "../lib/endpoint-fields.mjs";

test("parseInterface: top-level names + optionality, nested type literals and comments ignored", () => {
  const src = `
export interface Refund {
  id: string; orderId: string; // the order
  items: { sku: string; qty: number }[]; refundShipping: boolean;
  approvedBy: string | null;
  note?: string;
}`;
  const f = parseInterface(src, "Refund");
  assert.deepEqual([...f.keys()], ["id", "orderId", "items", "refundShipping", "approvedBy", "note"]);
  assert.equal(f.get("note").optional, true);
  assert.equal(f.has("sku"), false);
  assert.equal(parseInterface(src, "Order").size, 0);
});

test("contractFieldsFromText: a wrapped list contributes item fields, optional ones marked; body parsed", () => {
  const getText = [
    "GET /api/refunds", "Every refund.", "",
    "Response:",
    JSON.stringify({ refunds: { type: "array", items: { id: "string", amount: "number", rejection: "object (optional)" } } }, null, 2),
  ].join("\n");
  assert.deepEqual(contractFieldsFromText(getText).responseFields, ["id", "amount", "rejection (optional)"]);

  const postText = [
    "POST /api/refunds/:id/reject", "Reject.", "",
    "Request body:", JSON.stringify({ reason: "string (optional)" }, null, 2),
    "", "Response:", JSON.stringify({ refund: "object" }, null, 2),
  ].join("\n");
  assert.deepEqual(contractFieldsFromText(postText).bodyFields, ["reason"]);
});

test("checkType: flags a typo field and a dropped required field; optional contract fields may be absent", () => {
  const contract = ["id", "amount", "rejection (optional)"];
  const good = new Map([["id", {}], ["amount", {}]]);
  assert.deepEqual(checkType(good, contract), { missingFromType: [], notInContract: [] });
  const typo = new Map([["id", {}], ["ammount", {}]]);
  assert.deepEqual(checkType(typo, contract), { missingFromType: ["amount"], notInContract: ["ammount"] });
});

test("resolvePath + pathMatches: literals and templates against contract paths", () => {
  assert.equal(resolvePath('"/api/refunds"'), "/api/refunds");
  assert.equal(resolvePath("`/api/refunds/${r.id}/${action}`"), "/api/refunds/:*/:*");
  assert.equal(resolvePath("someVariable"), null);
  assert.ok(pathMatches("/api/refunds/:*/:*", "/api/refunds/:id/approve"));
  assert.ok(pathMatches("/api/refunds/:*/approve", "/api/refunds/:id/approve"));
  assert.ok(!pathMatches("/api/refunds", "/api/refunds/:id/approve"));
  assert.ok(!pathMatches("/api/refund", "/api/refunds"));
});

test("parseApiCalls: api() and apiStream(), literal bodies checked, variable bodies left alone", () => {
  const src = `
const a = await api<Me>("GET", "/api/me")
const p = await api<Plan>("POST", "/api/plan-refunds", { instruction: instruction.trim() })
await api("POST", \`/api/refunds/\${r.id}/\${action}\`, {})
const { refund } = await api<{ refund: Refund }>("POST", "/api/refunds", draft)
await apiStream("/api/ask", { question, history }, { signal, onFrame })`;
  const calls = parseApiCalls(src).map(({ line: _line, ...c }) => c);
  assert.deepEqual(calls, [
    { method: "GET", path: "/api/me", keys: [] },
    { method: "POST", path: "/api/plan-refunds", keys: ["instruction"] },
    { method: "POST", path: "/api/refunds/:*/:*", keys: [] },
    { method: "POST", path: "/api/refunds", keys: null },
    { method: "POST", path: "/api/ask", keys: ["question", "history"] },
  ]);
});
