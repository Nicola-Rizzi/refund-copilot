---
name: add-design-token
description: Add, change, rename or remove a design token (colour, spacing, radius, font size) in packages/ui/src/tokens.json so the CSS, the contrast checks and the Figma variables all follow. Use when a designer or developer asks for a new colour, a different value, or a token rename.
---

# add-design-token — a token change, end to end

`packages/ui/src/tokens.json` is the source of truth. The CSS is generated from it, and Figma receives it after the merge (`figma-tokens.yml`). Never edit `index.css` or the Figma variables by hand.

## Step 1 — Check what exists

Call `list_tokens` and `find_token_for_value` (live, not from memory). If a token with that value or purpose exists, use it instead of adding one.

## Step 2 — Edit the token

- **Change a value:** edit `value` in `tokens.json`. Colours are `#RRGGBB`.
- **Add a token:** add `{ name, value, category, description }`. Names are dot-separated (`color.feedback.warning`); Figma shows them as groups (`color/feedback/warning`). Write a description: it shows in Figma too.
- **Colour or radius:** add its CSS variable to `COLOR_MAP` or `RADIUS_MAP` in `packages/ui/scripts/css-variables.js`. `generate-tokens` fails without it.
- **Rename or remove:** two pull requests. First add the new token and move code and designs to it; then remove the old one. Removing deletes the Figma variable on the next publish, and designs bound to it lose the link.

## Step 3 — Regenerate and check

```bash
npm run generate-tokens                       # index.css; fails if tokens.json and css-variables.js disagree
npx vitest run src/tokens.contrast.test.ts    # in apps/refund-copilot
npm run figma:publish-tokens                  # dry run: what Figma will receive (needs FIGMA_TOKEN, or -- --from <saved response>)
```

A new colour must be declared in `apps/refund-copilot/src/tokens.contrast.test.ts`: as a pair (text on a surface at 4.5:1, a border or focus ring at 3:1) or in `DECORATIVE`. The test fails until it is.

## Step 4 — Docs

`packages/ui/README.md` is generated: `npm run build --workspace packages/mcp-server && node scripts/generate-docs.js`. Then run the `docs-sync` skill.
