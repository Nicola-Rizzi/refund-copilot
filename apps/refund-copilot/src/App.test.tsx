import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import App from "./App"

const users = [{ id: "luca", name: "Luca Bianchi", role: "agent" }, { id: "elena", name: "Elena Conti", role: "supervisor" }]
const order = { id: "ORD-1042", customerEmail: "mario.rossi@example.com", status: "delivered", deliveredDaysAgo: 5, shippedDaysAgo: 8, shipping: 4.9,
  items: [{ sku: "VAS-CER-01", name: "Ceramic vase, sand", qty: 1, unitPrice: 39.9 }] }
const pending = { id: "RF-2003", orderId: "ORD-1043", customerEmail: "giulia.ferri@example.com", reason: "damaged", amount: 189, items: [], refundShipping: false,
  createdBy: "luca", createdAt: "2026-10-28", status: "pending_approval", approvedBy: null, checks: [], source: "manual",
  history: [{ at: "2026-10-28", by: "luca", role: "agent", action: "created" }] }

/** A fake API with a session: who's signed in is server state, set by POST /api/session. */
function mockApi(signedInAs: string | null = "luca") {
  const calls: { path: string; method: string; user: string | null; body?: unknown }[] = []
  let session = signedInAs
  const fn = vi.fn(async (path: string, init: RequestInit = {}) => {
    const body = init.body ? JSON.parse(String(init.body)) : undefined
    const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status })
    if (path === "/api/accounts") return json(200, { users, shop: "Nordlys Home" })
    if (path === "/api/session") { session = body.userId; return json(200, { user: users.find((u) => u.id === session) }) }
    if (path === "/api/session/logout") { session = null; return json(200, { ok: true }) }
    const user = session
    calls.push({ path, method: init.method ?? "GET", user, body })
    if (!user) return json(401, { error: "Sign in first." })
    const me = users.find((u) => u.id === user)!
    if (path === "/api/me") return json(200, { user: me, users, shop: "Nordlys Home", policy: { agentLimit: 100, returnWindowDays: 30, lostAfterDays: 7 } })
    if (path === "/api/orders") return json(200, { orders: [order] })
    if (path === "/api/refunds" && init.method === "POST") return json(201, { refund: { ...pending, id: "RF-2004", orderId: "ORD-1042", amount: 39.9, status: "pending_approval", approveBlocker: null } })
    if (path === "/api/refunds") return json(200, { refunds: [{ ...pending, approveBlocker: user === "luca" ? "Over 100.00 €: only a supervisor can approve." : null }] })
    if (path === "/api/read-request") return json(200, {
      report: { isRefundRequest: true, summary: "Vase arrived cracked.", requestedAmount: null },
      draft: { orderId: "ORD-1042", customerEmail: "mario.rossi@example.com", items: [{ sku: "VAS-CER-01", qty: 1, from: "the sand vase" }], reason: "damaged", refundShipping: false, requestedAmount: null },
      unmatched: [], checks: [], amount: 39.9,
      provenance: { feature: "read", traceId: "trace-read-0001", model: "claude-sonnet-5", promptVersion: "read-refund-request@2" } })
    if (path === "/api/feedback") return json(200, { ok: true })
    if (path === "/api/ai-metrics") {
      const f = { feedback: { up: 3, down: 1 }, created: 4, edited: 1, approved: 2, rejected: 0, failures: 0, byModel: { "claude-sonnet-5": { created: 4, edited: 1, approved: 2, rejected: 0 } } }
      return json(200, { features: { read: f, ask: { ...f, created: 0, edited: 0, approved: 0 }, plan: f } })
    }
    if (path === "/api/refunds/preview") return json(200, { amount: 39.9, checks: [{ id: "window", level: "pass", message: "Delivered 5 days ago, within the 30-day window." }] })
    return json(404, { error: `unexpected ${path}` })
  })
  vi.stubGlobal("fetch", fn)
  return calls
}
afterEach(() => vi.unstubAllGlobals())

describe("refund copilot", () => {
  it("without a session shows the sign-in screen; picking an account signs in, Sign out signs out", async () => {
    mockApi(null)
    render(<App />)
    await userEvent.click(await screen.findByRole("button", { name: /Elena Conti/ }))
    expect(await screen.findByLabelText("Signed in as")).toHaveValue("elena")
    await userEvent.click(screen.getByRole("button", { name: "Sign out" }))
    expect(await screen.findByRole("heading", { name: /Sign in to/ })).toBeInTheDocument()
  })

  it("reads an email into a draft, checks it on the server, and creates the refund", async () => {
    const calls = mockApi()
    render(<App />)
    await userEvent.type(await screen.findByLabelText(/^from/i), "mario.rossi@example.com")
    await userEvent.type(screen.getByLabelText("Message"), "The sand vase from ORD-1042 arrived cracked.")
    await userEvent.click(screen.getByRole("button", { name: "Read with AI" }))

    expect(await screen.findByText(/The AI read:/)).toBeInTheDocument()
    expect(screen.getByText(/customer wrote: "the sand vase"/)).toBeInTheDocument()
    expect(await screen.findByText("39.90 €")).toBeInTheDocument()
    expect(screen.getByText(/within the 30-day window/)).toBeInTheDocument()

    const rate = screen.getByRole("group", { name: "Did the AI read it right?" })
    await userEvent.click(within(rate).getByRole("button", { name: "Yes" }))
    await waitFor(() => expect(calls.find((c) => c.path === "/api/feedback")?.body).toEqual({ feature: "read", traceId: "trace-read-0001", rating: "up" }))
    expect(within(rate).getByRole("button", { name: "Yes" })).toHaveAttribute("aria-pressed", "true")

    await userEvent.click(screen.getByRole("button", { name: "Create refund" }))
    await waitFor(() => expect(calls.some((c) => c.path === "/api/refunds" && c.method === "POST")).toBe(true))
    const sent = calls.find((c) => c.path === "/api/refunds" && c.method === "POST")!
    expect(sent).toMatchObject({ user: "luca", body: { orderId: "ORD-1042", items: [{ sku: "VAS-CER-01", qty: 1 }], source: "ai" } })
    expect(sent.body).not.toHaveProperty("amount")   // the price is the server's, never the browser's
    expect(sent.body).toMatchObject({ ai: { feature: "read", traceId: "trace-read-0001", edited: false } })
    expect(await screen.findByText("RF-2004 created: 39.90 €, pending approval.")).toBeInTheDocument()
  })

  it("shows the server's reason when the signed-in user can't approve, and lets a supervisor approve", async () => {
    mockApi()
    render(<App />)
    const list = await screen.findByRole("list", { name: "Refunds" })
    expect(within(list).getByRole("button", { name: "Approve" })).toBeDisabled()
    expect(within(list).getByText(/only a supervisor can approve/)).toBeInTheDocument()

    await userEvent.selectOptions(screen.getByLabelText("Signed in as"), "elena")
    await waitFor(() => expect(within(screen.getByRole("list", { name: "Refunds" })).getByRole("button", { name: "Approve" })).toBeEnabled())
    expect(screen.getByText(/Supervisors review and approve/)).toBeInTheDocument()
    const metrics = await screen.findByRole("table")
    expect(within(metrics).getByRole("row", { name: /Reading requests/ })).toHaveTextContent("3 / 1")
    expect(within(metrics).getByRole("row", { name: /Reading requests/ })).toHaveTextContent("25%")
  })
})
