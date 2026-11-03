---
name: docs-sync
description: Check that every doc in the refund-copilot repo still matches the code, fix what drifted, and republish ARCHITECTURE.md. Use after any change to code, scripts, workflows, CI, the MCP surface, ESLint rules, the refund copilot, or the eval — and whenever the user asks to check, align, or update the docs.
---

# docs-sync — keep the docs aligned with the code

The docs in this repo make concrete claims: file paths, npm scripts, workflow names, MCP tool names, rule counts, model ids, limits. Every one of those is a fact the code can contradict. This skill finds the contradictions and fixes the doc, never the code, unless the user says otherwise.

## Step 1 — Mechanical check (deterministic, also run in CI by `ci.yml`)

```bash
node .claude/skills/docs-sync/check-docs.mjs
```

Every file path and `npm run <script>` mentioned in any tracked `*.md` (plus the git-ignored `INTERVIEW-PITCH.md` and `packages/mcp-server/STORY.md`) must exist. Fix every line it prints. If a hit is a genuine non-file (an ADR's rejected option, say), add it to `KNOWN_NON_FILES` in the script instead of rewording the doc.

## Step 2 — Semantic check (read the source, then the doc)

The script can't see these. For each, read the source of truth first, then grep the docs for the claim.

| Claim in the docs | Source of truth |
|---|---|
| MCP tools / prompts / resource | `packages/mcp-server/src/server.ts` (`server.tool(`, `PROMPT_DEFS`, resource) |
| ESLint rules and their count ("three rules") | `packages/eslint-plugin/rules/`, both `eslint.config.js` |
| CI workflows and their count ("eight workflows") | `.github/workflows/*.yml` (names **and** `on:` triggers) |
| `scripts/` listing in CLAUDE.md / ARCHITECTURE.md | `ls scripts scripts/lib` |
| Design-system components, variants, sizes | `get_component_api` via the project MCP (`refundCopilot`; call it live — see the memory rule) |
| Tokens | `get_token` / `list_tokens` via the MCP |
| Endpoints, methods, fields | `get_endpoint` via the MCP |
| Models, `max_tokens`, `thinking`, input caps, prompt versions | `apps/refund-copilot/server/lib/readRequest.ts`, `askShop.ts`, `planRefunds.ts` |
| Refund policy, checks, roles, limits | `apps/refund-copilot/server/lib/checks.ts`, `refunds.ts`, `server/data/seed.json` |
| Rate limit (20/min) | `packages/ai-runtime/src/rateLimit.ts` |
| Prices | `packages/ai-runtime/src/usage.ts` |
| Eval cases, thresholds, hard fails, latency/cost budgets | `apps/refund-copilot/eval/cases.ts`, `harness.ts`, `assistant.ts`, `performance.ts` |
| AI routes, status codes, error `kind`, kill switch, log lines | `apps/refund-copilot/server/lib/handlers.ts`, `packages/ai-runtime/src/observability.ts` |
| API contract (what get_endpoint serves) | `apps/refund-copilot/api.json`, checked against the code by `npm run verify-endpoint-fields` |
| Test counts ("N unit tests") | `cd apps/refund-copilot && npx vitest run` (only if a doc quotes a number) |

Useful sweep for numeric and model claims:

```bash
git ls-files '*.md' | xargs grep -nHoiE "claude-[a-z0-9.-]+|(two|three|four|five|six|seven|[0-9]+) (custom )?(rules|tools|workflows|components|prompts|tests|cases|checks)|[0-9]+ ?/ ?min|max_tokens.{0,6}"
```

Historical narrative ("it was bumped from `claude-sonnet-4-6`…") is correct as history: leave it.

## Step 3 — Where each kind of change must be reflected

| You changed… | Update |
|---|---|
| a CI workflow | CLAUDE.md (structure tree + "CI workflows" table), ARCHITECTURE.md §6, README if it lists checks |
| a script in `scripts/` | CLAUDE.md structure tree + Commands, ARCHITECTURE.md summary table |
| an ESLint rule | CLAUDE.md "ESLint", ARCHITECTURE.md §9, README packages table |
| an MCP tool/prompt/resource | CLAUDE.md "MCP server" table, ARCHITECTURE.md §3, README |
| refund-copilot (rules, checks, reader, UI) | `apps/refund-copilot/README.md`, CLAUDE.md (structure + commands), README's refund paragraph if a number changes |
| an AI route (read / ask / plan), its limits or model | `apps/refund-copilot/api.json`, `apps/refund-copilot/README.md`, `docs/production-notes.md` if logs or limits change, INTERVIEW-PITCH.md |
| the eval | `apps/refund-copilot/README.md` (latest real-model run), README's eval paragraph, `docs/failure-analysis.md` if a lesson changes |
| a component in `packages/ui` | regenerate: `node scripts/generate-docs.js && node scripts/generate-stories.js` (never hand-edit those outputs) |
| tokens.json | `npm run generate-tokens` |

## Step 4 — Republish ARCHITECTURE.md if it changed

```bash
node .claude/skills/docs-sync/render-md.mjs ARCHITECTURE.md <scratchpad>/architecture.html "Refund copilot — Architecture"
```

Then `publish_files` (claude-artifacts) on the existing slug `4f0777ca-1a1b-44af-8701-275ea6c6ae93` with `base_version` from `get_artifact`, file served `as: index.html`. Republish in place; never mint a new artifact.

## Step 5 — Report

List each drift found as `file:line — doc said X, code says Y — fixed`. Re-run Step 1 and say it passes. If nothing drifted, say so in one line.
