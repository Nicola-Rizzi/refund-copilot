/**
 * Orders, refunds and the rules for who may do what — the authorization boundary.
 *
 * The server owns the data. The browser sends a draft (what the agent reviewed),
 * never the order or the price: those are read here. And every call names the
 * acting user, whose role decides:
 *
 *   agent       creates refund drafts; approves up to policy.agentLimit (100 €)
 *   supervisor  approves anything; never a refund they created (four eyes)
 *   anyone      can't approve a refund with a blocking check
 *
 * Every change appends to the refund's history (who, in which role, what, when,
 * and the request's trace id): the audit trail is written here, next to the
 * rule that allowed the change, so no route can change a refund without it.
 *
 * In-memory, seeded from data/seed.json (dates as "days ago", so the demo never
 * goes stale): a restart resets it.
 */
import { readFileSync } from "node:fs";
import { runChecks, isBlocked, daysAgoToDate, type CheckContext } from "./checks.ts";
import type { AuditEvent, Draft, Order, Preview, Refund, Seed, User } from "./types.ts";

/** A rule said no: 403 (who), 404 (which), 409 (when). */
export class DomainError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.name = "DomainError"; this.status = status; }
}

const SEED_PATH = new URL("../data/seed.json", import.meta.url);
const today = () => new Date().toISOString().slice(0, 10);

const loadSeed = (): Seed => JSON.parse(readFileSync(SEED_PATH, "utf8")) as Seed;

/** Who is acting, and in which request. */
interface Act { traceId?: string }

export function createStore(seed: Seed = loadSeed(), { now = today, clock = () => new Date().toISOString() }: { now?: () => string; clock?: () => string } = {}) {
  const t = now();
  const users = new Map<string, User>(seed.users.map((u) => [u.id, u]));
  const policy = seed.policy;
  const orders: Order[] = seed.orders.map((o) => ({ ...o, deliveredAt: daysAgoToDate(t, o.deliveredDaysAgo), shippedAt: daysAgoToDate(t, o.shippedDaysAgo) }));
  const roleOf = (id: string) => users.get(id)?.role ?? "agent";
  // Seeded refunds get the history they would have had: created, then approved or rejected.
  const refunds: Refund[] = seed.refunds.map(({ createdDaysAgo, ...r }) => {
    const createdAt = daysAgoToDate(t, createdDaysAgo) ?? t;
    const history: AuditEvent[] = [{ at: createdAt, by: r.createdBy, role: roleOf(r.createdBy), action: "created" }];
    if (r.status === "approved" && r.approvedBy) history.push({ at: createdAt, by: r.approvedBy, role: roleOf(r.approvedBy), action: "approved" });
    if (r.status === "rejected" && r.rejection) history.push({ at: createdAt, by: r.rejection.by, role: roleOf(r.rejection.by), action: "rejected", ...(r.rejection.reason ? { note: r.rejection.reason } : {}) });
    return { ...r, createdAt, history };
  });
  const record = (r: Refund, user: User, action: AuditEvent["action"], act: Act, note?: string | null) =>
    r.history.push({ at: clock(), by: user.id, role: user.role, action, ...(act.traceId ? { traceId: act.traceId } : {}), ...(note ? { note } : {}) });
  let seq = 2000 + refunds.length + 1;

  const ctx = (exclude?: Refund): CheckContext => ({ orders, refunds: refunds.filter((r) => r !== exclude), policy, today: now() });
  // Only open refunds are checked against today's state. A refund approved weeks ago
  // was checked then; re-running the window rule today would wrongly flag it.
  for (const r of refunds) if (r.status === "pending_approval" && r.checks.length === 0) r.checks = runChecks(r, ctx(r)).checks;

  const find = (id: string): Refund => {
    const r = refunds.find((x) => x.id === id);
    if (!r) throw new DomainError(404, `No refund ${id}.`);
    return r;
  };
  const canApprove = (user: User, r: Refund): string | null => {
    if (r.amount > policy.agentLimit && user.role !== "supervisor") return `Over ${policy.agentLimit.toFixed(2)} €: only a supervisor can approve.`;
    if (user.role === "supervisor" && r.createdBy === user.id) return "You can't approve a refund you created (four-eyes rule).";
    return null;
  };

  return {
    shop: seed.shop,
    policy,
    user: (id: string): User | null => users.get(id) ?? null,
    users: (): User[] => [...users.values()],
    orders: (): Order[] => structuredClone(orders),
    order: (id: string): Order | null => structuredClone(orders.find((o) => o.id === id) ?? null),
    list: (): Refund[] => structuredClone(refunds).sort((a, b) => b.id.localeCompare(a.id)),

    /** Checks + computed amount for a draft, without saving — what the review screen shows. */
    preview: (draft: Draft): Preview => runChecks(draft, ctx()),

    create(user: User, draft: Draft, act: Act = {}): Refund {
      if (user.role !== "agent") throw new DomainError(403, "Only a support agent creates refunds.");
      const { checks, amount } = runChecks(draft, ctx());
      const r: Refund = {
        id: `RF-${seq++}`,
        orderId: String(draft.orderId).trim().toUpperCase(),
        customerEmail: String(draft.customerEmail ?? "").trim().toLowerCase(),
        reason: draft.reason,
        items: draft.items,
        refundShipping: draft.refundShipping === true,
        amount: amount ?? 0,
        createdBy: user.id,
        createdAt: now(),
        status: isBlocked(checks) ? "blocked" : "pending_approval",
        approvedBy: null,
        checks,
        source: draft.source ?? "manual",
        ...(draft.source === "ai" && draft.ai ? { ai: draft.ai } : {}),
        history: [],
      };
      record(r, user, "created", act);
      refunds.push(r);
      return structuredClone(r);
    },

    approve(user: User, id: string, act: Act = {}): Refund {
      const r = find(id);
      if (r.status === "blocked" || isBlocked(r.checks)) throw new DomainError(409, "This refund has a blocking check and can't be approved.");
      if (r.status !== "pending_approval") throw new DomainError(409, `This refund is ${r.status.replace("_", " ")}.`);
      const why = canApprove(user, r);
      if (why) throw new DomainError(403, why);
      r.status = "approved";
      r.approvedBy = user.id;
      record(r, user, "approved", act);
      return structuredClone(r);
    },

    reject(user: User, id: string, reason?: unknown, act: Act = {}): Refund {
      const r = find(id);
      if (r.status === "approved" || r.status === "rejected") throw new DomainError(409, `This refund is already ${r.status}.`);
      if (user.role !== "supervisor" && r.createdBy !== user.id) throw new DomainError(403, "Only the agent who created it or a supervisor can reject this refund.");
      r.status = "rejected";
      r.rejection = { by: user.id, reason: String(reason ?? "").slice(0, 200) || null };
      record(r, user, "rejected", act, r.rejection.reason);
      return structuredClone(r);
    },

    /** For the UI: why this user can't approve this refund (null = they can). */
    approveBlocker(user: User, r: Refund): string | null {
      if (r.status !== "pending_approval") return null;
      return canApprove(user, r);
    },
  };
}

export type Store = ReturnType<typeof createStore>;
