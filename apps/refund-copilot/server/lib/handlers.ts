/**
 * Transport-agnostic handlers for the refund copilot API. The shell turns HTTP
 * into { method, path, headers, body, ip, signal }; all policy lives here.
 *
 * Every request is made BY a user: the signed session cookie names them (session.ts),
 * and the store decides what that user may do. Only the account list and signing
 * in / out are reachable without one. Every POST must be JSON: a cross-site form
 * can't send that without a CORS preflight, which this server never grants.
 *
 * Status contract (src/api.ts maps each one):
 *   400 bad input · 401 no user · 403 role / limit / four-eyes · 404 · 409 state
 *   413/415 file · 429 rate limit · 502 invalid_output | upstream · 503 kill switch · 500 our bug
 */
import { isFeatureEnabled, logEvent, resolveTraceId } from "@refund-copilot/ai-runtime/observability";
import { createRateLimiter, type RateLimiter } from "@refund-copilot/ai-runtime/rateLimit";
import { createSpendLedger, type SpendLedger } from "@refund-copilot/ai-runtime/spend";
import type { Complete, Stream } from "@refund-copilot/ai-runtime/types";
import { DomainError, type Store } from "./refunds.ts";
import { readRequest } from "./readRequest.ts";
import { askShop, validateHistory, MAX_QUESTION_LENGTH, type AskEvent } from "./askShop.ts";
import { planRefunds, MAX_INSTRUCTION_LENGTH } from "./planRefunds.ts";
import { aiCall } from "./aiCall.ts";
import type { Refund, User } from "./types.ts";
import { createOutcomes, FEEDBACK_FEATURES, type FeedbackFeature, type Outcomes } from "./outcomes.ts";
import { createSessions, readCookie, SESSION_COOKIE, type Sessions } from "./session.ts";
import type { SemanticSearch } from "./semantic.ts";
import { PayloadError, TRACE_RE, isObject, text, validateDraftBody } from "./validation.ts";
import { errorStatus, errorMessage } from "./errors.ts";

interface ApiRequest {
  method: string;
  path: string;
  headers?: Record<string, string | string[] | undefined>;
  body?: unknown;
  ip: string;
  signal?: AbortSignal;
}

export interface SseFrame { event: string; data: unknown }

/** What the transport writes back: JSON, or a stream of SSE frames. */
export interface ApiResponse {
  status: number;
  headers: Record<string, string>;
  body?: unknown;
  sse?: AsyncGenerator<SseFrame>;
}

type Body = Record<string, unknown>;
interface Ctx { user: User; body: Body; traceId: string; signal?: AbortSignal }
interface PublicCtx { body: Body }
type RouteResult = unknown | { sse: AsyncIterable<AskEvent> };
type Route = [method: string, pattern: RegExp, fn: (ctx: Ctx, args: string[]) => RouteResult | Promise<RouteResult>, opts?: { feature?: string; status?: number }];

/** A route result that also sets response headers (the session cookie). */
class WithHeaders {
  readonly body: unknown;
  readonly headers: Record<string, string>;
  constructor(body: unknown, headers: Record<string, string>) { this.body = body; this.headers = headers; }
}
const hasSse = (v: unknown): v is { sse: AsyncIterable<AskEvent> } => isObject(v) && "sse" in v;

const isFeedbackFeature = (f: unknown): f is FeedbackFeature => (FEEDBACK_FEATURES as readonly unknown[]).includes(f);

