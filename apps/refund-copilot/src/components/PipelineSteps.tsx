export type StepState = "done" | "active" | "pending" | "attention"
export interface PipelineStep { label: string; state: StepState; detail?: string }

const MARK: Record<StepState, { icon: string; sr: string; color: string }> = {
  done: { icon: "✓", sr: "done", color: "rgb(var(--feedback-success))" },
  active: { icon: "●", sr: "in progress", color: "rgb(var(--brand))" },
  pending: { icon: "○", sr: "waiting", color: "rgb(var(--text-muted))" },
  attention: { icon: "!", sr: "needs your attention", color: "rgb(var(--feedback-error))" },
}

/**
 * What the copilot is doing, step by step: which part is the model and which is
 * code, what each step found, and where a person has to look. Shown while the AI
 * works (the active step counts seconds) and after, as the record of what happened.
 */
const PipelineSteps = ({ label, steps }: { label: string; steps: PipelineStep[] }) => (
  <ol aria-label={label} className="flex flex-col gap-1 text-xs">
    {steps.map((s) => (
      <li key={s.label} className="flex items-baseline gap-2" style={{ color: s.state === "pending" ? "rgb(var(--text-muted))" : "rgb(var(--text))" }}>
        <span aria-hidden="true" className={`w-3 text-center font-semibold${s.state === "active" ? " motion-safe:animate-pulse" : ""}`} style={{ color: MARK[s.state].color }}>{MARK[s.state].icon}</span>
        <span>
          <span className="font-medium">{s.label}</span>
          <span className="sr-only"> ({MARK[s.state].sr})</span>
          {s.detail && <span style={{ color: "rgb(var(--text-muted))" }}> · {s.detail}</span>}
        </span>
      </li>
    ))}
  </ol>
)

export default PipelineSteps
