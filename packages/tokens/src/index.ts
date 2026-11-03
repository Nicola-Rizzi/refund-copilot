// Reads packages/ui's tokens.json directly rather than keeping a second copy here
// — a duplicate would drift the moment one side changed and the other didn't
// (which is exactly what had happened before this was wired up for real: this
// package's own former copy was already missing a token packages/ui's had).
import tokens from "../../ui/src/tokens.json" with { type: "json" };

export type TokenCategory = "color" | "spacing" | "typography" | "radius" | "shadow";

export interface Token {
  name: string;
  value: string;
  category: TokenCategory;
  description: string;
}

export const allTokens: Token[] = tokens as Token[];

export function getTokensByCategory(category: TokenCategory): Token[] {
  return allTokens.filter(t => t.category === category);
}

export function getToken(name: string): Token | undefined {
  return allTokens.find(t => t.name === name);
}
