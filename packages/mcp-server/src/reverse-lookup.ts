// Reverse lookup: given a raw value found in legacy code (a hex color, a px
// spacing, a radius), find which design token it corresponds to — or the
// closest one, when there's no exact match.
//
// This is the inverse of list_tokens/get_token: those answer "what's the
// value of token X"; this answers "what token is this value", which is the
// actual operation needed to refactor hardcoded styles onto the design
// system, or to audit drift between Figma and code.
import { converter, differenceEuclidean } from "culori";
import type { Token } from "./design-system.js";

const toOklch = converter("oklch");
const oklchDistance = differenceEuclidean("oklch");

export interface LookupMatch {
  token: Token;
  distance: number; // 0 = exact. Scale differs by category — see describeMatch.
}

/**
 * Perceptual color distance is not the same as RGB distance: two hex values
 * with a small byte-level gap can look identical or very different depending
 * on which channel moved. OKLCH is a perceptually-uniform color space, so
 * Euclidean distance there tracks "how different does this look" much closer
 * than diffing RGB bytes would.
 */
function colorDistance(a: string, b: string): number {
  const oa = toOklch(a);
  const ob = toOklch(b);
  if (!oa || !ob) return Infinity; // unparseable input — never treat as a match
  return oklchDistance(oa, ob);
}

/** Parses "16px", "1rem", "16" → a comparable number. Unitless tokens assumed px. */
function parseScalar(value: string): number | null {
  const match = value.trim().match(/^(-?[\d.]+)\s*(px|rem|em)?$/);
  if (!match) return null;
  const n = parseFloat(match[1]);
  if (match[2] === "rem" || match[2] === "em") return n * 16; // assume 1rem = 16px
  return n;
}

const SCALAR_CATEGORIES: Token["category"][] = ["spacing", "radius"];

/**
 * Finds the token matching `value`, searching only within `category` if a
 * category is present on the token set being searched (typography/shadow are
 * compared as opaque strings — exact match only, since there's no principled
 * distance metric for "how close is one font-stack to another").
 */
export function findTokenForValue(value: string, tokens: Token[]): LookupMatch[] {
  const trimmed = value.trim();

  // Try color first — anything that looks like a hex/rgb/hsl string.
  if (/^#|^rgb|^hsl/i.test(trimmed)) {
    const candidates = tokens.filter(t => t.category === "color");
    return candidates
      .map(token => ({ token, distance: colorDistance(trimmed, token.value) }))
      .filter(m => Number.isFinite(m.distance))
      .sort((a, b) => a.distance - b.distance);
  }

  // Then scalar (spacing/radius) — numeric distance in px-equivalent units.
  const asScalar = parseScalar(trimmed);
  if (asScalar !== null) {
    const candidates = tokens.filter(t => SCALAR_CATEGORIES.includes(t.category));
    return candidates
      .map(token => {
        const tokenScalar = parseScalar(token.value);
        return tokenScalar === null
          ? null
          : { token, distance: Math.abs(asScalar - tokenScalar) };
      })
      .filter((m): m is LookupMatch => m !== null)
      .sort((a, b) => a.distance - b.distance);
  }

  // Fall back to exact string match for anything else (typography, shadow).
  return tokens
    .filter(t => t.value.trim() === trimmed)
    .map(token => ({ token, distance: 0 }));
}

/** Formats a match list into the text a tool result should return. */
export function describeMatches(value: string, matches: LookupMatch[]): string {
  if (matches.length === 0) {
    return `No token found for "${value}" — it may not be a color, spacing, or radius value, or no tokens exist in that category.`;
  }

  const isColor = /^#|^rgb|^hsl/i.test(value.trim());
  const fmt = (m: LookupMatch) =>
    isColor
      ? `${m.token.name} (${m.token.value}) — ΔE ≈ ${m.distance.toFixed(3)}`
      : `${m.token.name} (${m.token.value}) — Δ ${m.distance}px`;

  if (isColor) {
    const [best, ...rest] = matches;
    if (best.distance < 0.02) return `Exact match: ${fmt(best)}`; // ΔE < 0.02 ≈ imperceptible
    const lines = [`No exact match for "${value}".`, `Closest: ${fmt(best)}`];
    if (rest[0]) lines.push(`Second closest: ${fmt(rest[0])}`);
    return lines.join("\n");
  }

  // Scalar (spacing/radius): report the best match per category separately, not
  // one flat "closest" pooled across both. A value like "6px" can be an exact
  // radius token and nowhere near any spacing token (or vice versa) — collapsing
  // them into one sorted list silently picks whichever category happens to have
  // the closer number, even when that's not the category the caller meant.
  const categories = [...new Set(matches.map(m => m.token.category))];
  if (categories.length <= 1) {
    const [best, ...rest] = matches;
    if (best.distance === 0) return `Exact match: ${fmt(best)}`;
    const lines = [`No exact match for "${value}".`, `Closest: ${fmt(best)}`];
    if (rest[0]) lines.push(`Second closest: ${fmt(rest[0])}`);
    return lines.join("\n");
  }

  const lines = [`"${value}" is ambiguous across token categories — closest match per category:`];
  for (const category of categories) {
    const best = matches.find(m => m.token.category === category)!; // matches is sorted by distance
    lines.push(`  ${category}: ${best.distance === 0 ? "exact — " : ""}${fmt(best)}`);
  }
  return lines.join("\n");
}
