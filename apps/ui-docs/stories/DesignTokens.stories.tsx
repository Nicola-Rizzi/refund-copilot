// Hand-written, NOT auto-generated. `scripts/generate-stories.js` only emits the
// per-component story files; this page is maintained by hand.
//
// It reads the token set straight from the `@refund-copilot/tokens` package — the same
// `packages/ui/src/tokens.json` the MCP server resolves `get_token` against
// and the component library derives its CSS variables from — so the visual
// reference here cannot drift from the source of truth it documents.
import type { CSSProperties } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import {
  allTokens,
  getTokensByCategory,
  type Token,
  type TokenCategory,
} from "@refund-copilot/tokens";

// Page chrome uses the design system's own CSS variables (index.css is loaded by
// .storybook/preview.ts), never hardcoded hex — the same rule the components follow.
const chrome = {
  text: "rgb(var(--text))",
  muted: "rgb(var(--text-muted))",
  card: "rgb(var(--surface-card))",
  subtle: "rgb(var(--surface-subtle))",
  border: "rgb(var(--border))",
  brand: "rgb(var(--brand))",
} as const;

const previewBox: CSSProperties = {
  width: 64,
  height: 44,
  flexShrink: 0,
  border: `1px solid ${chrome.border}`,
  borderRadius: 8,
  boxSizing: "border-box",
};

function Preview({ token }: { token: Token }) {
  switch (token.category) {
    case "color":
      return <div style={{ ...previewBox, background: token.value }} />;
    case "radius":
      return <div style={{ ...previewBox, borderRadius: token.value, background: chrome.subtle }} />;
    case "spacing":
      return (
        <div style={{ ...previewBox, display: "grid", placeItems: "center", background: chrome.subtle }}>
          <div style={{ width: token.value, height: token.value, background: chrome.brand }} />
        </div>
      );
    case "shadow":
      return <div style={{ ...previewBox, boxShadow: token.value, background: chrome.card }} />;
    case "typography":
      return (
        <div
          style={{
            ...previewBox,
            display: "grid",
            placeItems: "center",
            background: chrome.card,
            ...(token.name.includes("size")
              ? { fontSize: token.value }
              : { fontWeight: Number(token.value) || undefined }),
          }}
        >
          Ag
        </div>
      );
    default:
      return <div style={previewBox} />;
  }
}

function Swatch({ token }: { token: Token }) {
  return (
    <div style={{ display: "flex", gap: 14, alignItems: "center", padding: "8px 0" }}>
      <Preview token={token} />
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 13, color: chrome.text }}>
          {token.name}
        </div>
        <div style={{ fontSize: 12, color: chrome.muted }}>
          <code>{token.value}</code> — {token.description}
        </div>
      </div>
    </div>
  );
}

const CATEGORY_ORDER: TokenCategory[] = ["color", "spacing", "typography", "radius", "shadow"];

function DesignTokens() {
  return (
    <div style={{ maxWidth: 680, color: chrome.text, fontFamily: "system-ui, -apple-system, sans-serif" }}>
      <p style={{ fontSize: 13, color: chrome.muted }}>
        {allTokens.length} tokens, imported from <code>@refund-copilot/tokens</code> (a typed re-export of{" "}
        <code>packages/ui/src/tokens.json</code>). This page renders the live values — change a token and
        it moves here, in the generated component READMEs, and in <code>get_token</code> together.
      </p>
      {CATEGORY_ORDER.map((category) => {
        const tokens = getTokensByCategory(category);
        if (tokens.length === 0) return null;
        return (
          <section key={category} style={{ marginTop: 28 }}>
            <h3
              style={{
                textTransform: "capitalize",
                margin: "0 0 4px",
                paddingBottom: 4,
                borderBottom: `1px solid ${chrome.border}`,
              }}
            >
              {category}
            </h3>
            {tokens.map((token) => (
              <Swatch key={token.name} token={token} />
            ))}
          </section>
        );
      })}
    </div>
  );
}

const meta: Meta<typeof DesignTokens> = {
  title: "Foundations/Design Tokens",
  component: DesignTokens,
  parameters: { layout: "padded", controls: { disable: true } },
};
export default meta;

export const AllTokens: StoryObj<typeof DesignTokens> = {};
