import { useEffect, useId, useMemo, useState } from "react"
import { Button } from "@refund-copilot/ui/button"
import { Input } from "@refund-copilot/ui/input"
import { Badge } from "@refund-copilot/ui/badge"
import { api, ApiError, eur } from "../api"
import { REASONS, type Draft, type Order, type Preview, type Provenance, type Refund } from "../types"
import ChecksList from "./ChecksList"
import Feedback from "./Feedback"
import PipelineSteps, { type PipelineStep } from "./PipelineSteps"

/**
 * Step 2: the agent reviews the draft. Every field is editable; the amount and the
 * checks come back from the server on each change (POST /api/refunds/preview), so
 * the screen never computes a price or a rule itself.
 */
const DraftReview = ({ orders, initial, ai, onCreated, onCancel }: {
  orders: Order[]
  initial: Draft
  ai?: { summary: string; unmatched: string[]; from: Record<string, string>; provenance: Provenance }
  onCreated: (r: Refund) => void
  onCancel: () => void
}) => {
  const [draft, setDraft] = useState<Draft>(initial)
  const [preview, setPreview] = useState<Preview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const id = useId()
  const order = orders.find((o) => o.id === draft.orderId.trim().toUpperCase())
  const key = JSON.stringify(draft)

  useEffect(() => {
    let alive = true
    const t = setTimeout(() => {
      api<Preview>("POST", "/api/refunds/preview", draft)
        .then((p) => { if (alive) setPreview(p) })
        .catch((err) => { if (alive) setError(err instanceof ApiError ? err.message : "Couldn't check the draft.") })
    }, 250)
    return () => { alive = false; clearTimeout(t) }
    // `key` stands for the whole draft
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  const qty = useMemo(() => Object.fromEntries(draft.items.map((i) => [i.sku, i.qty])), [draft.items])
  const setQty = (sku: string, n: number) =>
    setDraft((d) => ({ ...d, items: n > 0 ? [...d.items.filter((i) => i.sku !== sku), { sku, qty: n }] : d.items.filter((i) => i.sku !== sku) }))

  const blocked = preview?.checks.some((c) => c.level === "block") ?? true
  const blocks = preview?.checks.filter((c) => c.level === "block").length ?? 0
  const initialOrder = orders.find((o) => o.id === initial.orderId)
  // What happened to the AI's reading, step by step: where the model stopped and code took over.
  const steps: PipelineStep[] | null = ai ? [
    { label: "AI read the request", state: "done", detail: ai.provenance.promptVersion },
    initialOrder
      ? { label: "Order matched", state: "done", detail: initialOrder.id }
      : { label: "No matching order", state: "attention", detail: initial.orderId ? `${initial.orderId} isn't in the shop: pick the order` : "the request names none: pick the order" },
    ai.unmatched.length
      ? { label: "Some items not matched", state: "attention", detail: `${initial.items.length} matched, ${ai.unmatched.length} not: check the quantities` }
      : { label: "Items matched", state: "done", detail: `${initial.items.length} line${initial.items.length === 1 ? "" : "s"}` },
    { label: "Priced from the order", state: preview?.amount != null ? "done" : "pending", detail: preview?.amount != null ? eur(preview.amount) : undefined },
    { label: blocks ? "Policy blocks this refund" : "Policy checks", state: !preview ? "pending" : blocks ? "attention" : "done", detail: preview ? (blocks ? `${blocks} blocking` : "nothing blocks") : undefined },
  ] : null

  const create = async () => {
    setBusy(true); setError(null)
    try {
      // An AI draft carries where it came from, and whether the agent changed it: the audit trail and the edit rate.
      const body: Draft = ai ? { ...draft, ai: { ...ai.provenance, edited: key !== JSON.stringify(initial) } } : draft
      const { refund } = await api<{ refund: Refund }>("POST", "/api/refunds", body)
      onCreated(refund)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't create the refund.")
    } finally {
      setBusy(false)
    }
  }

  const field = "flex flex-col gap-1"
  const lbl = "text-xs font-medium"
  return (
    <div className="flex flex-col gap-4">
      {ai && (
        <p className="rounded-[var(--radius-md)] p-3 text-sm" style={{ background: "rgb(var(--surface-subtle))", color: "rgb(var(--text))" }}>
          <span className="font-medium">The AI read: </span>{ai.summary}
          {ai.unmatched.length > 0 && <span className="block text-xs" style={{ color: "rgb(var(--text-muted))" }}>Not matched to an order line: {ai.unmatched.join(", ")}</span>}
          {steps && <span className="mt-2 block"><PipelineSteps label="What the copilot did" steps={steps} /></span>}
          <span className="mt-2 block"><Feedback feature="read" traceId={ai.provenance.traceId} label="Did the AI read it right?" /></span>
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className={field}>
          <label htmlFor={`${id}-order`} className={lbl} style={{ color: "rgb(var(--text-muted))" }}>Order</label>
          <select id={`${id}-order`} value={draft.orderId} onChange={(e) => setDraft((d) => ({ ...d, orderId: e.target.value, items: [] }))}
            className="h-10 rounded-[var(--radius-md)] border px-2 text-sm" style={{ borderColor: "rgb(var(--border-input))", background: "rgb(var(--surface-card))", color: "rgb(var(--text))" }}>
            {!order && <option value={draft.orderId}>{draft.orderId || "Pick an order"}</option>}
            {orders.map((o) => <option key={o.id} value={o.id}>{o.id} · {o.customerEmail}</option>)}
          </select>
        </div>
        <div className={field}>
          <label htmlFor={`${id}-email`} className={lbl} style={{ color: "rgb(var(--text-muted))" }}>Customer (request sender)</label>
          <Input id={`${id}-email`} value={draft.customerEmail} onChange={(e) => setDraft((d) => ({ ...d, customerEmail: e.target.value }))} />
        </div>
      </div>

      {order && (
        <fieldset className="flex flex-col gap-2">
          <legend className={lbl} style={{ color: "rgb(var(--text-muted))" }}>Items to refund</legend>
          {order.items.map((line) => (
            <div key={line.sku} className="flex flex-wrap items-center gap-3 text-sm">
              <label htmlFor={`${id}-${line.sku}`} className="flex-1 min-w-[12rem]" style={{ color: "rgb(var(--text))" }}>
                {line.name} <span style={{ color: "rgb(var(--text-muted))" }}>· {eur(line.unitPrice)} × {line.qty} ordered</span>
                {ai?.from[line.sku] && <span className="block text-xs" style={{ color: "rgb(var(--text-muted))" }}>customer wrote: "{ai.from[line.sku]}"</span>}
              </label>
              <input id={`${id}-${line.sku}`} type="number" min={0} max={line.qty} value={qty[line.sku] ?? 0} aria-label={`Quantity of ${line.name} to refund`}
                onChange={(e) => setQty(line.sku, Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                className="h-9 w-16 rounded-[var(--radius-md)] border px-2" style={{ borderColor: "rgb(var(--border-input))", background: "rgb(var(--surface-card))", color: "rgb(var(--text))" }} />
            </div>
          ))}
          <label className="flex items-center gap-2 text-sm" style={{ color: "rgb(var(--text))" }}>
            <input type="checkbox" checked={draft.refundShipping} onChange={(e) => setDraft((d) => ({ ...d, refundShipping: e.target.checked }))} />
            Refund shipping ({eur(order.shipping)})
          </label>
        </fieldset>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <div className={field}>
          <label htmlFor={`${id}-reason`} className={lbl} style={{ color: "rgb(var(--text-muted))" }}>Reason</label>
          <select id={`${id}-reason`} value={draft.reason} onChange={(e) => setDraft((d) => ({ ...d, reason: e.target.value as Draft["reason"] }))}
            className="h-10 rounded-[var(--radius-md)] border px-2 text-sm" style={{ borderColor: "rgb(var(--border-input))", background: "rgb(var(--surface-card))", color: "rgb(var(--text))" }}>
            {REASONS.map((r) => <option key={r} value={r}>{r.replace("_", " ")}</option>)}
          </select>
        </div>
        <div className="flex flex-col justify-end gap-1">
          <span className={lbl} style={{ color: "rgb(var(--text-muted))" }}>Refund amount (from the order's prices)</span>
          <span className="text-2xl font-semibold tabular-nums" style={{ color: "rgb(var(--text))" }}>{preview?.amount != null ? eur(preview.amount) : "—"}</span>
          {draft.requestedAmount != null && <Badge variant="outline">customer asked for {eur(draft.requestedAmount)}</Badge>}
        </div>
      </div>

      <div aria-live="polite">{preview && <ChecksList checks={preview.checks} />}</div>
      {error && <p role="alert" className="text-sm" style={{ color: "rgb(var(--feedback-error))" }}>{error}</p>}

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="default" onClick={create} disabled={busy || blocked}>{busy ? "Creating…" : "Create refund"}</Button>
        <Button variant="ghost" onClick={onCancel}>Cancel</Button>
        {blocked && preview && <span className="text-xs" style={{ color: "rgb(var(--text-muted))" }}>Fix the blocking checks first, or reply to the customer.</span>}
      </div>
    </div>
  )
}

export default DraftReview
