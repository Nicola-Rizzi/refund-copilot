import { test } from "node:test";
import assert from "node:assert/strict";
import { findTokenForValue, describeMatches } from "../dist/reverse-lookup.js";

// Real values from packages/ui/src/tokens.json — not synthetic, so a
// change to the actual token set is what would break these, not a fixture drift.
const tokens = [
  { name: "color.brand.primary", value: "#6D28D9", category: "color", description: "" },
  { name: "color.brand.primaryHover", value: "#5B21B6", category: "color", description: "" },
  { name: "color.text.default", value: "#1C1917", category: "color", description: "" },
  { name: "space.1", value: "4px", category: "spacing", description: "" },
  { name: "space.4", value: "16px", category: "spacing", description: "" },
  { name: "space.6", value: "24px", category: "spacing", description: "" },
  { name: "radius.sm", value: "6px", category: "radius", description: "" },
];

test("exact color match resolves to the right token", () => {
  const matches = findTokenForValue("#6D28D9", tokens);
  assert.equal(matches[0].token.name, "color.brand.primary");
  assert.ok(matches[0].distance < 0.001);
});

test("case-insensitive hex still resolves (color parsing is not string-exact)", () => {
  const matches = findTokenForValue("#6d28d9", tokens);
  assert.equal(matches[0].token.name, "color.brand.primary");
});

test("near-miss color (ΔE ≈ 0.0016) is close enough to count as the exact match", () => {
  // One hex digit off from color.brand.primary — imperceptible to the eye,
  // so it correctly resolves as exact, not merely "closest".
  const matches = findTokenForValue("#6D28D8", tokens);
  assert.equal(matches[0].token.name, "color.brand.primary");
  assert.ok(matches[0].distance < 0.02, `expected near-imperceptible distance, got ${matches[0].distance}`);
});

test("genuine near-miss ranks the closest token above unrelated ones, without claiming exactness", () => {
  const matches = findTokenForValue("#7A3AE0", tokens); // visibly lighter/warmer than primary
  assert.equal(matches[0].token.name, "color.brand.primary");
  assert.ok(matches[0].distance > 0.02, "expected this NOT to register as an exact match");
  const hoverRank = matches.findIndex(m => m.token.name === "color.brand.primaryHover");
  assert.ok(hoverRank > 0, "primaryHover should rank below the closer primary match");
});

test("unrelated color still returns ranked candidates, never throws", () => {
  const matches = findTokenForValue("#00FF00", tokens); // pure green — nothing close in the set
  assert.ok(matches.length > 0);
  assert.ok(matches[0].distance > 0.02); // must NOT be reported as an exact match
});

test("exact spacing match in px", () => {
  const matches = findTokenForValue("16px", tokens);
  assert.equal(matches[0].token.name, "space.4");
  assert.equal(matches[0].distance, 0);
});

test("spacing match works across units (rem vs px)", () => {
  const matches = findTokenForValue("1rem", tokens); // 1rem = 16px
  assert.equal(matches[0].token.name, "space.4");
  assert.equal(matches[0].distance, 0);
});

test("near-miss spacing finds the closest token by numeric distance", () => {
  const matches = findTokenForValue("15px", tokens);
  assert.equal(matches[0].token.name, "space.4"); // 16px, Δ1
  assert.equal(matches[0].distance, 1);
});

test("unparseable value returns no matches, not a crash", () => {
  const matches = findTokenForValue("not-a-value", tokens);
  assert.equal(matches.length, 0);
});

test("describeMatches formats an exact color match", () => {
  const out = describeMatches("#6D28D9", findTokenForValue("#6D28D9", tokens));
  assert.match(out, /^Exact match: color\.brand\.primary/);
});

test("describeMatches formats a near-miss with ΔE and a fallback candidate", () => {
  const out = describeMatches("#7A3AE0", findTokenForValue("#7A3AE0", tokens));
  assert.match(out, /No exact match/);
  assert.match(out, /Closest: color\.brand\.primary/);
  assert.match(out, /ΔE/);
});

test("describeMatches on no matches gives an actionable message, not empty text", () => {
  const out = describeMatches("not-a-value", []);
  assert.match(out, /No token found/);
});

test("scalar lookup does not silently conflate spacing and radius", () => {
  // "6px" is an exact radius match and NOT a spacing token — describeMatches
  // must not report it as a flat "closest" across both pooled categories,
  // since that would silently pick radius.sm even when the caller meant spacing.
  const matches = findTokenForValue("6px", tokens);
  const out = describeMatches("6px", matches);
  assert.match(out, /ambiguous across token categories/);
  assert.match(out, /radius: exact — radius\.sm/);
  assert.match(out, /spacing: space\.1/); // closest spacing token (4px), not exact
});

test("scalar lookup within a single category still reports a plain exact match", () => {
  const spacingOnly = tokens.filter(t => t.category !== "radius");
  const matches = findTokenForValue("16px", spacingOnly);
  const out = describeMatches("16px", matches);
  assert.match(out, /^Exact match: space\.4/);
});
