import { useState } from "react"
import { Button } from "@refund-copilot/ui/button"
import { api, ApiError } from "../api"

type Rating = "up" | "down"

/**
 * 👍/👎 on one AI result. It goes to the server with the result's trace id, so in
 * the logs it joins the model call that produced it ([feedback] ↔ [usage]).
 * One rating per result; the supervisor sees the totals in AI metrics.
 */
const Feedback = ({ feature, traceId, label }: { feature: "read" | "ask" | "plan"; traceId: string; label: string }) => {
  const [rating, setRating] = useState<Rating | null>(null)
  const [error, setError] = useState<string | null>(null)

  const send = async (r: Rating) => {
    setRating(r); setError(null)
    try {
      await api("POST", "/api/feedback", { feature, traceId, rating: r })
    } catch (err) {
      setRating(null)
      setError(err instanceof ApiError ? err.message : "Couldn't send the feedback.")
    }
  }

  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1 text-xs" style={{ color: "rgb(var(--text-muted))" }}>
      <span>{label}</span>
      {(["up", "down"] as const).map((r) => (
        <Button key={r} type="button" size="sm" variant={rating === r ? "outline" : "ghost"} aria-pressed={rating === r} disabled={rating !== null} onClick={() => void send(r)}>
          <span aria-hidden="true">{r === "up" ? "👍" : "👎"}</span>
          <span className="sr-only">{r === "up" ? "Yes" : "No"}</span>
        </Button>
      ))}
      <span role="status" aria-live="polite">{rating ? "Thanks, noted." : ""}</span>
      {error && <span role="alert" style={{ color: "rgb(var(--feedback-error))" }}>{error}</span>}
    </div>
  )
}

export default Feedback
