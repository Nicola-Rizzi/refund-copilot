import type { Check } from "../types"

// Policy checks as the server computed them. Colour carries the level, and a word
// says it too, so the meaning never depends on colour alone.
const STYLE = {
  pass: { mark: "✓", label: "ok", color: "rgb(var(--feedback-success))" },
  warn: { mark: "!", label: "check", color: "rgb(var(--brand-accent))" },
  block: { mark: "✕", label: "blocks", color: "rgb(var(--feedback-error))" },
} as const

const ORDER = { block: 0, warn: 1, pass: 2 } as const

const ChecksList = ({ checks, compact = false }: { checks: Check[]; compact?: boolean }) => {
  const shown = [...checks].sort((a, b) => ORDER[a.level] - ORDER[b.level]).filter((c) => !compact || c.level !== "pass")
  if (shown.length === 0) return compact ? <p className="text-xs" style={{ color: "rgb(var(--feedback-success))" }}>All checks pass.</p> : null
  return (
    <ul className="flex flex-col gap-1" aria-label="Policy checks">
      {shown.map((c) => (
        <li key={c.id + c.message} className="flex items-start gap-2 text-sm">
          <span aria-hidden="true" className="mt-0.5 w-4 shrink-0 text-center font-bold" style={{ color: STYLE[c.level].color }}>{STYLE[c.level].mark}</span>
          <span>
            <span className="sr-only">{STYLE[c.level].label}: </span>
            <span style={{ color: c.level === "pass" ? "rgb(var(--text-muted))" : "rgb(var(--text))" }}>{c.message}</span>
          </span>
        </li>
      ))}
    </ul>
  )
}

export default ChecksList
