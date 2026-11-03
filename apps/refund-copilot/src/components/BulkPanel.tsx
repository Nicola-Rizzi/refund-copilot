import { useId, useState } from "react"
import { Button } from "@refund-copilot/ui/button"
import { Input } from "@refund-copilot/ui/input"
import { Badge } from "@refund-copilot/ui/badge"
import { api, ApiError, eur } from "../api"
import type { Plan, Policy, Refund } from "../types"
import Feedback from "./Feedback"
import PipelineSteps from "./PipelineSteps"
import { useElapsed } from "../useElapsed"

/**
 * Bulk refunds: the agent describes a batch ("refund every parcel that never
 * arrived"); the model proposes; every proposal has already been through the
 * policy checks on the server. The agent ticks which to create. Created refunds
 * still follow the approval rules — over the agent limit, a supervisor decides.
 */
const BulkPanel = ({ policy, onCreated }: { policy: Policy; onCreated: () => void }) => {
  const [instruction, setInstruction] = useState("")
  const [plan, setPlan] = useState<Plan | null>(null)
  const [picked, setPicked] = useState<Set<number>>(new Set())
  const [busy, setBusy] = useState<"plan" | "create" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const id = useId()
  const elapsed = useElapsed(busy === "plan")

  const propose = async (e: { preventDefault(): void }) => {
    e.preventDefault()
    setBusy("plan"); setError(null); setDone(null); setPlan(null)
    try {
      const p = await api<Plan>("POST", "/api/plan-refunds", { instruction: instruction.trim() })
      setPlan(p)
      setPicked(new Set(p.proposals.map((_, i) => i)))
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't plan those refunds.")
    } finally { setBusy(null) }
  }

  const create = async () => {
    if (!plan) return
    setBusy("create"); setError(null)
    const made: Refund[] = []
    try {
      for (const i of [...picked].sort()) {
        const { refund } = await api<{ refund: Refund }>("POST", "/api/refunds", { ...plan.proposals[i].draft, ai: { ...plan.provenance, edited: false } })
        made.push(refund)
      }
      const waiting = made.filter((r) => r.status === "pending_approval").length
      setDone(`Created ${made.length} refund${made.length === 1 ? "" : "s"}${waiting ? `; ${waiting} waiting for approval` : ""}.`)
      setPlan(null); setInstruction("")
      onCreated()
    } catch (err) {
      setError(`${made.length} created, then: ${err instanceof ApiError ? err.message : "a refund failed."}`)
      onCreated()
    } finally { setBusy(null) }
  }

  const toggle = (i: number) => setPicked((prev) => { const n = new Set(prev); if (n.has(i)) n.delete(i); else n.add(i); return n })
  const total = plan ? [...picked].reduce((s, i) => s + plan.proposals[i].amount, 0) : 0

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm" style={{ color: "rgb(var(--text-muted))" }}>Describe a batch. The AI proposes; policy checks run on every proposal; you pick what to create.</p>
      <form onSubmit={propose} className="flex gap-2">
        <label htmlFor={`${id}-i`} className="sr-only">Describe the refunds</label>
        <div className="flex-1"><Input id={`${id}-i`} value={instruction} onChange={(e) => setInstruction(e.target.value)} maxLength={300}
          placeholder='Try: "refund every parcel that never arrived, including shipping"' disabled={busy !== null} /></div>
        <Button type="submit" variant="accent" disabled={busy !== null || !instruction.trim()}>{busy === "plan" ? "Planning…" : "Propose refunds"}</Button>
      </form>
      {(busy === "plan" || plan) && (
        <PipelineSteps label="Bulk refund steps" steps={plan ? [
          { label: "AI proposed refunds", state: "done", detail: `${plan.proposals.length + plan.blocked.length} order${plan.proposals.length + plan.blocked.length === 1 ? "" : "s"}` },
          { label: "Policy checked each one", state: plan.blocked.length ? "attention" : "done", detail: `${plan.proposals.length} pass, ${plan.blocked.length} blocked` },
          { label: "You pick what to create", state: "active", detail: `${picked.size} selected` },
          { label: "Over the agent limit, a supervisor approves", state: "pending" },
        ] : [
          { label: "AI proposes refunds", state: "active", detail: `${elapsed} s` },
          { label: "Policy checks each one", state: "pending" },
          { label: "You pick what to create", state: "pending" },
        ]} />
      )}
      <div role="status" aria-live="polite" className="text-sm" style={{ color: "rgb(var(--text-muted))" }}>{busy === "plan" ? "Reading orders and drafting a plan…" : done}</div>
      {error && <p role="alert" className="text-sm" style={{ color: "rgb(var(--feedback-error))" }}>{error}</p>}

      {plan && (
        <div className="flex flex-col gap-3 rounded-[var(--radius-md)] border p-3" style={{ borderColor: "rgb(var(--border))" }}>
          {plan.proposals.length === 0 ? (
            <p className="text-sm" style={{ color: "rgb(var(--text-muted))" }}>{plan.note ?? "Nothing to refund."}</p>
          ) : (
            <>
            <p className="text-sm font-medium" style={{ color: "rgb(var(--text))" }}>
              Proposed, not created yet: tick the refunds you want, then Create.
            </p>
            <ul className="flex flex-col gap-2">
              {plan.proposals.map((p, i) => (
                <li key={p.draft.orderId} className="flex items-start gap-2 text-sm">
                  <input id={`${id}-p${i}`} type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} className="mt-1 h-4 w-4" />
                  <label htmlFor={`${id}-p${i}`} className="flex-1" style={{ color: "rgb(var(--text))" }}>
                    <span className="font-medium">{p.draft.orderId}</span> · {p.draft.customerEmail} · {p.draft.reason.replace("_", " ")}{p.draft.refundShipping ? " + shipping" : ""}
                    <span className="block text-xs" style={{ color: "rgb(var(--text-muted))" }}>{p.why}</span>
                  </label>
                  <span className="tabular-nums" style={{ color: "rgb(var(--text))" }}>{eur(p.amount)}</span>
                  {p.amount > policy.agentLimit && <Badge variant="accent">needs supervisor</Badge>}
                </li>
              ))}
            </ul>
            </>
          )}
          {plan.blocked.length > 0 && (
            <details className="text-xs" style={{ color: "rgb(var(--text-muted))" }}>
              <summary className="cursor-pointer">{plan.blocked.length} proposal{plan.blocked.length === 1 ? "" : "s"} blocked by policy</summary>
              <ul className="mt-1 list-disc pl-5">{plan.blocked.map((b, i) => <li key={i}>{b.orderId ?? "?"}: {b.reasons.join(" ")}</li>)}</ul>
            </details>
          )}
          <Feedback feature="plan" traceId={plan.provenance.traceId} label="Right orders proposed?" />
          {plan.truncated && <p role="alert" className="text-sm" style={{ color: "rgb(var(--feedback-error))" }}>This plan was cut short, so it may not cover every matching order. Create these, then ask again for the rest.</p>}
          <div className="flex flex-wrap items-center gap-2">
            {plan.proposals.length > 0 && (
              <Button variant="default" onClick={create} disabled={busy !== null || picked.size === 0}>
                {busy === "create" ? "Creating…" : `Create ${picked.size} refund${picked.size === 1 ? "" : "s"} · ${eur(total)}`}
              </Button>
            )}
            <Button variant="ghost" onClick={() => setPlan(null)}>Discard plan</Button>
          </div>
        </div>
      )}
    </div>
  )
}

export default BulkPanel
