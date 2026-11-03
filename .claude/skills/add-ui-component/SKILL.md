---
name: add-ui-component
description: Add a component (or a variant) to the @refund-copilot/ui design system so the MCP, Storybook and the generated README all pick it up and CI stays green. Use when the user asks for a new design-system component, variant or size.
---

# add-ui-component — a design-system component, end to end

## Step 1 — Look before writing

Call `list_components` and `get_component_api` on the closest existing component (live, not from memory) and copy its shape. Call `list_tokens` for every color you need.

## Step 2 — Write it

- File: `packages/ui/src/components/ui/<name>.tsx`, a named export (`export const Name = …`).
- Variants and sizes go in one `cva()` call. The MCP parses that call live, so variants defined anywhere else are invisible to agents and to `verify-component-props.js`.
- Colors only as `rgb(var(--<token>))`. A new color is a new token: follow the `add-design-token` skill. Never edit `index.css` by hand.
- Any button in it has a handler, a `type="submit"`/`"reset"` or a `<form>` ancestor (`no-inert-button`).

## Step 3 — Regenerate (CI fails if you don't)

```bash
npm run build --workspace packages/mcp-server
node scripts/generate-stories.js     # apps/ui-docs/stories/<Name>.stories.tsx
node scripts/generate-docs.js        # packages/ui/README.md
```

Never hand-edit the generated stories. `DesignTokens.stories.tsx` is the one hand-written file.

## Step 4 — Check

```bash
npm run lint
get_component_api("<name>")          # the MCP now returns the new variants
npm run verify-component-props       # every variant used in the diff exists
```

Then run the `docs-sync` skill if a doc lists the components (`CLAUDE.md`, `README.md`).
