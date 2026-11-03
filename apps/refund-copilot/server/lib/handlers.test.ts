// @vitest-environment node
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createHandlers } from "./handlers.ts";
import { createStore } from "./refunds.ts";
import type { Complete, Stream } from "@refund-copilot/ai-runtime/types";
import type { ApiResponse, SseFrame } from "./handlers.ts";
import { createSessions } from "./session.ts";
import { createSpendLedger } from "@refund-copilot/ai-runtime/spend";

// Test helper: read a JSON body without asserting its shape at every call.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const json = (r: ApiResponse): any => r.body;

const sessions = createSessions({ secret: "test-secret" });
const setup = (complete: Complete = async () => ({ content: [] }), stream: Stream = async function* () { yield "ok [#RF-2003]"; }) =>
  createHandlers({ store: createStore(undefined, { now: () => "2026-10-29" }), complete, stream, sessions });
/** A request as `user`: their signed session cookie, and JSON like the browser sends. */
const as = (user: string | null, method: string, path: string, body?: unknown) => ({
  method, path, body, ip: "1.1.1.1",
  headers: { "content-type": "application/json", ...(user ? { cookie: `rc_session=${sessions.issue(user)}` } : {}) },
});
const draft = { orderId: "ORD-1042", customerEmail: "mario.rossi@example.com", items: [{ sku: "VAS-CER-01", qty: 1 }], reason: "damaged" };

beforeEach(() => { vi.spyOn(console, "error").mockImplementation(() => {}); });   // each setup() has its own rate limiter
afterEach(() => { vi.restoreAllMocks(); delete process.env.DISABLED_AI_FEATURES; });

