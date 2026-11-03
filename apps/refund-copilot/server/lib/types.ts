/**
 * The refund copilot's domain, as the server sees it. The browser has its own
 * view of the API's shapes in src/types.ts; it never imports server code.
 */
export type Role = "agent" | "supervisor";
export interface User { id: string; name?: string; role: Role }

export interface Policy {
  returnWindowDays: number;
  lostAfterDays: number;
  agentLimit: number;
  historyWindowDays: number;
  historyWarnAt: number;
}

export interface OrderLine { sku: string; name: string; qty: number; unitPrice: number }
export interface Order {
  id: string;
  customerEmail: string;
  status: "delivered" | "shipped";
  shippedDaysAgo: number;
  deliveredDaysAgo: number | null;
  shipping: number;
  items: OrderLine[];
  shippedAt?: string | null;
  deliveredAt?: string | null;
}

/** A line to refund: which SKU, how many. */
export interface LineRef { sku: string; qty: number }

/** Which AI call produced a draft. Joins the refund to that call's [usage] line. */
export interface AiProvenance {
  feature: "read" | "plan";
  traceId: string;
  model: string;
  promptVersion: string;
  edited: boolean;   // the agent changed the AI draft before creating it
}

/**
 * What an agent submits, or the reader / planner builds: never an amount. The
 * reason stays a string here because it arrives from outside; the checks block
 * anything that isn't one of REASONS.
 */
export interface Draft {
  orderId: string | null;
  customerEmail: string | null;
  items: LineRef[];
  reason: string;
  refundShipping: boolean;
  requestedAmount?: number | null;
  source?: "ai" | "manual";
  ai?: AiProvenance;
}

export type CheckLevel = "pass" | "warn" | "block";
export interface Check { id: string; level: CheckLevel; message: string }
export interface Preview { checks: Check[]; amount: number | null }

export type RefundStatus = "pending_approval" | "approved" | "rejected" | "blocked";

/** One line of a refund's audit trail. Append-only; the server writes it, never the client. */
export interface AuditEvent {
  at: string;          // ISO timestamp
  by: string;          // user id
  role: Role;
  action: "created" | "approved" | "rejected";
  traceId?: string;    // the request that did it: joins [request] and [usage] lines
  note?: string;
}
export interface Refund {
  id: string;
  orderId: string;
  customerEmail: string;
  reason: string;
  items: LineRef[];
  refundShipping: boolean;
  amount: number;
  createdBy: string;
  createdAt: string;
  status: RefundStatus;
  approvedBy: string | null;
  checks: Check[];
  source?: "ai" | "manual";
  rejection?: { by: string; reason: string | null };
  ai?: AiProvenance;
  history: AuditEvent[];
}

/** data/seed.json: dates are "days ago", so the demo never goes stale. */
export interface Seed {
  shop: string;
  currency: string;
  policy: Policy;
  users: User[];
  orders: Order[];
  refunds: (Omit<Refund, "createdAt" | "history"> & { createdDaysAgo: number })[];
}
