import { describe, expect, it } from "vitest"
import tokens from "../../../packages/ui/src/tokens.json"

// WCAG 2.2 contrast for the colour pairs this app actually renders, computed from
// the design tokens. axe can't do this in jsdom (no computed colours), so a token
// change that breaks AA fails here instead of in production.

const hex = Object.fromEntries(tokens.filter((t) => t.category === "color").map((t) => [t.name.replace("color.", ""), t.value]))

function luminance(h: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x)
  return (hi + 0.05) / (lo + 0.05)
}
/** `fg` at `alpha` over white, as a hex colour: the Badge's tinted backgrounds. */
const tint = (fg: string, alpha: number) =>
  "#" + [1, 3, 5].map((i) => Math.round(parseInt(fg.slice(i, i + 2), 16) * alpha + 255 * (1 - alpha)).toString(16).padStart(2, "0")).join("")

const TEXT = 4.5      // 1.4.3, normal-size text
const NON_TEXT = 3    // 1.4.11, focus rings and form-control boundaries

const pairs: [fg: string, bg: string, min: number][] = [
  ["text.default", "surface.card", TEXT],
  ["text.default", "surface.subtle", TEXT],
  ["text.muted", "surface.card", TEXT],
  ["text.muted", "surface.subtle", TEXT],
  ["text.muted", "surface.default", TEXT],
  ["brand.primary", "surface.card", TEXT],               // citations, links
  ["brand.primaryForeground", "brand.primary", TEXT],    // default button, selected tab
  ["brand.accentForeground", "brand.accent", TEXT],      // accent button: Read with AI, Ask, Propose
  ["feedback.error", "surface.card", TEXT],
  ["feedback.success", "surface.card", TEXT],
  ["border.focus", "surface.card", NON_TEXT],
  ["border.input", "surface.card", NON_TEXT],
  ["border.input", "surface.subtle", NON_TEXT],
]

// Colours no text or control boundary is drawn in, so no contrast rule applies.
const DECORATIVE = ["brand.primaryHover", "border.default"]

describe("token contrast (WCAG AA)", () => {
  // A new colour must say how it's used: in a pair above (checked), or decorative here.
  it("every colour token is either contrast-checked or declared decorative", () => {
    const covered = new Set([...pairs.flatMap(([fg, bg]) => [fg, bg]), ...DECORATIVE])
    expect(Object.keys(hex).filter((name) => !covered.has(name))).toEqual([])
  })

  it.each(pairs)("%s on %s ≥ %s:1", (fg, bg, min) => {
    expect(hex[fg], `no token color.${fg}`).toBeDefined()
    expect(contrast(hex[fg], hex[bg])).toBeGreaterThanOrEqual(min)
  })

  // Badge success / error / accent: the colour as text on a 15% tint of itself (badge.tsx).
  it.each(["feedback.success", "feedback.error", "brand.accent"])("%s badge text on its 15%% tint ≥ 4.5:1", (name) => {
    expect(contrast(hex[name], tint(hex[name], 0.15))).toBeGreaterThanOrEqual(TEXT)
  })
})