describe("refund API", () => {
  it("requires a known user", async () => {
    expect((await setup()(as(null, "GET", "/api/refunds"))).status).toBe(401);
    expect((await setup()(as("mallory", "GET", "/api/refunds"))).status).toBe(401);
  });

  it("lists refunds with, per user, why they can't approve", async () => {
    const h = setup();
    const forSara = json(await h(as("sara", "GET", "/api/refunds"))).refunds.find((r: { id: string }) => r.id === "RF-2003");
    expect(forSara.approveBlocker).toMatch(/only a supervisor/);
    const forElena = json(await h(as("elena", "GET", "/api/refunds"))).refunds.find((r: { id: string }) => r.id === "RF-2003");
    expect(forElena.approveBlocker).toBeNull();
  });

  it("maps rules to 403/409 and bad drafts to 400", async () => {
    const h = setup();
    expect((await h(as("elena", "POST", "/api/refunds", draft))).status).toBe(403);
    expect((await h(as("sara", "POST", "/api/refunds/RF-2003/approve", {}))).status).toBe(403);
    expect((await h(as("luca", "POST", "/api/refunds", { ...draft, items: "vase" }))).status).toBe(400);
    const created = json(await h(as("luca", "POST", "/api/refunds", draft))).refund;
    expect(created.amount).toBe(39.9);
    expect((await h(as("luca", "POST", `/api/refunds/${created.id}/approve`, {}))).status).toBe(200);
    expect((await h(as("luca", "POST", `/api/refunds/${created.id}/approve`, {}))).status).toBe(409);
  });

  it("the AI route: agents only, kill switch, and upstream vs invalid output", async () => {
    expect((await setup()(as("elena", "POST", "/api/read-request", { message: { body: "hi" } }))).status).toBe(403);
    process.env.DISABLED_AI_FEATURES = "read";
    expect(json(await setup()(as("luca", "POST", "/api/read-request", { message: { body: "hi" } })))).toMatchObject({ disabled: true });
    delete process.env.DISABLED_AI_FEATURES;
    expect(json(await setup()(as("luca", "POST", "/api/read-request", { message: { body: "hi" } }))).kind).toBe("invalid_output");
    const down = setup(async () => { throw Object.assign(new Error("overloaded"), { status: 529 }); });
    expect(json(await down(as("luca", "POST", "/api/read-request", { message: { body: "hi" } }))).kind).toBe("upstream");
  });

  it("ask streams SSE frames for any role; a mid-stream failure becomes an error frame", async () => {
    const frames: string[] = [];
    for await (const f of (await setup()(as("elena", "POST", "/api/ask", { question: "what's pending?" }))).sse!) frames.push(f.event);
    expect(frames).toEqual(["status", "delta", "result", "done"]);
    const broken = setup(undefined, async function* () { yield "partial"; throw Object.assign(new Error("overloaded"), { status: 529 }); });
    const out: SseFrame[] = [];
    for await (const f of (await broken(as("luca", "POST", "/api/ask", { question: "q" }))).sse!) out.push(f);
    expect(out.at(-1)).toMatchObject({ event: "error", data: { status: 502, kind: "upstream" } });
    expect((await setup()(as("luca", "POST", "/api/ask", { question: "" }))).status).toBe(400);
  });

  it("plan-refunds: agents only, and the kill switch", async () => {
    expect((await setup()(as("elena", "POST", "/api/plan-refunds", { instruction: "x" }))).status).toBe(403);
    process.env.DISABLED_AI_FEATURES = "plan";
    expect((await setup()(as("luca", "POST", "/api/plan-refunds", { instruction: "x" }))).status).toBe(503);
  });

  it("AI responses carry their provenance; a draft's provenance is validated and kept", async () => {
    const reply = { stop_reason: "tool_use", content: [{ type: "tool_use", name: "report_refund_request", input: { isRefundRequest: true, orderId: "ORD-1042",
      items: [{ description: "sand vase", quantity: 1 }], reason: "damaged", refundShipping: false, requestedAmount: null, summary: "Broken vase." } }] };
    const h = setup(async () => reply);
    const req = as("luca", "POST", "/api/read-request", { message: { from: "mario.rossi@example.com", body: "vase broken ORD-1042" } });
    const read = await h({ ...req, headers: { ...req.headers, "x-trace-id": "trace-read-0001" } });
    expect(json(read).provenance).toMatchObject({ feature: "read", traceId: "trace-read-0001", promptVersion: expect.stringMatching(/^read-refund-request@/) });
    const ai = { ...json(read).provenance, edited: false };
    const created = json(await h(as("luca", "POST", "/api/refunds", { ...draft, source: "ai", ai }))).refund;
    expect(created.ai).toEqual(ai);
    expect(created.history[0]).toMatchObject({ action: "created", by: "luca", role: "agent" });
    expect((await h(as("luca", "POST", "/api/refunds", { ...draft, source: "ai", ai: { feature: "read", traceId: "<script>" } }))).status).toBe(400);
  });

  it("feedback and outcomes: logged per trace id, counted for the supervisor's metrics", async () => {
    const h = setup(async () => ({ content: [] }));   // a reply with no tool call: unusable output
    expect((await h(as("luca", "POST", "/api/feedback", { feature: "ask", traceId: "trace-ask-0001", rating: "down", comment: "wrong order" }))).status).toBe(200);
    expect((await h(as("luca", "POST", "/api/feedback", { feature: "ask", traceId: "trace-ask-0001", rating: "meh" }))).status).toBe(400);
    expect((await h(as("luca", "POST", "/api/feedback", { feature: "other", traceId: "trace-ask-0001", rating: "up" }))).status).toBe(400);

    expect((await h(as("luca", "POST", "/api/read-request", { message: { body: "hi" } }))).status).toBe(502);
    const ai = { feature: "read", traceId: "trace-read-0002", model: "m", promptVersion: "read-refund-request@2", edited: true };
    const created = json(await h(as("luca", "POST", "/api/refunds", { ...draft, source: "ai", ai }))).refund;
    await h(as("sara", "POST", `/api/refunds/${created.id}/approve`, {}));

    expect((await h(as("luca", "GET", "/api/ai-metrics"))).status).toBe(403);
    const m = json(await h(as("elena", "GET", "/api/ai-metrics"))).features;
    expect(m.ask.feedback).toEqual({ up: 0, down: 1 });
    expect(m.read).toMatchObject({ created: 1, edited: 1, approved: 1, failures: 1 });
    const logged = vi.mocked(console.error).mock.calls.map((c) => String(c[0]));
    expect(logged.some((l) => l.startsWith("[outcome]") && l.includes('"trace_id":"trace-read-0002"'))).toBe(true);
    expect(logged.some((l) => l.startsWith("[tool_failure]") && l.includes('"feature":"read"'))).toBe(true);
  });

  it("an invented citation in Ask counts as a failure", async () => {
    const h = setup(undefined, async function* () { yield "See [#RF-9999]."; });
    for await (const _ of (await h(as("elena", "POST", "/api/ask", { question: "what's pending?" }))).sse!) void _;
    expect(json(await h(as("elena", "GET", "/api/ai-metrics"))).features.ask.failures).toBe(1);
  });
});

