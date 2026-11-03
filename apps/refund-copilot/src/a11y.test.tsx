import { render, screen, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { axe } from "jest-axe"
import { afterEach, describe, expect, it, vi } from "vitest"
import App from "./App"

// axe in jsdom checks structure: names, roles, labels, ARIA states, landmarks, lists.
// It can't measure colour contrast (jsdom has no layout or computed colours):
// tokens.contrast.test.ts covers that from the design tokens.

const users = [{ id: "luca", name: "Luca Bianchi", role: "agent" }, { id: "elena", name: "Elena Conti", role: "supervisor" }]
const order = { id: "ORD-1042", customerEmail: "mario.rossi@example.com", status: "delivered", deliveredDaysAgo: 5, shippedDaysAgo: 8, shipping: 4.9,
  items: [{ sku: "VAS-CER-01", name: "Ceramic vase, sand", qty: 1, unitPrice: 39.9 }] }
const refund = { id: "RF-2003", orderId: "ORD-1043", customerEmail: "giulia.ferri@example.com", reason: "damaged", amount: 189, items: [], refundShipping: false,
  createdBy: "luca", createdAt: "2026-10-28", status: "pending_approval", approvedBy: null, source: "ai",
  checks: [{ id: "window", level: "pass", message: "Within the window." }, { id: "history", level: "warn", message: "Second refund this month." }],
  ai: { feature: "read", traceId: "trace-read-0001", model: "claude-sonnet-5", promptVersion: "read-refund-request@2", edited: true },
  history: [{ at: "2026-10-28T09:00:00.000Z", by: "luca", role: "agent", action: "created", traceId: "trace-create-01" }] }
const provenance = (feature: string) => ({ feature, traceId: `trace-${feature}-0001`, model: "claude-sonnet-5", promptVersion: `${feature}@1` })
// Two models on "read": a gradual release is running, so the comparison table shows too.
const metric = { feedback: { up: 3, down: 1 }, created: 4, edited: 1, approved: 2, rejected: 0, failures: 1,
  byModel: { "claude-sonnet-5": { created: 3, edited: 1, approved: 2, rejected: 0 }, "claude-canary": { created: 1, edited: 0, approved: 0, rejected: 0 } } }

function sse(frames: [string, unknown][]) {
  const enc = new TextEncoder()
  return new Response(new ReadableStream({
    start(c) { for (const [e, d] of frames) c.enqueue(enc.encode(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`)); c.close() },
  }), { status: 200 })
}

function mockApi(signedInAs: string | null = "luca") {
  let session = signedInAs
  vi.stubGlobal("fetch", vi.fn(async (path: string, init: RequestInit = {}) => {
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status })
    if (path === "/api/accounts") return json({ users, shop: "Nordlys Home" })
    if (path === "/api/session") { session = JSON.parse(String(init.body)).userId; return json({ user: users.find((u) => u.id === session) }) }
    const user = session
    if (!user) return json({ error: "Sign in first." }, 401)
    switch (path) {
      case "/api/me": return json({ user: users.find((u) => u.id === user), users, shop: "Nordlys Home", policy: { agentLimit: 100, returnWindowDays: 30, lostAfterDays: 7 } })
      case "/api/orders": return json({ orders: [order] })
      case "/api/refunds": return json({ refunds: [{ ...refund, approveBlocker: user === "luca" ? "Over 100.00 €: only a supervisor can approve." : null }] })
      case "/api/ai-metrics": return json({ features: { read: metric, ask: metric, plan: metric } })
      case "/api/feedback": return json({ ok: true })
      case "/api/refunds/preview": return json({ amount: 39.9, checks: [{ id: "requested_amount", level: "warn", message: "Asked for more than the items are worth." }] })
      case "/api/read-request": return json({
        report: { isRefundRequest: true, summary: "Vase arrived cracked.", requestedAmount: 500 },
        draft: { orderId: "ORD-1042", customerEmail: "mario.rossi@example.com", items: [{ sku: "VAS-CER-01", qty: 1, from: "the sand vase" }], reason: "damaged", refundShipping: false, requestedAmount: 500 },
        unmatched: ["gift wrap"], checks: [], amount: 39.9, provenance: provenance("read") })
      case "/api/plan-refunds": return json({
        proposals: [{ draft: { orderId: "ORD-1042", customerEmail: "mario.rossi@example.com", items: [{ sku: "VAS-CER-01", qty: 1 }], reason: "damaged", refundShipping: false, requestedAmount: null, source: "ai" }, amount: 139.9, checks: [], why: "Damaged." }],
        blocked: [{ orderId: "ORD-1044", why: "x", reasons: ["Outside the 30-day window."] }], note: null, truncated: false, provenance: provenance("plan") })
      case "/api/ask": return sse([
        ["status", { message: "Found 2 of 9 records…" }],
        ["delta", { text: "RF-2003 waits for a supervisor [#RF-2003], RF-7777 too [#RF-7777]." }],
        ["result", { citations: ["RF-2003"], invalidCitations: ["RF-7777"], grounded: true, abstained: false, retrieved: ["RF-2003"] }],
        ["done", { traceId: "trace-ask-0001" }],
      ])
    }
    return json({ error: `unexpected ${path}` }, 404)
  }))
}
afterEach(() => vi.unstubAllGlobals())

const expectNoViolations = async (container: Element) => expect(await axe(container)).toHaveNoViolations()

describe("accessibility (axe)", () => {
  it("the sign-in screen", async () => {
    mockApi(null)
    const { container } = render(<App />)
    await screen.findByRole("button", { name: /Luca Bianchi/ })
    await expectNoViolations(container)
  })

  it("every step of a request: empty form, then the AI draft under review", async () => {
    mockApi()
    const { container } = render(<App />)
    await screen.findByRole("list", { name: "Refunds" })
    await expectNoViolations(container)

    await userEvent.type(screen.getByLabelText("Message"), "The sand vase from ORD-1042 arrived cracked. Refund 500 EUR.")
    await userEvent.click(screen.getByRole("button", { name: "Read with AI" }))
    await screen.findByText(/customer asked for 500.00 €/)
    await screen.findByText(/Asked for more than the items are worth/)
    // The steps say where the model stopped, and flag what a person must check.
    const steps = screen.getByRole("list", { name: "What the copilot did" })
    expect(within(steps).getByText("Some items not matched")).toBeInTheDocument()
    expect(within(steps).getByText(/needs your attention/)).toBeInTheDocument()
    expect(within(steps).getByText(/39.90 €/)).toBeInTheDocument()
    await expectNoViolations(container)
  })

  it("Ask with a streamed, cited answer and feedback", async () => {
    mockApi()
    const { container } = render(<App />)
    await userEvent.click(await screen.findByRole("tab", { name: "Ask" }))
    await userEvent.type(screen.getByLabelText(/question about orders/i), "what's pending?")
    await userEvent.click(screen.getByRole("button", { name: "Ask" }))
    await screen.findByRole("group", { name: "Useful answer?" })
    await expectNoViolations(container)
  })

  it("Bulk with a plan, blocked proposals and feedback", async () => {
    mockApi()
    const { container } = render(<App />)
    await userEvent.click(await screen.findByRole("tab", { name: "Bulk refunds" }))
    await userEvent.type(screen.getByLabelText("Describe the refunds"), "refund the broken vases")
    await userEvent.click(screen.getByRole("button", { name: "Propose refunds" }))
    await screen.findByText("needs supervisor")
    expect(within(screen.getByRole("list", { name: "Bulk refund steps" })).getByText(/1 pass, 1 blocked/)).toBeInTheDocument()
    await expectNoViolations(container)
  })

  it("supervisor view: approvals, history and the AI outcomes table", async () => {
    mockApi()
    const { container } = render(<App />)
    await userEvent.selectOptions(await screen.findByLabelText("Signed in as"), "elena")
    expect((await screen.findAllByText(/models side by side/)).length).toBeGreaterThan(0)
    const list = screen.getByRole("list", { name: "Refunds" })
    await userEvent.click(within(list).getByText("History"))
    await expectNoViolations(container)
  })
})

describe("keyboard", () => {
  it("tabs follow the WAI-ARIA pattern: one tab stop, arrows and Home/End move and select", async () => {
    mockApi()
    render(<App />)
    const request = await screen.findByRole("tab", { name: "New request" })
    const ask = screen.getByRole("tab", { name: "Ask" })
    const bulk = screen.getByRole("tab", { name: "Bulk refunds" })
    expect(request).toHaveAttribute("tabindex", "0")
    expect(ask).toHaveAttribute("tabindex", "-1")
    expect(screen.getByRole("tabpanel", { name: "New request" })).toBeVisible()

    request.focus()
    await userEvent.keyboard("{ArrowRight}")
    expect(ask).toHaveFocus()
    expect(ask).toHaveAttribute("aria-selected", "true")
    expect(screen.getByRole("tabpanel", { name: "Ask" })).toBeVisible()
    await userEvent.keyboard("{End}")
    expect(bulk).toHaveFocus()
    await userEvent.keyboard("{ArrowRight}")
    expect(request).toHaveFocus()   // wraps around
    await userEvent.keyboard("{ArrowLeft}")
    expect(bulk).toHaveFocus()
  })

  it("moves focus to the review step after the AI reads the request", async () => {
    mockApi()
    render(<App />)
    await userEvent.type(await screen.findByLabelText("Message"), "Broken vase, ORD-1042.")
    await userEvent.click(screen.getByRole("button", { name: "Read with AI" }))
    expect(await screen.findByRole("heading", { name: "2 · Review the draft" })).toHaveFocus()
  })
})
