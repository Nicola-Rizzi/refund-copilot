import { Fragment, useId, useRef, useState } from "react"
import { Button } from "@refund-copilot/ui/button"
import { Input } from "@refund-copilot/ui/input"
import { Badge } from "@refund-copilot/ui/badge"
import Feedback from "./Feedback"
import { apiStream, ApiError, eur, isAbort, refundAnchor } from "../api"
import type { Order, Refund } from "../types"

interface Msg {
  role: "user" | "assistant"
  content: string
  state?: "streaming" | "done" | "stopped" | "error"
  error?: string
  result?: { citations: string[]; invalidCitations: string[]; grounded: boolean; abstained: boolean }
  traceId?: string
}

/**
 * Ask your shop: streamed answers over orders and refunds. Citations are checked
 * by the server once the answer is complete; then [#…] markers become source
 * chips, invented ones are struck out, and an answer with no valid source is
 * labelled. Stop aborts the request, and the server aborts the model call.
 */
const AskPanel = ({ orders, refunds }: { orders: Order[]; refunds: Refund[] }) => {
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [q, setQ] = useState("")
  const [status, setStatus] = useState<string | null>(null)
  const ctrl = useRef<AbortController | null>(null)
  const id = useId()
  const streaming = msgs.some((m) => m.state === "streaming")
  const patchLast = (f: (m: Msg) => Msg) => setMsgs((prev) => [...prev.slice(0, -1), f(prev[prev.length - 1])])

  const ask = async (e: { preventDefault(): void }) => {
    e.preventDefault()
    const question = q.trim()
    if (!question || streaming) return
    const history = msgs.filter((m) => m.state !== "error" && m.content).slice(-6).map(({ role, content }) => ({ role, content }))
    setMsgs((prev) => [...prev, { role: "user", content: question }, { role: "assistant", content: "", state: "streaming" }])
    setQ("")
    ctrl.current = new AbortController()
    try {
      await apiStream("/api/ask", { question, history }, {
        signal: ctrl.current.signal,
        onFrame: (ev, data) => {
          const d = data as Record<string, unknown>
          if (ev === "status") setStatus(String(d.message))
          if (ev === "delta") { setStatus(null); patchLast((m) => ({ ...m, content: m.content + String(d.text) })) }
          if (ev === "result") patchLast((m) => ({ ...m, result: d as unknown as Msg["result"] }))
          if (ev === "error") patchLast((m) => ({ ...m, state: "error", error: String(d.error) }))
          if (ev === "done") patchLast((m) => ({ ...m, traceId: String(d.traceId) }))
        },
      })
      patchLast((m) => (m.state === "streaming" ? { ...m, state: "done" } : m))
    } catch (err) {
      if (isAbort(err)) patchLast((m) => ({ ...m, state: "stopped" }))
      else patchLast((m) => ({ ...m, state: "error", error: err instanceof ApiError ? err.message : "The answer couldn't be loaded." }))
    } finally {
      setStatus(null)
      ctrl.current = null
    }
  }

  const describe = (rid: string) => {
    const o = orders.find((x) => x.id === rid)
    if (o) return `${o.id} · ${o.customerEmail} · ${o.status}${o.deliveredDaysAgo != null ? ` ${o.deliveredDaysAgo}d ago` : ""}`
    const r = refunds.find((x) => x.id === rid)
    return r ? `${r.id} · ${r.orderId} · ${eur(r.amount)} · ${r.status.replace("_", " ")}` : rid
  }
  const jump = (rid: string) => {
    const el = document.getElementById(refundAnchor(rid))
    el?.scrollIntoView?.({ block: "center" })
    el?.focus({ preventScroll: true })
  }

  const last = msgs[msgs.length - 1]
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm" style={{ color: "rgb(var(--text-muted))" }}>Ask about orders and refunds. Every answer cites the records it used.</p>
      {msgs.length > 0 && (
        <div aria-label="Conversation" aria-busy={streaming} className="flex max-h-[28rem] flex-col gap-3 overflow-y-auto">
          {msgs.map((m, i) => m.role === "user" ? (
            <p key={i} className="self-end rounded-[var(--radius-md)] px-3 py-2 text-sm" style={{ background: "rgb(var(--surface-subtle))", color: "rgb(var(--text))" }}>{m.content}</p>
          ) : (
            <div key={i} className="rounded-[var(--radius-md)] border px-3 py-2 text-sm" style={{ borderColor: "rgb(var(--border))", color: "rgb(var(--text))" }}>
              <p className="whitespace-pre-wrap">
                {m.content.replace(/\*\*/g, "").split(/(\[#(?:ORD|RF)-\d+\])/g).map((part, k) => {
                  const rid = /^\[#((?:ORD|RF)-\d+)\]$/.exec(part)?.[1]
                  if (!rid || !m.result) return <Fragment key={k}>{part}</Fragment>
                  if (m.result.invalidCitations.includes(rid)) return <span key={k} className="line-through" style={{ color: "rgb(var(--feedback-error))" }} title="Not in the shop's records">source removed</span>
                  return <span key={k} className="mx-0.5 text-xs font-medium" style={{ color: "rgb(var(--brand))" }}>[{rid}]</span>
                })}
                {m.state === "streaming" && !m.content && <span style={{ color: "rgb(var(--text-muted))" }}>{status ?? "Thinking…"}</span>}
              </p>
              {m.state === "error" && <p role="alert" style={{ color: "rgb(var(--feedback-error))" }}>{m.error}</p>}
              {m.result && (
                <div className="mt-2 flex flex-col gap-1">
                  {m.result.citations.map((rid) => rid.startsWith("RF-") ? (
                    <button key={rid} type="button" onClick={() => jump(rid)} className="w-fit text-left text-xs underline underline-offset-2" style={{ color: "rgb(var(--brand))" }}>Source: {describe(rid)}</button>
                  ) : (
                    <span key={rid} className="text-xs" style={{ color: "rgb(var(--text-muted))" }}>Source: {describe(rid)}</span>
                  ))}
                  <div className="flex flex-wrap gap-2">
                    {m.result.invalidCitations.length > 0 && <Badge variant="error">{m.result.invalidCitations.length} invented source{m.result.invalidCitations.length > 1 ? "s" : ""} removed</Badge>}
                    {m.result.abstained && <Badge variant="outline">Not in the records</Badge>}
                    {!m.result.grounded && !m.result.abstained && <Badge variant="muted">No sources. Check before relying on this.</Badge>}
                  </div>
                </div>
              )}
              {m.state === "stopped" && <Badge variant="muted">Stopped</Badge>}
              {m.state === "done" && m.traceId && <div className="mt-2"><Feedback feature="ask" traceId={m.traceId} label="Useful answer?" /></div>}
            </div>
          ))}
        </div>
      )}
      <div aria-live="polite" className="sr-only">{last?.role === "assistant" && last.state === "done" ? `Answer: ${last.content}` : ""}</div>
      <form onSubmit={ask} className="flex gap-2">
        <label htmlFor={`${id}-q`} className="sr-only">Question about orders and refunds</label>
        <div className="flex-1"><Input id={`${id}-q`} value={q} onChange={(e) => setQ(e.target.value)} placeholder='Try: "which refunds wait for a supervisor?"' maxLength={500} disabled={streaming} /></div>
        {streaming
          ? <Button type="button" variant="outline" onClick={() => ctrl.current?.abort()}>Stop</Button>
          : <Button type="submit" variant="accent" disabled={!q.trim()}>Ask</Button>}
      </form>
    </div>
  )
}

export default AskPanel