describe("gradual model release", () => {
  afterEach(() => { delete process.env.READ_CANARY_MODEL; delete process.env.CANARY_PERCENT; });

  it("a user in the canary share gets the new model, recorded on the draft and in the per-model metrics", async () => {
    const reply = { stop_reason: "tool_use", content: [{ type: "tool_use", name: "report_refund_request", input: { isRefundRequest: true, orderId: "ORD-1042",
      items: [{ description: "sand vase", quantity: 1 }], reason: "damaged", refundShipping: false, requestedAmount: null, summary: "Broken vase." } }] };
    const seen: string[] = [];
    const h = setup(async (req) => { seen.push(req.model); return reply; });
    process.env.READ_CANARY_MODEL = "claude-canary-test";
    process.env.CANARY_PERCENT = "100";
    const read = json(await h(as("luca", "POST", "/api/read-request", { message: { from: "mario.rossi@example.com", body: "vase broken ORD-1042" } })));
    expect(seen).toEqual(["claude-canary-test"]);
    expect(read.provenance.model).toBe("claude-canary-test");
    await h(as("luca", "POST", "/api/refunds", { ...draft, source: "ai", ai: { ...read.provenance, edited: true } }));
    const m = json(await h(as("elena", "GET", "/api/ai-metrics"))).features.read;
    expect(m.byModel["claude-canary-test"]).toEqual({ created: 1, edited: 1, approved: 0, rejected: 0 });
  });
});

describe("daily AI budget per user", () => {
  it("refuses the AI routes to a user over budget, with the manual path open and other users unaffected", async () => {
    const spend = createSpendLedger({ dailyUsdPerUser: 0.01 });
    const h = createHandlers({ store: createStore(undefined, { now: () => "2026-10-29" }), complete: async () => ({ content: [] }), stream: async function* () { yield "ok"; }, sessions, spend });
    spend.record({ t: "", label: "read_request", model: "m", in_tokens: 1, out_tokens: 1, latency_ms: 1, user: "luca", est_usd: 0.02 });
    const over = await h(as("luca", "POST", "/api/read-request", { message: { body: "hi" } }));
    expect(over.status).toBe(429);
    expect(json(over)).toMatchObject({ kind: "budget" });
    expect((await h(as("luca", "POST", "/api/refunds", draft))).status).toBe(201);          // the manual path still works
    expect((await h(as("sara", "POST", "/api/read-request", { message: { body: "hi" } }))).status).not.toBe(429);
  });
});

describe("sessions", () => {
  it("signs in with a known account: an HttpOnly, SameSite=Strict cookie that then names the user", async () => {
    const h = setup();
    const accounts = json(await h(as(null, "GET", "/api/accounts")));
    expect(accounts.users.map((u: { id: string }) => u.id)).toEqual(["luca", "sara", "elena"]);
    const out = await h(as(null, "POST", "/api/session", { userId: "elena" }));
    expect(out.status).toBe(200);
    const cookie = out.headers["Set-Cookie"];
    expect(cookie).toMatch(/^rc_session=elena\.\d+\.[\w-]+; Path=\/; HttpOnly; SameSite=Strict; Max-Age=28800$/);
    const value = cookie.split(";")[0];
    const me = await h({ ...as(null, "GET", "/api/me"), headers: { cookie: value } });
    expect(json(me).user).toMatchObject({ id: "elena", role: "supervisor" });
    expect((await h(as(null, "POST", "/api/session", { userId: "mallory" }))).status).toBe(401);
    expect((await h(as("elena", "POST", "/api/session/logout", {}))).headers["Set-Cookie"]).toMatch(/Max-Age=0/);
  });

  it("rejects no session, a forged or tampered cookie, an expired one, and ignores x-user", async () => {
    const h = setup();
    const call = (headers: Record<string, string>) => h({ method: "GET", path: "/api/refunds", headers, ip: "1.1.1.1" });
    expect((await call({})).status).toBe(401);
    expect((await call({ "x-user": "elena" })).status).toBe(401);
    const forged = createSessions({ secret: "attacker" }).issue("elena");
    expect((await call({ cookie: `rc_session=${forged}` })).status).toBe(401);
    const [, exp, sig] = sessions.issue("luca").split(".");
    expect((await call({ cookie: `rc_session=elena.${exp}.${sig}` })).status).toBe(401);   // luca's signature, elena's name
    const old = createSessions({ secret: "test-secret", now: () => Date.now() - 9 * 3600 * 1000 }).issue("luca");
    expect((await call({ cookie: `rc_session=${old}` })).status).toBe(401);
    expect((await call({ cookie: `rc_session=${sessions.issue("luca")}` })).status).toBe(200);
  });

  it("CSRF: a POST that isn't JSON is refused before anything runs", async () => {
    const h = setup();
    const req = as("luca", "POST", "/api/refunds", draft);
    const out = await h({ ...req, headers: { ...req.headers, "content-type": "application/x-www-form-urlencoded" } });
    expect(out.status).toBe(415);
  });
});
