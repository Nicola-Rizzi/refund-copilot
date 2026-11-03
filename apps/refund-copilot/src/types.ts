// Shapes returned by the refund copilot API (server/lib). The server owns orders,
// prices and rules; the browser only renders them and sends drafts.
export type Role = "agent" | "supervisor";
export interface User { id: string; name: string; role: Role }
export interface Policy { returnWindowDays: number; lostAfterDays: number; agentLimit: number }
export interface Me { user: User; users: User[]; shop: string; policy: Policy; aiStub?: boolean }

export interface OrderLine { sku: string; name: string; qty: number; unitPrice: number }
export interface Order {
  id: string; customerEmail: string; status: "delivered" | "shipped";
  deliveredDaysAgo: number | null; shippedDaysAgo: number; shipping: number; items: OrderLine[];
}

export type CheckLevel = "pass" | "warn" | "block";
export interface Check { id: string; level: CheckLevel; message: string }

export const REASONS = ["damaged", "wrong_item", "not_received", "changed_mind", "late_delivery", "other"] as const;
export type Reason = (typeof REASONS)[number];

/** Which AI call produced a draft: from the read-request / plan-refunds response. */
export interface Provenance { feature: "read" | "plan"; traceId: string; model: string; promptVersion: string }
export interface AiProvenance extends Provenance { edited: boolean }

export interface Draft {
  orderId: string;
  customerEmail: string;
  items: { sku: string; qty: number }[];
  reason: Reason;
  refundShipping: boolean;
  requestedAmount: number | null;
  source?: "ai" | "manual";
  ai?: AiProvenance;
}

export interface Preview { checks: Check[]; amount: number | null }

export interface ReadResult extends Partial<Preview> {
  report: { isRefundRequest: boolean; summary: string; requestedAmount: number | null };
  draft?: Omit<Draft, "items"> & { items: { sku: string; qty: number; from?: string }[] };
  unmatched?: string[];
  provenance: Provenance;
}

export type RefundStatus = "pending_approval" | "approved" | "rejected" | "blocked";
export interface AuditEvent { at: string; by: string; role: Role; action: "created" | "approved" | "rejected"; traceId?: string; note?: string }
export interface Refund {
  id: string; orderId: string; customerEmail: string; reason: Reason; amount: number;
  items: { sku: string; qty: number }[]; refundShipping: boolean;
  createdBy: string; createdAt: string; status: RefundStatus; approvedBy: string | null;
  checks: Check[]; source: "ai" | "manual";
  approveBlocker: string | null; // why the current user can't approve it; null if they can
  ai?: AiProvenance;
  history: AuditEvent[];
}

interface ModelOutcomes { created: number; edited: number; approved: number; rejected: number }
export interface FeatureMetrics { feedback: { up: number; down: number }; created: number; edited: number; approved: number; rejected: number; failures: number; byModel: Record<string, ModelOutcomes> }
export interface AiMetrics { features: Record<"read" | "ask" | "plan", FeatureMetrics> }

export interface Proposal { draft: Draft; amount: number; checks: Check[]; why: string }
export interface Plan { proposals: Proposal[]; blocked: { orderId: string | null; why: string; reasons: string[] }[]; note: string | null; truncated: boolean; provenance: Provenance }