export function createHandlers({ store, complete, stream, outcomes = createOutcomes(), sessions = createSessions(), spend = createSpendLedger(), rateLimit = createRateLimiter(), semantic, aiStub = false }: {
  store: Store; complete: Complete; stream: Stream; outcomes?: Outcomes; sessions?: Sessions; spend?: SpendLedger; rateLimit?: RateLimiter; semantic?: SemanticSearch; aiStub?: boolean;
}) {
  const withBlocker = (user: User, r: Refund) => ({ ...r, approveBlocker: store.approveBlocker(user, r) });
  const tracked = (r: Refund, outcome: "created" | "approved" | "rejected") => { outcomes.outcome(r, outcome); return r; };
  // Reachable without a session: the demo accounts to pick from, and signing in / out.
  const publicRoutes: [method: string, pattern: RegExp, fn: (ctx: PublicCtx) => unknown][] = [
    ["GET", /^\/api\/accounts$/, () => ({ users: store.users(), shop: store.shop })],
    ["POST", /^\/api\/session$/, ({ body }) => {
      const user = typeof body.userId === "string" ? store.user(body.userId) : null;
      if (!user) throw new DomainError(401, "Unknown account.");
      return new WithHeaders({ user }, { "Set-Cookie": sessions.setCookie(sessions.issue(user.id)) });
    }],
    ["POST", /^\/api\/session\/logout$/, () => new WithHeaders({ ok: true }, { "Set-Cookie": sessions.clearCookie() })],
  ];

  const routes: Route[] = [
    ["GET", /^\/api\/me$/, (ctx) => ({ user: ctx.user, users: store.users(), shop: store.shop, policy: store.policy, aiStub })],
    ["GET", /^\/api\/orders$/, () => ({ orders: store.orders() })],
    ["GET", /^\/api\/refunds$/, (ctx) => ({ refunds: store.list().map((r) => withBlocker(ctx.user, r)) })],
    ["POST", /^\/api\/read-request$/, async (ctx) => {
      if (ctx.user.role !== "agent") throw new DomainError(403, "Only a support agent works on customer requests.");
      const call = aiCall("read", ctx);
      return { ...(await readRequest(ctx.body, complete, store, call.meta, call.model)), provenance: call.provenance };
    }, { feature: "read" }],
    ["POST", /^\/api\/ask$/, (ctx) => {
      const call = aiCall("ask", ctx);
      const input = { question: text(ctx.body.question, MAX_QUESTION_LENGTH, "question"), history: validateHistory(ctx.body.history) };
      return { sse: askShop(input, store, stream, call.meta, call.model, semantic) };
    }, { feature: "ask" }],
    ["POST", /^\/api\/plan-refunds$/, async (ctx) => {
      if (ctx.user.role !== "agent") throw new DomainError(403, "Only a support agent proposes refunds.");
      const call = aiCall("plan", ctx);
      const { invalid, ...plan } = await planRefunds(text(ctx.body.instruction, MAX_INSTRUCTION_LENGTH, "instruction"), store, complete, call.meta, call.model);
      if (invalid.length) outcomes.failure({ feature: "plan", traceId: ctx.traceId, kind: "invalid_output", detail: invalid.join("; ").slice(0, 300) });
      return { ...plan, provenance: call.provenance };
    }, { feature: "plan" }],
    ["POST", /^\/api\/refunds\/preview$/, (ctx) => store.preview(validateDraftBody(ctx.body))],
    ["POST", /^\/api\/refunds$/, (ctx) => ({ refund: withBlocker(ctx.user, tracked(store.create(ctx.user, validateDraftBody(ctx.body), { traceId: ctx.traceId }), "created")) }), { status: 201 }],
    ["POST", /^\/api\/refunds\/([\w-]+)\/approve$/, (ctx, [id]) => ({ refund: withBlocker(ctx.user, tracked(store.approve(ctx.user, id, { traceId: ctx.traceId }), "approved")) })],
    ["POST", /^\/api\/refunds\/([\w-]+)\/reject$/, (ctx, [id]) => ({ refund: withBlocker(ctx.user, tracked(store.reject(ctx.user, id, ctx.body.reason, { traceId: ctx.traceId }), "rejected")) })],
    ["POST", /^\/api\/feedback$/, (ctx) => {
      const { feature, traceId, rating, comment } = ctx.body;
      if (!isFeedbackFeature(feature)) throw new PayloadError("feature must be read, ask or plan.");
      if (typeof traceId !== "string" || !TRACE_RE.test(traceId)) throw new PayloadError("traceId is required.");
      if (rating !== "up" && rating !== "down") throw new PayloadError("rating must be up or down.");
      outcomes.feedback({ feature, traceId, rating, comment: typeof comment === "string" ? comment.trim().slice(0, 300) || null : null, user: ctx.user.id });
      return { ok: true };
    }],
    ["GET", /^\/api\/ai-metrics$/, (ctx) => {
      if (ctx.user.role !== "supervisor") throw new DomainError(403, "Only a supervisor sees the AI metrics.");
      return { features: outcomes.snapshot() };
    }],
  ];

  // SSE framing; the [request] line is written when the stream ends (only then are status and latency known).
  async function* toSse(events: AsyncIterable<AskEvent>, ctx: { traceId: string; start: number; route: string; user: string }): AsyncGenerator<SseFrame> {
    let status = 200;
    let reason: string | undefined;
    try {
      for await (const ev of events) {
        if (ev.type === "result" && ev.invalidCitations.length) outcomes.failure({ feature: "ask", traceId: ctx.traceId, kind: "invented_citation", detail: ev.invalidCitations.join(", ") });
        yield { event: ev.type, data: ev };
      }
      yield { event: "done", data: { traceId: ctx.traceId } };
    } catch (err) {
      const [s, message, kind] = errorStatus(err);
      status = s;
      reason = errorMessage(err) ?? message;
      if (status === 500) console.error("server error:", err);
      if (status !== 499) yield { event: "error", data: { status, error: message, kind } };
    } finally {
      logEvent("request", { trace_id: ctx.traceId, method: "POST", route: ctx.route, status, latency_ms: Math.round(performance.now() - ctx.start), user: ctx.user, ...(reason ? { reason } : {}) });
    }
  }

  return async function handle(req: ApiRequest): Promise<ApiResponse> {
    const start = performance.now();
    const traceId = resolveTraceId(req.headers?.["x-trace-id"]);
    const headers = { "x-trace-id": traceId };
    const path = String(req.path ?? "").split("?")[0];
    const done = (status: number, body: unknown, reason?: string | null, extra: Record<string, unknown> = {}): ApiResponse => {
      logEvent("request", { trace_id: traceId, method: req.method, route: path, status, latency_ms: Math.round(performance.now() - start), ...extra, ...(reason ? { reason } : {}) });
      return { status, headers, body };
    };

    const respond = (status: number, out: unknown, extra: Record<string, unknown> = {}): ApiResponse => {
      if (!(out instanceof WithHeaders)) return done(status, out, null, extra);
      const r = done(status, out.body, null, extra);
      return { ...r, headers: { ...r.headers, ...out.headers } };
    };

    // CSRF: a POST must be JSON (see the header comment), checked before anything else.
    const type = String(req.headers?.["content-type"] ?? "");
    if (req.method === "POST" && !/^application\/json\b/i.test(type)) return done(415, { error: "Send JSON (Content-Type: application/json)." }, "not json");

    const open = publicRoutes.find(([m, re]) => m === req.method && re.test(path));
    if (open) {
      try {
        return respond(200, await open[2]({ body: isObject(req.body) ? req.body : {} }));
      } catch (err) {
        const [status, message, kind] = errorStatus(err);
        return done(status, { error: message, kind }, errorMessage(err));
      }
    }

    const matches = routes.map(([m, re, fn, opts]) => ({ m, fn, opts: opts ?? {}, args: path.match(re) })).filter((r) => r.args);
    if (matches.length === 0) return done(404, { error: "Not found." });
    const route = matches.find((r) => r.m === req.method);
    if (!route) return done(405, { error: `Method not allowed. Use ${matches.map((r) => r.m).join(" or ")}.` });

    // The user comes from the signed session cookie only; nothing the client sends can name another.
    const userId = sessions.verify(readCookie(req.headers?.cookie, SESSION_COOKIE));
    const user = userId ? store.user(userId) : null;
    if (!user) return done(401, { error: "Sign in first." }, "no session");

    const { feature, status: okStatus = 200 } = route.opts;
    if (feature && !isFeatureEnabled(feature)) {
      return done(503, { error: "This AI feature is switched off right now. Use the manual option.", disabled: true }, "kill switch", { user: user.id });
    }
    if (feature && rateLimit.isLimited(req.ip)) return done(429, { error: "Too many requests. Try again in a minute." }, "rate limited", { user: user.id });
    if (feature && spend.isOverBudget(user.id)) {
      return done(429, { error: "You've reached today's AI budget. Use the manual option; it resets tomorrow.", kind: "budget" }, "spend cap", { user: user.id });
    }
    if (req.method === "POST" && !isObject(req.body)) return done(400, { error: "Body must be a JSON object." }, null, { user: user.id });

    try {
      const body = await route.fn({ user, body: isObject(req.body) ? req.body : {}, traceId, signal: req.signal }, (route.args ?? []).slice(1));
      if (hasSse(body)) return { status: 200, headers, sse: toSse(body.sse, { traceId, start, route: path, user: user.id }) };
      return done(okStatus, body, null, { user: user.id });
    } catch (err) {
      const [status, message, kind] = errorStatus(err);
      if (status === 500) console.error("server error:", err);
      if (kind === "invalid_output" && isFeedbackFeature(feature)) outcomes.failure({ feature, traceId, kind, detail: errorMessage(err) });
      return done(status, { error: message, kind }, errorMessage(err), { user: user.id });
    }
  };
}
