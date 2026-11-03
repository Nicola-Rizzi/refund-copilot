import { useId, useState } from "react"
import { Button } from "@refund-copilot/ui/button"
import { Input } from "@refund-copilot/ui/input"
import { api, ApiError } from "../api"
import type { ReadResult } from "../types"
import PipelineSteps from "./PipelineSteps"
import { useElapsed } from "../useElapsed"

type Mode = "email" | "photo"

/**
 * Step 1: the agent pastes the customer's email (or a receipt photo) and the model
 * reads what's being asked. Nothing is decided here — the result opens a draft
 * the agent reviews. "Fill in by hand" is always there: the AI is a shortcut, not
 * the only way in.
 */
const RequestReader = ({ onRead, onManual }: {
  onRead: (r: ReadResult) => void
  onManual: () => void
}) => {
  const [mode, setMode] = useState<Mode>("email")
  const [from, setFrom] = useState("")
  const [subject, setSubject] = useState("")
  const [body, setBody] = useState("")
  const [file, setFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const id = useId()
  const elapsed = useElapsed(busy)

  const read = async (e: { preventDefault(): void }) => {
    e.preventDefault()
    setBusy(true); setError(null); setNote(null)
    try {
      const payload = mode === "email"
        ? { message: { from, subject, body } }
        : { file: { name: file!.name, mediaType: file!.type, data: await toBase64(file!) } }
      const r = await api<ReadResult>("POST", "/api/read-request", payload)
      if (!r.report.isRefundRequest) setNote(`This doesn't look like a refund request: ${r.report.summary}`)
      else onRead(r)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't read the request. Fill in the refund by hand.")
    } finally {
      setBusy(false)
    }
  }

  const ready = mode === "email" ? body.trim().length > 0 : file !== null

  return (
    <form onSubmit={read} className="flex flex-col gap-3">
      <div role="radiogroup" aria-label="Request comes from" className="flex gap-1">
        {(["email", "photo"] as const).map((m) => (
          <label key={m} className="flex cursor-pointer items-center gap-1.5 rounded-[var(--radius-md)] px-3 py-1.5 text-sm"
            style={{ background: mode === m ? "rgb(var(--surface-subtle))" : "transparent", color: "rgb(var(--text))" }}>
            <input type="radio" name={`${id}-mode`} value={m} checked={mode === m} onChange={() => setMode(m)} />
            {m === "email" ? "Customer email" : "Receipt photo or PDF"}
          </label>
        ))}
      </div>

      {mode === "email" ? (
        <>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-from`} className="text-xs font-medium" style={{ color: "rgb(var(--text-muted))" }}>From (from the mail system)</label>
            <Input id={`${id}-from`} size="sm" value={from} onChange={(e) => setFrom(e.target.value)} placeholder="mario.rossi@example.com" />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-subject`} className="text-xs font-medium" style={{ color: "rgb(var(--text-muted))" }}>Subject</label>
            <Input id={`${id}-subject`} size="sm" value={subject} onChange={(e) => setSubject(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <label htmlFor={`${id}-body`} className="text-xs font-medium" style={{ color: "rgb(var(--text-muted))" }}>Message</label>
            <textarea id={`${id}-body`} rows={6} maxLength={5000} value={body} onChange={(e) => setBody(e.target.value)}
              className="w-full rounded-[var(--radius-md)] border p-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--border-focus))]"
              style={{ borderColor: "rgb(var(--border-input))", background: "rgb(var(--surface-card))", color: "rgb(var(--text))" }} />
          </div>
        </>
      ) : (
        <div className="flex flex-col gap-1">
          <label htmlFor={`${id}-file`} className="text-xs font-medium" style={{ color: "rgb(var(--text-muted))" }}>Photo (PNG, JPEG, WebP) or PDF, up to 3 MB</label>
          <input id={`${id}-file`} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="text-sm" />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="accent" disabled={!ready || busy}>{busy ? "Reading…" : "Read with AI"}</Button>
        <Button type="button" variant="ghost" onClick={onManual}>Fill in by hand</Button>
      </div>
      {busy && (
        <PipelineSteps label="Reading the request" steps={[
          { label: "AI reads the request", state: "active", detail: `${elapsed} s` },
          { label: "Code matches the order and its items", state: "pending" },
          { label: "Code prices it from the order", state: "pending" },
          { label: "Code runs the refund policy", state: "pending" },
        ]} />
      )}
      <div role="status" aria-live="polite" className="text-sm" style={{ color: "rgb(var(--text-muted))" }}>{busy ? "Reading the request…" : note}</div>
      {error && <p role="alert" className="text-sm" style={{ color: "rgb(var(--feedback-error))" }}>{error}</p>}
    </form>
  )
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader()
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "")
    r.onerror = () => reject(r.error ?? new Error("read failed"))
    r.readAsDataURL(file)
  })
}

export default RequestReader
