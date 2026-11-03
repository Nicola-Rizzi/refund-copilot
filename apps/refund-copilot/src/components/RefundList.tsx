import { useState } from "react"
import { Button } from "@refund-copilot/ui/button"
import { Badge } from "@refund-copilot/ui/badge"
import { api, ApiError, eur, refundAnchor } from "../api"
import type { Refund, User } from "../types"
import ChecksList from "./ChecksList"


const STATUS: Record<Refund["status"], { label: string; variant: "muted" | "success" | "error" | "accent" }> = {
  pending_approval: { label: "pending approval", variant: "accent" },
  approved: { label: "approved", variant: "success" },
  rejected: { label: "rejected", variant: "muted" },
  blocked: { label: "blocked", variant: "error" },
}

/**
 * Step 3: approval. The server says, per user, whether they may approve each
 * refund and why not (approveBlocker), so the screen shows the rule instead of
 * re-implementing it — and the server enforces it again on the click.
 */
const RefundList = ({ user, refunds, onChanged }: { user: User; refunds: Refund[]; onChanged: () => void }) => {
  const [error, setError] = useState<string | null>(null)
  const act = async (r: Refund, action: "approve" | "reject") => {
    setError(null)
    try {
      await api("POST", `/api/refunds/${r.id}/${action}`, {})
      onChanged()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : `Couldn't ${action} ${r.id}.`)
    }
  }
  const canReject = (r: Refund) => (r.status === "pending_approval" || r.status === "blocked") && (user.role === "supervisor" || r.createdBy === user.id)

  return (
    <div className="flex flex-col gap-2">
      {error && <p role="alert" className="text-sm" style={{ color: "rgb(var(--feedback-error))" }}>{error}</p>}
      <ul className="flex flex-col gap-2" aria-label="Refunds">
        {refunds.map((r) => (
          <li key={r.id} id={refundAnchor(r.id)} tabIndex={-1} className="rounded-[var(--radius-md)] border p-3 focus:outline-none focus:ring-2 focus:ring-[rgb(var(--border-focus))]" style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--surface-card))" }}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2 text-sm" style={{ color: "rgb(var(--text))" }}>
                <span className="font-medium">{r.id}</span>
                <span style={{ color: "rgb(var(--text-muted))" }}>{r.orderId} · {r.customerEmail} · {r.reason.replace("_", " ")} · by {r.createdBy}{r.source === "ai" ? " (from AI draft)" : ""}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-semibold tabular-nums" style={{ color: "rgb(var(--text))" }}>{eur(r.amount)}</span>
                <Badge variant={STATUS[r.status].variant}>{STATUS[r.status].label}</Badge>
              </div>
            </div>
            {r.checks.length > 0 && <div className="mt-2"><ChecksList checks={r.checks} compact /></div>}
            <details className="mt-2 text-xs" style={{ color: "rgb(var(--text-muted))" }}>
              <summary className="cursor-pointer">History</summary>
              <ol className="mt-1 flex flex-col gap-0.5 pl-4">
                {r.history.map((e, i) => (
                  <li key={i}>
                    <time dateTime={e.at}>{e.at.length > 10 ? new Date(e.at).toLocaleString() : e.at}</time> · {e.action} by {e.by} ({e.role}){e.note ? `: ${e.note}` : ""}
                  </li>
                ))}
                {r.ai && <li>AI draft: {r.ai.feature === "read" ? "read from the request" : "bulk proposal"} · {r.ai.promptVersion} · {r.ai.edited ? "edited by the agent" : "kept as proposed"}</li>}
              </ol>
            </details>
            {(r.status === "pending_approval" || canReject(r)) && (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                {r.status === "pending_approval" && (
                  <Button size="sm" variant="default" disabled={r.approveBlocker !== null} onClick={() => act(r, "approve")}>Approve</Button>
                )}
                {canReject(r) && <Button size="sm" variant="ghost" onClick={() => act(r, "reject")}>Reject</Button>}
                {r.approveBlocker && <span className="text-xs" style={{ color: "rgb(var(--text-muted))" }}>{r.approveBlocker}</span>}
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}

export default RefundList
