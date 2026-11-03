import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import AskPanel from "./components/AskPanel"
import BulkPanel from "./components/BulkPanel"
import type { Order, Refund } from "./types"

afterEach(() => vi.unstubAllGlobals())
const orders = [{ id: "ORD-1045", customerEmail: "alex.moreau@example.com", status: "shipped", deliveredDaysAgo: null, shippedDaysAgo: 12, shipping: 4.9, items: [] }] as Order[]
const refunds = [{ id: "RF-2003", orderId: "ORD-1043", amount: 189, status: "pending_approval" }] as Refund[]

function sse(frames: [string, unknown][], signal?: AbortSignal | null, hold = false) {
  const enc = new TextEncoder()
  return new Response(new ReadableStream({
    start(c) {
      for (const [e, d] of frames) c.enqueue(enc.encode(`event: ${e}\ndata: ${JSON.stringify(d)}\n\n`))
      if (!hold) c.close()
      signal?.addEventListener("abort", () => c.error(new DOMException("Aborted", "AbortError")))
    },
  }), { status: 200 })
}

describe("AskPanel", () => {
  it("streams the answer, then shows verified sources and strikes invented ones", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_p: string, init: RequestInit) => sse([
      ["status", { message: "Reading 6 orders and 3 refunds…" }],
      ["delta", { text: "RF-2003 waits for a supervisor [#RF-2003]" }],
      ["delta", { text: " and so does RF-7777 [#RF-7777]." }],
      ["result", { citations: ["RF-2003"], invalidCitations: ["RF-7777"], grounded: true, abstained: false }],
      ["done", {}],
    ], init.signal)))
    render(<AskPanel orders={orders} refunds={refunds} />)
    await userEvent.type(screen.getByLabelText(/question about orders/i), "what's pending?")
    await userEvent.click(screen.getByRole("button", { name: "Ask" }))
    expect(await screen.findByRole("button", { name: /Source: RF-2003 · ORD-1043 · 189.00 €/ })).toBeInTheDocument()
    expect(screen.getByText("source removed")).toBeInTheDocument()
    expect(screen.getByText("1 invented source removed")).toBeInTheDocument()
  })

  it("Stop keeps the partial answer", async () => {
    vi.stubGlobal("fetch", vi.fn(async (_p: string, init: RequestInit) => sse([["delta", { text: "Partial" }]], init.signal, true)))
    render(<AskPanel orders={orders} refunds={refunds} />)
    await userEvent.type(screen.getByLabelText(/question about orders/i), "q")
    await userEvent.click(screen.getByRole("button", { name: "Ask" }))
    await screen.findByText("Partial")
    await userEvent.click(screen.getByRole("button", { name: "Stop" }))
    expect(await screen.findByText("Stopped")).toBeInTheDocument()
  })
})

describe("BulkPanel", () => {
  it("shows checked proposals and blocked ones, and creates only the ticked refunds", async () => {
    const posted: unknown[] = []
    const plan = {
      proposals: [
        { draft: { orderId: "ORD-1045", customerEmail: "alex.moreau@example.com", items: [{ sku: "CUP-ESP-6", qty: 1 }], reason: "not_received", refundShipping: true, requestedAmount: null, source: "ai" }, amount: 36.9, checks: [], why: "Shipped 12 days ago, not delivered." },
        { draft: { orderId: "ORD-1043", customerEmail: "giulia.ferri@example.com", items: [], reason: "other", refundShipping: false, requestedAmount: null, source: "ai" }, amount: 150, checks: [], why: "test" },
      ],
      blocked: [{ orderId: "ORD-1044", why: "x", reasons: ["Delivered 45 days ago: outside the 30-day return window."] }],
      note: null, truncated: false,
      provenance: { feature: "plan", traceId: "trace-plan-0001", model: "claude-sonnet-5", promptVersion: "plan-refunds@3" },
    }
    vi.stubGlobal("fetch", vi.fn(async (path: string, init: RequestInit) => {
      if (path === "/api/plan-refunds") return new Response(JSON.stringify(plan), { status: 200 })
      posted.push(JSON.parse(String(init.body)))
      return new Response(JSON.stringify({ refund: { id: "RF-2004", status: "pending_approval" } }), { status: 201 })
    }))
    const onCreated = vi.fn()
    render(<BulkPanel policy={{ agentLimit: 100, returnWindowDays: 30, lostAfterDays: 7 }} onCreated={onCreated} />)
    await userEvent.type(screen.getByLabelText(/describe the refunds/i), "refund every lost parcel")
    await userEvent.click(screen.getByRole("button", { name: "Propose refunds" }))
    expect(await screen.findByText("needs supervisor")).toBeInTheDocument()
    expect(screen.getByText("1 proposal blocked by policy")).toBeInTheDocument()
    await userEvent.click(screen.getByRole("checkbox", { name: /ORD-1043/ }))
    await userEvent.click(screen.getByRole("button", { name: "Create 1 refund · 36.90 €" }))
    await waitFor(() => expect(onCreated).toHaveBeenCalled())
    // Each created refund carries the plan's provenance, so the audit trail can join it to the model call.
    expect(posted).toEqual([{ ...plan.proposals[0].draft, ai: { ...plan.provenance, edited: false } }])
    expect(screen.getByText("Created 1 refund; 1 waiting for approval.")).toBeInTheDocument()
  })
})
