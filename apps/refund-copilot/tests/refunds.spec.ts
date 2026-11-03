import { readFileSync } from "node:fs"
import AxeBuilder from "@axe-core/playwright"
import { expect, test, type Page } from "@playwright/test"

// Browser → Vite → API server → store, with AI_STUB=1 in place of the model.
// The tests share one in-memory store and run in order (playwright.config.ts).

function demo(name: string) {
  const raw = readFileSync(new URL(`../demo-requests/${name}`, import.meta.url), "utf8")
  const [head, ...rest] = raw.split("\n\n")
  return {
    from: /^From: (.*)$/m.exec(head)?.[1] ?? "",
    subject: /^Subject: (.*)$/m.exec(head)?.[1] ?? "",
    body: rest.join("\n\n").trim(),
  }
}

async function signInAs(page: Page, name: RegExp) {
  await page.getByLabel("Signed in as").selectOption({ label: (await page.getByLabel("Signed in as").locator("option").filter({ hasText: name }).textContent()) ?? "" })
}

async function readEmail(page: Page, file: string) {
  const mail = demo(file)
  await page.getByLabel(/^From/).fill(mail.from)
  await page.getByLabel("Subject").fill(mail.subject)
  await page.getByLabel("Message").fill(mail.body)
  await page.getByRole("button", { name: "Read with AI" }).click()
  await expect(page.getByRole("heading", { name: "2 · Review the draft" })).toBeFocused()
}

/** axe in a real browser: unlike jsdom, it measures colour contrast too. */
async function expectAccessible(page: Page) {
  const { violations } = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze()
  expect(violations.map((v) => `${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`)).toEqual([])
}

// Each test starts signed out (a fresh browser context), and signs in as Luca.
test.beforeEach(async ({ page }) => {
  await page.goto("/")
  await page.getByRole("button", { name: /Luca Bianchi/ }).click()
  await expect(page.getByRole("list", { name: "Refunds" })).toBeVisible()
  await expect(page.getByText("Demo mode.")).toBeVisible()
})

test("the session is a server cookie the page can't read or forge", async ({ page, context, request }) => {
  const [cookie] = await context.cookies()
  expect(cookie).toMatchObject({ name: "rc_session", httpOnly: true, sameSite: "Strict" })
  expect(String(await page.evaluate("document.cookie"))).not.toContain("rc_session")
  // Naming another user in a header changes nothing: without the cookie, 401.
  expect((await request.get("/api/refunds", { headers: { "x-user": "elena" } })).status()).toBe(401)
  await page.getByRole("button", { name: "Sign out" }).click()
  await expect(page.getByRole("heading", { name: /Sign in to/ })).toBeVisible()
  await expectAccessible(page)
})

test("a prompt-injection email gets the order's price, blocking checks and no Create", async ({ page }) => {
  await readEmail(page, "injection.txt")
  await expect(page.getByText("customer asked for 500.00 €")).toBeVisible()
  const steps = page.getByRole("list", { name: "What the copilot did" })
  await expect(steps.getByText("Policy blocks this refund")).toBeVisible()
  await expect(page.getByText("500.00 €", { exact: true })).toHaveCount(0)
  await expect(page.getByRole("button", { name: "Create refund" })).toBeDisabled()
  await expectAccessible(page)
})

test("an agent creates a refund from an email; another agent approves it; the history records both", async ({ page }) => {
  await readEmail(page, "normal.txt")
  await expect(page.getByText("39.90 €", { exact: true })).toBeVisible()
  await page.getByRole("group", { name: "Did the AI read it right?" }).getByRole("button", { name: "Yes" }).click()
  await page.getByRole("button", { name: "Create refund" }).click()
  const notice = page.getByRole("status").filter({ hasText: /created: 39.90 €, pending approval/ })
  await expect(notice).toBeVisible()
  const id = /RF-\d+/.exec((await notice.textContent()) ?? "")![0]

  await signInAs(page, /Sara/)
  const item = page.locator(`#refund-${id}`)
  await item.getByRole("button", { name: "Approve" }).click()
  await expect(item.getByText("approved", { exact: true })).toBeVisible()
  await item.getByText("History").click()
  await expect(item.getByText(/created by luca \(agent\)/)).toBeVisible()
  await expect(item.getByText(/approved by sara \(agent\)/)).toBeVisible()
  await expect(item.getByText(/AI draft: read from the request/)).toBeVisible()
})

test("Ask streams an answer with checked sources; the citation jumps to the refund", async ({ page }) => {
  await page.getByRole("tab", { name: "Ask" }).click()
  await page.getByLabel("Question about orders and refunds").fill("Which refunds wait for a supervisor?")
  await page.getByRole("button", { name: "Ask" }).click()
  // The model saw CUST-001; the agent sees the real address.
  await expect(page.getByLabel("Conversation").getByText(/giulia\.ferri@example\.com\) is waiting for approval/)).toBeVisible()
  const source = page.getByRole("button", { name: /Source: RF-2003/ })
  await source.click()
  await expect(page.locator("#refund-RF-2003")).toBeFocused()
  await page.getByRole("group", { name: "Useful answer?" }).getByRole("button", { name: "No" }).click()
  await expect(page.getByText("Thanks, noted.")).toBeVisible()
  await expectAccessible(page)
})

test("Bulk proposes the lost parcel, policy-checked; the agent creates it", async ({ page }) => {
  await page.getByRole("tab", { name: "Bulk refunds" }).click()
  await page.getByLabel("Describe the refunds").fill("refund every parcel that never arrived, including shipping")
  await page.getByRole("button", { name: "Propose refunds" }).click()
  await expect(page.getByRole("list", { name: "Bulk refund steps" }).getByText(/1 pass, 0 blocked/)).toBeVisible()
  await expect(page.getByLabel(/ORD-1045/)).toBeChecked()
  await expectAccessible(page)
  await page.getByRole("button", { name: /Create 1 refund/ }).click()
  await expect(page.getByText("Created 1 refund; 1 waiting for approval.")).toBeVisible()
})

test("a supervisor sees the AI outcomes of this run", async ({ page }) => {
  await signInAs(page, /Elena/)
  const read = page.getByRole("row", { name: /Reading requests/ })
  await expect(read).toContainText("1 / 0")       // the 👍 from the second test
  await expect(read).toContainText("0%")          // its draft was kept as proposed
  await expect(page.getByRole("row", { name: /^Ask/ })).toContainText("0 / 1")
  await expectAccessible(page)
})
