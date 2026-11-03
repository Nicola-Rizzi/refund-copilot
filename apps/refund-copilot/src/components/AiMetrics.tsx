import { useEffect, useState } from "react"
import { api, ApiError } from "../api"
import type { AiMetrics as Metrics } from "../types"

const FEATURES = [["read", "Reading requests"], ["plan", "Bulk proposals"], ["ask", "Ask"]] as const
const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "—")

/**
 * The online half of the eval, for a supervisor: what people did with the AI's
 * output. A rising "edited" share or 👎 count is drift the golden set won't show.
 * Reloads whenever the refund list changes (`version`).
 */
const AiMetrics = ({ version }: { version: number }) => {
  const [m, setM] = useState<Metrics["features"] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    api<Metrics>("GET", "/api/ai-metrics")
      .then((r) => { if (alive) { setM(r.features); setError(null) } })
      .catch((err) => { if (alive) setError(err instanceof ApiError ? err.message : "Couldn't load the AI metrics.") })
    return () => { alive = false }
  }, [version])

  // A canary is running when a feature's drafts came from more than one model: compare them.
  const comparisons = FEATURES.filter(([k]) => Object.keys(m?.[k].byModel ?? {}).length > 1)

  if (error) return <p role="alert" className="text-sm" style={{ color: "rgb(var(--feedback-error))" }}>{error}</p>
  if (!m) return null
  const cell = "px-2 py-1 text-right tabular-nums"
  return (
    <div className="flex flex-col gap-4">
    <table className="w-full text-sm" style={{ color: "rgb(var(--text))" }}>
      <caption className="mb-1 text-left text-xs" style={{ color: "rgb(var(--text-muted))" }}>Since the server started. Drafts: AI drafts turned into refunds.</caption>
      <thead style={{ color: "rgb(var(--text-muted))" }}>
        <tr>
          <th scope="col" className="px-2 py-1 text-left font-medium">Feature</th>
          <th scope="col" className={cell}><span aria-hidden="true">👍 / 👎</span><span className="sr-only">Helpful / not helpful</span></th>
          <th scope="col" className={cell}>Drafts</th>
          <th scope="col" className={cell}>Edited</th>
          <th scope="col" className={cell}>Approved</th>
          <th scope="col" className={cell}>Rejected</th>
          <th scope="col" className={cell}>Unusable outputs</th>
        </tr>
      </thead>
      <tbody>
        {FEATURES.map(([k, label]) => (
          <tr key={k} className="border-t" style={{ borderColor: "rgb(var(--border))" }}>
            <th scope="row" className="px-2 py-1 text-left font-normal">{label}</th>
            <td className={cell}>{m[k].feedback.up} / {m[k].feedback.down}</td>
            <td className={cell}>{k === "ask" ? "—" : m[k].created}</td>
            <td className={cell}>{k === "ask" ? "—" : pct(m[k].edited, m[k].created)}</td>
            <td className={cell}>{k === "ask" ? "—" : m[k].approved}</td>
            <td className={cell}>{k === "ask" ? "—" : m[k].rejected}</td>
            <td className={cell}>{m[k].failures}</td>
          </tr>
        ))}
      </tbody>
    </table>
    {comparisons.map(([k, label]) => (
      <table key={k} className="w-full text-sm" style={{ color: "rgb(var(--text))" }}>
        <caption className="mb-1 text-left text-xs" style={{ color: "rgb(var(--text-muted))" }}>{label}: models side by side (gradual release)</caption>
        <thead style={{ color: "rgb(var(--text-muted))" }}>
          <tr>
            <th scope="col" className="px-2 py-1 text-left font-medium">Model</th>
            <th scope="col" className={cell}>Drafts</th>
            <th scope="col" className={cell}>Edited</th>
            <th scope="col" className={cell}>Approved</th>
            <th scope="col" className={cell}>Rejected</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(m[k].byModel).map(([model, o]) => (
            <tr key={model} className="border-t" style={{ borderColor: "rgb(var(--border))" }}>
              <th scope="row" className="px-2 py-1 text-left font-normal">{model}</th>
              <td className={cell}>{o.created}</td>
              <td className={cell}>{pct(o.edited, o.created)}</td>
              <td className={cell}>{o.approved}</td>
              <td className={cell}>{o.rejected}</td>
            </tr>
          ))}
        </tbody>
      </table>
    ))}
    </div>
  )
}

export default AiMetrics
