import { readFileSync } from "node:fs"
import { test, type Page } from "@playwright/test"

// The README's screenshots, from the real app in demo mode (AI_STUB=1).
// Regenerate after a UI change: npm run screenshots (excluded from npm run test:e2e).

const OUT = new URL("../screenshots/", import.meta.url).pathname
// From the top, with CSS transitions settled (a badge changing colour would be caught mid-fade).
async function shot(page: Page, name: string, fullPage = false) {
  await page.evaluate("window.scrollTo(0, 0)")
  await page.screenshot({ path: `${OUT}${name}.png`, fullPage, animations: "disabled" })
}
test.use({ viewport: { width: 1280, height: 860 } })

function demo(name: string) {
  const raw = readFileSync(new URL(`../demo-requests/${name}`, import.meta.url), "utf8")
  const [head, ...rest] = raw.split("\n\n")
  return { from: /^From: (.*)$/m.exec(head)?.[1] ?? "", subject: /^Subject: (.*)$/m.exec(head)?.[1] ?? "", body: rest.join("\n\n").trim() }
}
async function signIn(page: Page, name: RegExp) {
  await page.goto("/")
  await page.getByRole("button", { name }).click()
  await page.getByRole("list", { name: "Refunds" }).waitFor()
}

async function read(page: Page, file: string) {
  const mail = demo(file)
  await page.getByLabel(/^From/).fill(mail.from)
  await page.getByLabel("Subject").fill(mail.subject)
  await page.getByLabel("Message").fill(mail.body)
  await page.getByRole("button", { name: "Read with AI" }).click()
  await page.getByRole("list", { name: "What the copilot did" }).waitFor()
}

test("@screenshots the README's screens", async ({ page }) => {
  await signIn(page, /Luca Bianchi/)
  // Some activity first, so the supervisor's AI outcomes aren't all zero.
  await read(page, "normal.txt")
  await page.getByRole("group", { name: "Did the AI read it right?" }).getByRole("button", { name: "Yes" }).click()
  await page.getByRole("button", { name: "Create refund" }).click()
  await page.getByRole("status").filter({ hasText: /created/ }).waitFor()

  await read(page, "injection.txt")
  await page.getByRole("list", { name: "What the copilot did" }).getByText("Policy blocks this refund").waitFor()
  await shot(page, "injection")
  await page.getByRole("button", { name: "Cancel" }).click()

  await page.getByRole("tab", { name: "Ask" }).click()
  await page.getByLabel("Question about orders and refunds").fill("Which refunds wait for a supervisor?")
  await page.getByRole("button", { name: "Ask" }).click()
  await page.getByRole("group", { name: "Useful answer?" }).waitFor()
  await shot(page, "ask")

  await page.getByRole("tab", { name: "Bulk refunds" }).click()
  await page.getByLabel("Describe the refunds").fill("refund every parcel that never arrived, including shipping")
  await page.getByRole("button", { name: "Propose refunds" }).click()
  await page.getByRole("list", { name: "Bulk refund steps" }).waitFor()
  await shot(page, "bulk")
  await page.getByRole("button", { name: /Create 1 refund/ }).click()
  await page.getByText(/Created 1 refund/).waitFor()

  await page.getByLabel("Signed in as").selectOption({ label: "Elena Conti · supervisor" })
  await page.getByText("AI outcomes").waitFor()
  await page.getByRole("listitem").filter({ hasText: "39.90 €" }).getByRole("button", { name: "Approve" }).click()
  await page.getByRole("row", { name: /Reading requests/ }).filter({ hasText: /^Reading requests1 \/ 01/ }).waitFor()
  await shot(page, "supervisor", true)
})
