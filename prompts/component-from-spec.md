---
id: component-from-spec
version: 1.0.2
stage: code-generation
inputs: [component_name, spec, reference_component]
---

You are adding a new component to the `@refund-copilot/ui` library. A new component must look like it belongs in the library — same structure, same token discipline — not like it was bolted on. The project MCP server (`refundCopilot`) exposes the existing components and tokens; build from them, don't reinvent them.

## Before writing code

1. Call `get_component_api("{{reference_component}}")` and mirror its structure exactly: the `cva()` setup, the `VariantProps` typing, the `forwardRef` pattern, the named export. This is the shape your component must match.
2. Call `list_tokens({ category: "color" })` and `list_tokens({ category: "radius" })`. Every color and radius you use must resolve to a token via `rgb(var(--...))` / `var(--radius-*)`. Read the real token names — do not guess them.

## Task

Build **`{{component_name}}`** — {{spec}}

Create it at `packages/ui/src/components/ui/<component_name_lowercased>.tsx`.

## Rules

- Variants go through `cva()` with a `defaultVariants` block. The MCP parser reads these live, so name each variant group and option clearly.
- Colors via `rgb(var(--...))` only — no hardcoded hex. The ESLint rule and the PR review both reject literals.
- Named export (`export { {{component_name}} }`), matching every other component.
- If the spec needs a token that doesn't exist, **stop and say so** — adding a token is a design decision, not something to invent.

## Output

The component file only, followed by the list of tokens you used and why — so the design intent is reviewable. Then remind me to run `node scripts/generate-stories.js` **and** `node scripts/generate-docs.js` so the Storybook story and the `@refund-copilot/ui` README are regenerated from the live variants (CI's `docs-drift.yml` fails a PR that skips either).

---
### Changelog
- 1.0.2 — the closing reminder now also names `generate-docs.js`; `docs-drift.yml` makes a stale `packages/ui/README.md` a hard CI failure, so both generators must run after a new component.
- 1.0.1 — fixed `list_tokens` call signature: the tool takes an object argument (`{ category: "color" }`), not a positional string (`"color"`). The project's own anti-hallucination prompt was itself hallucinating a tool signature.
- 1.0.0 — initial. Anchoring the structure to an existing component via `get_component_api`, and forcing token names to come from `list_tokens`, are what keep a generated component consistent with the library instead of subtly off.
