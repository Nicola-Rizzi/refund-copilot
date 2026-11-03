import { useEffect, useId, useRef, useState } from "react"
import { Card } from "@refund-copilot/ui/card"
import { ApiError, eur } from "./api"
import type { Draft, Provenance, ReadResult, Refund } from "./types"
import { useSession } from "./useSession"
import { useTabs } from "./useTabs"
import RequestReader from "./components/RequestReader"
import DraftReview from "./components/DraftReview"
import RefundList from "./components/RefundList"
import AskPanel from "./components/AskPanel"
import BulkPanel from "./components/BulkPanel"
import AiMetrics from "./components/AiMetrics"
import SignIn from "./components/SignIn"
import { Button } from "@refund-copilot/ui/button"

type Step = { kind: "read" } | { kind: "review"; draft: Draft; ai?: { summary: string; unmatched: string[]; from: Record<string, string>; provenance: Provenance } }

const TABS = [["request", "New request"], ["ask", "Ask"], ["bulk", "Bulk refunds"]] as const
const TAB_KEYS = TABS.map(([k]) => k)

const EMPTY: Draft = { orderId: "", customerEmail: "", items: [], reason: "damaged", refundShipping: false, requestedAmount: null, source: "manual" }

function App() {
  const { me, signedOut, orders, refunds, error, setError, version, load, signIn: startSession, signOut } = useSession()
  const { tab, setTab, tabProps } = useTabs(TAB_KEYS)
  const [step, setStep] = useState<Step>({ kind: "read" })
  const [notice, setNotice] = useState<string | null>(null)
  const userSelect = useId()
  const tabsId = useId()
  const stepHeading = useRef<HTMLHeadingElement>(null)
  const focusStep = useRef(false)

  // After the AI reads a request (or the agent cancels), move focus to the step's heading,
  // so a screen-reader or keyboard user lands on the new content instead of on <body>.
  useEffect(() => {
    if (focusStep.current) { stepHeading.current?.focus(); focusStep.current = false }
  }, [step])
  const goTo = (s: Step) => { focusStep.current = true; setStep(s) }

  /** Sign in or switch account, starting from a clean screen. */
  const signIn = async (id: string) => {
    await startSession(id)
    setStep({ kind: "read" }); setNotice(null); setTab("request")
  }

  const fromAi = (r: ReadResult) => {
    if (!r.draft) return
    const from = Object.fromEntries(r.draft.items.filter((i) => i.from).map((i) => [i.sku, i.from as string]))
    goTo({
      kind: "review",
      draft: { ...r.draft, customerEmail: r.draft.customerEmail ?? "", orderId: r.draft.orderId ?? "", items: r.draft.items.map(({ sku, qty }) => ({ sku, qty })), source: "ai" },
      ai: { summary: r.report.summary, unmatched: r.unmatched ?? [], from, provenance: r.provenance },
    })
  }

  const created = (r: Refund) => {
    setStep({ kind: "read" })
    setNotice(r.status === "approved" ? `${r.id} approved.` : `${r.id} created: ${eur(r.amount)}, ${r.status.replace("_", " ")}.`)
    void load()
  }

  const user = me?.user
  const userId = user?.id ?? ""
  if (signedOut) return <SignIn onSignIn={signIn} />
  return (
    <main className="mx-auto flex max-w-5xl flex-col gap-6 px-4 py-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold" style={{ color: "rgb(var(--text))" }}>{me?.shop ?? "Refund copilot"} · refunds</h1>
          <p className="text-sm" style={{ color: "rgb(var(--text-muted))" }}>
            Customer request → AI-read draft → policy checks → human approval.
            {me && ` Agents approve up to ${eur(me.policy.agentLimit)}; above that, a supervisor.`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor={userSelect} className="text-sm" style={{ color: "rgb(var(--text-muted))" }}>Signed in as</label>
          <select id={userSelect} value={userId} onChange={(e) => { void signIn(e.target.value).catch((err: unknown) => setError(err instanceof ApiError ? err.message : "Couldn't switch account.")) }}
            className="h-9 rounded-[var(--radius-md)] border px-2 text-sm" style={{ borderColor: "rgb(var(--border-input))", background: "rgb(var(--surface-card))", color: "rgb(var(--text))" }}>
            {(me?.users ?? []).map((u) => <option key={u.id} value={u.id}>{u.name} · {u.role}</option>)}
          </select>
          <Button type="button" variant="ghost" size="sm" onClick={() => void signOut()}>Sign out</Button>
        </div>
      </header>

      {me?.aiStub && (
        <p className="rounded-[var(--radius-md)] border px-3 py-2 text-sm" style={{ borderColor: "rgb(var(--border))", background: "rgb(var(--surface-subtle))", color: "rgb(var(--text))" }}>
          <strong>Demo mode.</strong> The AI features answer from keyword rules, not a model, so this runs without an API key. Pricing, policy, roles, privacy and the audit trail are the real code.
        </p>
      )}
      {error && <p role="alert" className="text-sm" style={{ color: "rgb(var(--feedback-error))" }}>{error}</p>}
      <p role="status" aria-live="polite" className="text-sm" style={{ color: "rgb(var(--feedback-success))" }}>{notice}</p>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <Card variant="outlined" padding="md">
          <div role="tablist" aria-label="Tools" className="mb-4 flex flex-wrap gap-1">
            {TABS.map(([k, label]) => (
              <button key={k} {...tabProps(k)} id={`${tabsId}-tab-${k}`} type="button" aria-controls={`${tabsId}-panel-${k}`}
                className="rounded-[var(--radius-md)] px-3 py-1.5 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgb(var(--border-focus))]"
                style={tab === k ? { background: "rgb(var(--brand))", color: "rgb(var(--brand-foreground))" } : { background: "rgb(var(--surface-subtle))", color: "rgb(var(--text))" }}>
                {label}
              </button>
            ))}
          </div>
          <div role="tabpanel" id={`${tabsId}-panel-request`} aria-labelledby={`${tabsId}-tab-request`} hidden={tab !== "request"}>
            <h2 ref={stepHeading} tabIndex={-1} className="mb-3 text-base font-semibold focus:outline-none" style={{ color: "rgb(var(--text))" }}>
              {step.kind === "read" ? "1 · New refund request" : "2 · Review the draft"}
            </h2>
            {user?.role !== "agent" ? (
              <p className="text-sm" style={{ color: "rgb(var(--text-muted))" }}>Supervisors review and approve. Switch to an agent to work on a customer request.</p>
            ) : step.kind === "read" ? (
              <RequestReader onRead={fromAi} onManual={() => goTo({ kind: "review", draft: EMPTY })} />
            ) : (
              <DraftReview key={JSON.stringify(step.draft)} orders={orders} initial={step.draft} ai={step.ai}
                onCreated={created} onCancel={() => goTo({ kind: "read" })} />
            )}
          </div>
          <div role="tabpanel" id={`${tabsId}-panel-ask`} aria-labelledby={`${tabsId}-tab-ask`} hidden={tab !== "ask"}>
            <AskPanel key={userId} orders={orders} refunds={refunds} />
          </div>
          <div role="tabpanel" id={`${tabsId}-panel-bulk`} aria-labelledby={`${tabsId}-tab-bulk`} hidden={tab !== "bulk"}>
            {user?.role === "agent" && me
              ? <BulkPanel policy={me.policy} onCreated={() => void load()} />
              : <p className="text-sm" style={{ color: "rgb(var(--text-muted))" }}>Bulk refunds are proposed by agents. Switch to an agent.</p>}
          </div>
        </Card>

        <Card variant="outlined" padding="md">
          <h2 className="mb-3 text-base font-semibold" style={{ color: "rgb(var(--text))" }}>3 · Refunds</h2>
          {user && <RefundList user={user} refunds={refunds} onChanged={() => void load()} />}
        </Card>

        {user?.role === "supervisor" && (
          <Card variant="outlined" padding="md" className="lg:col-span-2">
            <h2 className="mb-3 text-base font-semibold" style={{ color: "rgb(var(--text))" }}>AI outcomes</h2>
            <AiMetrics version={version} />
          </Card>
        )}
      </div>
    </main>
  )
}

export default App
