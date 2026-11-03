# Refund copilot — Agent Guide

This file is read automatically by Claude Code and any MCP-compatible agent when the project is opened. It tells the agent how to work in this repo without guessing.

---

## What this repo is

A monorepo that solves one problem: AI agents generate frontend code that looks correct but breaks at runtime — wrong prop names, hardcoded colors that don't match the design system, API fields that don't exist.

The fix is an MCP server that exposes the project's source of truth as queryable tools. Before writing any code, an agent calls a tool and gets the exact value from the live source files. No pasting docs into chat. No stale context files.

That's the **build-time** half — the MCP server plus the CI, prompt, and codegen tooling around it (`packages/`, `scripts/`, `prompts/`). The repo's other half is **runtime** AI: the product, `apps/refund-copilot`, an e-commerce support tool where the model reads customer refund requests (email or receipt photo), retrieves the records a question needs and answers with verified citations, and proposes batches of refunds; code prices every refund from the order and checks policy; agents and supervisors approve by role (the server owns the data and enforces who may do what). The Anthropic key stays server-side, the AI features have evals with hard fails, latency/cost budgets and an offline self-test, and shared server plumbing lives in `packages/ai-runtime`. Same principle at both ends: give the model real structure, keep a human owning the judgment.

---

## Commands

```bash
npm install                     # bootstrap every workspace (npm workspaces; run at root)

npm run dev                     # root: build the MCP, then run refund-copilot's API (:8788) + Vite (:5174);
                                #       needs ANTHROPIC_API_KEY
npm run dev:refunds             # root: the same, without rebuilding the MCP
npm run demo                    # root: the app with AI_STUB=1 (keyword rules instead of the model), no key

# Tests — root `npm test` fans out to each workspace's own `test` script (--if-present)
npm test                        # root: all workspaces
npm run lint                    # root: the three project ESLint rules over packages/ui/src + apps/ui-docs
                                #       (apps/refund-copilot has its own richer config — lint it separately)
npm run verify-component-props  # root: check every variant/size in `git diff origin/main...HEAD`
                                #       against live get_component_api (needs origin/main fetched)

# packages/mcp-server
npm run build                   # tsc — REQUIRED after any src/ change and before its tests
npm test                        # build + `node --test test/*.test.mjs` (e2e via the real MCP SDK client)
npm run eval                    # parser-fidelity check — run after touching loaders.ts
npm run build && node --test test/http.test.mjs   # a single MCP test file

# apps/refund-copilot
ANTHROPIC_API_KEY=... npm run dev:api           # API server on :8788 (tsx); DISABLED_AI_FEATURES=read,ask,plan → kill switch;
                                                #   DAILY_AI_BUDGET_USD=1 → per-user daily AI spend cap;
                                                #   AI_PROVIDER=bedrock AWS_REGION=… → the model on Amazon Bedrock (no Anthropic key);
                                                #   READ_CANARY_MODEL=… CANARY_PERCENT=10 → gradual release (also PLAN_, ASK_);
                                                #   VOYAGE_API_KEY=… → Ask also searches by meaning (embeddings)
npm start                                       # production: API + built UI on $PORT, CSP headers; needs SESSION_SECRET
npm run build                                   # tsc -b (UI + server + evals) && vite build
npm run lint                                    # eslint .
npm test                                        # vitest: policy, roles, audit trail, privacy, reader, API, UI flow, a11y (axe)
npm run test:e2e                                # Playwright + axe in Chromium, real UI + API with AI_STUB=1
npm run screenshots                             # regenerate the README screenshots (screenshots/), same setup
npx vitest run server/lib/refunds.test.ts       # a single test file
npm run eval:extract:selftest                   # offline harness self-test
ANTHROPIC_API_KEY=... npm run eval:extract      # reading + Ask/Bulk vs the real model, then p95 latency + cost budgets

# other workspaces
npm test --workspace=packages/eslint-plugin       # RuleTester fixtures for the three rules
npm test --workspace=packages/ai-runtime          # typecheck + vitest
npm run demo --workspace=packages/auditor-agent   # LangGraph human-in-the-loop walkthrough
npm test     --workspace=packages/auditor-agent
npm run dev  --workspace=apps/ui-docs             # Storybook on :6006

# CI (mirrors ci.yml; Node 20)
npm run build --workspace packages/mcp-server   # typecheck the MCP
(cd apps/refund-copilot && npx tsc -b --noEmit)      # typecheck the app (UI + server + evals)
npm run lint                                         # root design-system rules
npm run lint --workspace apps/refund-copilot         # app ESLint
npm test                                             # all workspaces
npm run test:scripts                                 # scripts/ unit tests (not a workspace)
npm run eval:extract:selftest --workspace apps/refund-copilot   # offline eval self-test
npm run test:e2e --workspace apps/refund-copilot                # end to end (after npx playwright install chromium)
node .claude/skills/docs-sync/check-docs.mjs                    # every path + npm script in the docs exists
```

`generate-tokens`, `generate-stories`, and `generate-docs` have their own sections below.

---

## Monorepo structure

```
packages/
  ui/                  @refund-copilot/ui           — design system: tokens.json → generated index.css, and React
                                                       components (Button, Input, Card, Badge, Dialog) on cva()
  mcp-server/          refund-copilot-mcp           — MCP server: serves tokens + components + the API contract
  eslint-plugin/       @refund-copilot/eslint-plugin — ESLint rules: no-hardcoded-colors, no-silent-catch, no-inert-button
  ai-runtime/          @refund-copilot/ai-runtime   — shared server plumbing for the AI routes: model client seam,
                                                       usage/cost logging, trace ids, kill switch, rate limit,
                                                       per-user daily spend cap
  tokens/              @refund-copilot/tokens       — typed re-export of ui/src/tokens.json (no second copy, no React
                                                       dep); still edit tokens.json under packages/ui, not here
  auditor-agent/       @refund-copilot/auditor-agent — LangGraph agent: finds hardcoded hex, resolves via MCP,
                                                       applies fixes only with human-in-the-loop approval
apps/
  refund-copilot/                            — the product: e-commerce refunds. The model reads customer requests,
                                                code prices and checks policy, agents/supervisors approve by role.
                                                TypeScript throughout; server + evals run with tsx (see its README)
    api.json                                 — the API contract list_endpoints / get_endpoint serve (Rule 2)
    server/                                  — API server: owns the data and the rules; all policy in
                                                server/lib/handlers.ts, checks.ts, refunds.ts
    eval/                                    — evals (reading, Ask, Bulk, latency/cost budgets) + offline self-test
  ui-docs/                                   — Storybook: every component variant + a Design Tokens page
prompts/                                     — versioned, parameterized prompts, one per SDLC stage. The MCP
                                                registers the four parameterized ones as prompts (PROMPTS_PATH);
                                                pr-review.md is loaded directly by scripts/review-pr.js
docs/                                        — worked write-ups: production-notes, failure-analysis (local only,
                                                git-ignored like ARCHITECTURE.md: only READMEs go to the remote;
                                                keep them current all the same)
scripts/
  review-pr.js                               — calls Claude API to review a git diff against project rules
  verify-component-props.js                  — deterministic check: diffs' variant/size prop values against
                                                live get_component_api output, no LLM judgment call — see Rule 1
  verify-endpoint-fields.js                  — deterministic check: the Refund type + every api() body against
                                                live get_endpoint output (logic in scripts/lib/) — see Rule 2
  generate-docs.js                           — generates packages/ui/README.md from live MCP tool output
  generate-stories.js                        — generates the Storybook story files from live MCP tool output
  figma-publish-tokens.js                    — publishes tokens.json to Figma variables, code → Figma only
                                                (plan logic in scripts/lib/figma-tokens.mjs)
.github/workflows/
  pr-review.yml                              — runs review-pr.js on every PR, posts result as comment
  component-props.yml                        — runs verify-component-props.js on every PR touching .tsx/.jsx,
                                                fails the check if a value doesn't match the live component API
  endpoint-fields.yml                        — runs verify-endpoint-fields.js, fails the check if a field
                                                doesn't match the live endpoint contract
  token-drift.yml                            — fails if tokens.json changed without regenerating index.css
  docs-drift.yml                             — fails if packages/ui changed without regenerating README + stories
  ci.yml                                     — every push to main + every PR: typecheck the MCP and the app,
                                                lint, `npm test` across all workspaces, scripts tests, the eval
                                                self-test, Playwright e2e, docs reference check
  eval.yml                                   — manual only: runs the refund copilot eval against the real model
                                                (needs the ANTHROPIC_API_KEY secret; a few cents a run)
  figma-tokens.yml                           — after tokens.json changes on main: publishes it to Figma as
                                                variables (needs FIGMA_TOKEN + FIGMA_FILE_KEY; skips without)
render.yaml                                  — Render blueprint: refund-copilot as one web service, AI_STUB=1
.claude/skills/docs-sync/                    — agent skill for Rule 4: docs ↔ code check (check-docs.mjs),
                                                change → doc map, ARCHITECTURE.md publisher (render-md.mjs)
.claude/skills/ai-feature-change/            — change a prompt/model/AI core: eval case first, prompt version,
                                                offline self-test, real eval only with consent
.claude/skills/add-mcp-tool/                 — new MCP tool end to end: interface, loader, registration, e2e, docs
.claude/skills/add-ui-component/             — new design-system component: cva(), tokens, regenerate stories + README
.claude/skills/add-design-token/             — add / change / rename a token: CSS variable, contrast test, Figma
.claude/rules/                               — path-scoped rules loaded only when the agent touches those files:
                                                refund-server.md, mcp-server.md, frontend.md
```

---

## Rules for agents — MANDATORY before writing code

### Rule 1 — Before writing any JSX that uses a component
Call `get_component_api(<name>)`. Variant names are specific to this library and cannot be guessed.

```
get_component_api("button")
→ variant: 'default' | 'outline' | 'ghost' | 'destructive' | 'accent'
→ size: 'sm' | 'md' | 'lg' | 'icon'
```

What agents write wrong without this:
- Delete button → `variant="danger"` — correct is `variant="destructive"`
- Error input → `variant="invalid"` — correct is `variant="error"`

This rule is a discipline, not a guarantee — an agent can still "remember" a variant from earlier in the same
conversation and skip the live call, and get it right by luck. `scripts/verify-component-props.js` is the
backstop for that: it re-derives the same live `get_component_api` output CI-side and fails the
`component-props.yml` check if any variant/size value in the diff isn't in it. It doesn't ask an LLM to judge —
straight string comparison — so it's safe to let it block a PR. Run it locally with `npm run verify-component-props`.

### Rule 2 — Before writing any API call or data hook
Call `list_endpoints`, then `get_endpoint(<path>[, <method>])` for the full contract. Pass `method` when a path serves more than one (`/api/refunds` is GET and POST) — otherwise you get the first and a POST body is easy to miss.

```
get_endpoint("/api/refunds", "GET")
→ Wrapped: { refunds: [...] } — NOT a bare array, NOT { items: [] }
→ Fields: id, orderId, customerEmail, amount, status, approveBlocker, … — NOT total, state, canApprove
get_endpoint("/api/refunds", "POST")
→ Body has NO amount field: the server prices from the order
```

Backstopped in CI by `scripts/verify-endpoint-fields.js` (`endpoint-fields.yml`), the Rule 2 analogue of `verify-component-props.js`: it re-derives the live contract and **fails the check** if `apps/refund-copilot/src/types.ts`'s `Refund` or any `api()` / `apiStream()` request body uses a field or an endpoint that isn't in it. Straight string comparison, no LLM — safe to let it block. Run locally with `npm run verify-endpoint-fields`.

### Rule 3 — Never hardcode colors
Use `get_token(<name>)`. In JSX use CSS variables, not hex:

```tsx
// correct
style={{ color: "rgb(var(--feedback-error))" }}

// wrong — breaks when the token changes, and the ESLint rule will flag it
style={{ color: "#B91C1C" }}
```

Already have a hex value and need its token? Call `find_token_for_value("#B91C1C")` — reverse lookup, raw value in, token name out.

Hardcoded hex is also caught at write time by `@refund-copilot/no-hardcoded-colors` (ESLint) and at PR time by `scripts/review-pr.js` (Claude API).

### Rule 4 — Docs change in the same commit as the code
Every doc here makes checkable claims (paths, scripts, workflow names, rule counts, model ids, limits). When you change code, update every doc that describes it **before** you call the task done — not in a follow-up. Run the `docs-sync` skill (`.claude/skills/docs-sync/SKILL.md`): it has the change → doc map and the sources of truth. Its mechanical half runs standalone:

```bash
node .claude/skills/docs-sync/check-docs.mjs   # every path + `npm run` in every doc must exist; exit 1 otherwise
```

If `ARCHITECTURE.md` changed, republish it to its artifact (step 4 of the skill).

---

## Token pipeline — how a color change reaches the browser

```
packages/ui/src/tokens.json          ← edit this
        ↓
npm run generate-tokens                    ← run this (CI enforces this via token-drift.yml)
        ↓
packages/ui/src/index.css            ← generated, never edit by hand
        ↓
apps/refund-copilot and apps/ui-docs      ← import index.css directly

        ↓ after merge to main (figma-tokens.yml)
Figma variables, collection "Refund copilot tokens"   ← published, never edited there
```

Never duplicate CSS variables in app-level stylesheets — they will drift from tokens.json.

If you change `tokens.json` without running `generate-tokens` before pushing, the `token-drift.yml` CI job will fail and tell you exactly what to run.

Adding or changing a token: follow the `add-design-token` skill. In short, `tokens.json` plus its CSS variable in `packages/ui/scripts/css-variables.js` (the generator fails without it), `npm run generate-tokens`, and a contrast pair or a `DECORATIVE` entry in `apps/refund-copilot/src/tokens.contrast.test.ts` (the test fails without it). Rename in two PRs (add, migrate, then remove): removing a token deletes its Figma variable on the next publish.

Figma never writes back: `tokens.json` is the source of truth, and `npm run figma:publish-tokens` (dry run; `-- --publish` to write) mirrors it into a code-owned Figma collection, with each variable's `codeSyntax` set to the CSS developers should write. A designer who wants a different colour opens a PR on `tokens.json`, where the contrast test checks it. Offline plan: `npm run figma:publish-tokens -- --from scripts/test/fixtures/figma-variables-local.json`. The plan is type-checked against Figma's official types (`@figma/rest-api-spec`, via `scripts/tsconfig.json` in `npm run test:scripts`) but has not yet run against a real Figma file (the Variables API needs Enterprise): treat the first real publish as a test, on a scratch file.

---

## How to add a new MCP tool

**Step 1 — Add the data interface** to `packages/mcp-server/src/design-system.ts`:
```typescript
export interface MyData {
  id: string;
  value: string;
}
```

**Step 2 — Add a loader** to `packages/mcp-server/src/loaders.ts`:
```typescript
export function loadMyData(): MyData[] {
  const path = process.env.MY_DATA_PATH ?? "./path/to/data.json";
  return JSON.parse(readFileSync(path, "utf8"));
}
```

**Step 3 — Register the tool** in `packages/mcp-server/src/server.ts` inside `createMcpServer()` — **not** in `index.ts` or `http.ts`:
```typescript
server.tool(
  "get_my_data",
  "Description of what this returns.",
  { id: z.string().describe("The item id.") },
  async ({ id }) => {
    const item = loadMyData().find(d => d.id === id);
    if (!item) return { content: [{ type: "text", text: `Not found: ${id}` }], isError: true };
    return { content: [{ type: "text", text: `${item.id} = ${item.value}` }] };
  }
);
```

**Step 4 — Rebuild and test:**
```bash
cd packages/mcp-server && npm run build

echo '{"jsonrpc":"2.0","id":1,"method":"tools/call","params":{"name":"get_my_data","arguments":{"id":"test"}}}' \
  | node dist/index.js 2>/dev/null
```

**Loader rules (mandatory):**
- Always read from an env var — never hardcode a path
- Never call `readFileSync` inline inside a `server.tool()` handler — always via a loader
- `design-system.ts` and `loaders.ts` must stay in sync: if you add a field to one, update the other

---

## How to add a new component to @refund-copilot/ui

1. Create `packages/ui/src/components/ui/<name>.tsx`
2. Use `cva()` from `class-variance-authority` — the MCP parser reads the variants live
3. Use `rgb(var(--<token>))` for all colors — never hardcode hex
4. Export as a named export: `export const MyComponent = ...`

The MCP picks up new components automatically — no MCP rebuild needed.

After adding a component, regenerate **both** generated artifacts so the new component shows up in them:
```bash
node scripts/generate-stories.js   # Storybook story file for the new component
node scripts/generate-docs.js      # packages/ui/README.md (component + token tables)
```
Both read live MCP output. `docs-drift.yml` fails a PR that changes a component's source without a regenerated `packages/ui/README.md`; `token-drift.yml` covers `tokens.json` → `index.css`.

---

## Storybook stories

The per-component story files in `apps/ui-docs/stories/` (`Button.stories.tsx`, …) are **auto-generated** — do not edit them by hand, edits will be overwritten. They come from live MCP output, so `argTypes` and named stories always match the actual `cva()` variants in the source.

To regenerate after any component change:
```bash
node scripts/generate-stories.js
```

`DesignTokens.stories.tsx` is the one **hand-written** file in that directory — the generator never touches it. It imports `@refund-copilot/tokens` and renders the token set live.

---

## ESLint

`packages/eslint-plugin/` provides three custom rules, all `"error"` in both the root and `apps/refund-copilot` configs:

- **`@refund-copilot/no-hardcoded-colors`** — any hex literal in JSX (also inside `clsx()`/`cn()` args).
- **`@refund-copilot/no-silent-catch`** — a `catch` that neither re-throws nor references the caught error.
- **`@refund-copilot/no-inert-button`** — a `<button>`/`<Button>` with no `on*` handler, no `type="submit"`/`"reset"`, and no ancestor `<form>`: a control that renders but does nothing. Off in `*.test.tsx`/`*.spec.tsx` (test fixtures render bare buttons on purpose).

`no-hardcoded-colors` message:

```
Hardcoded color "#B91C1C". Use a CSS variable instead: rgb(var(--<token>)).
Run `list_tokens` in the MCP to find the right token.
```

To run manually:
```bash
node node_modules/.bin/eslint apps/refund-copilot/src
```

---

## MCP server

Surface, all registered in `src/server.ts`:

| Kind | Name | Purpose |
|---|---|---|
| tool | `list_tokens` / `get_token` | design tokens (name → value); `list_*` paginate with `limit`/`offset` |
| tool | `find_token_for_value` | reverse lookup: raw hex/rgb in → matching token out (the auditor-agent uses this) |
| tool | `list_components` / `get_component_api` | component variant/size props, parsed live from the `.tsx` `cva()` calls |
| tool | `list_endpoints` / `get_endpoint` | API contract from `apps/refund-copilot/api.json` |
| prompt | `component_from_spec`, `api_consumer`, `test_generation`, `migration` | serves the matching `prompts/*.md` file as an MCP prompt, rendered live |
| resource | `refund-copilot-overview` (`devcontext://overview`) | one-page project orientation |

Source paths come from env vars (set in `.mcp.json`), with defaults for a root-cwd run:
`SHARED_UI_PATH` (→ `packages/ui/src`), `API_CONTRACT_PATH` (→ `apps/refund-copilot/api.json`), `PROMPTS_PATH` (→ `prompts`).

Two transports, same surface (both call `createMcpServer()` in `src/server.ts`):

```bash
cd packages/mcp-server

npm start            # stdio — the client spawns this as a subprocess (default, zero-config)
npm run build        # required after any src/ change

npm run start:http   # HTTP — one long-running server the whole team points at
PORT=4000 npm run start:http   # custom port (default 3100)
```

- **stdio** is the zero-config default: the root `.mcp.json` uses `command` + `args`, so each developer's client spawns its own process. Good for solo work.
- **HTTP** is for the shared-server case: run it once (locally or on a shared host) and point every client's config at `http://<host>:3100/mcp` instead of a command. Health check at `/health` (stays open with no token, even when auth is on).
- **Auth on HTTP is opt-in via `AUTH_TOKEN`** — unset, any request is accepted (matches the pre-auth default); set it and clients need `Authorization: Bearer <token>` on every `/mcp` request. See `src/http.ts` and the README's "Connect a client" section.

Rules specific to `packages/mcp-server/src/`:
- All tool registrations go in `src/server.ts` (`createMcpServer()`). Never add tools to `index.ts` or `http.ts` — those are just transport entry points.
- No in-memory state, no file caching, no outbound HTTP requests. Reads source files on every tool call — intentional.
- After any `src/` change: `npm run build`.
- Validate the parser after touching `loaders.ts`: `npm run eval`.

---

## How to change which AI agent/client you use

The MCP server is client-agnostic. Only the config file location changes:

| Client | Config file |
|---|---|
| Claude Code | `.mcp.json` in project root (already present) |
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Cursor | `~/.cursor/mcp.json` |
| Windsurf | `~/.codeium/windsurf/mcp_config.json` |

That table is for the **stdio** default (`command` + `args`). For the **HTTP** transport, run `npm run start:http` and replace the `command`/`args` block with `"url": "http://your-server:3100/mcp"`.

The agent rules in this `CLAUDE.md` are Claude-specific. Cursor uses `.cursorrules`, Windsurf uses `.windsurfrules` — same content, different filename.

---

## CI workflows

| Workflow | Triggers on | What it does |
|---|---|---|
| `pr-review.yml` | Every PR (opened or updated) | Runs `scripts/review-pr.js`, posts Claude's review as a PR comment — advisory, does not block merge; skips with a notice without the `ANTHROPIC_API_KEY` secret |
| `component-props.yml` | PRs that touch `.tsx`/`.jsx` | Runs `scripts/verify-component-props.js`; **fails the check** if a diff uses a variant/size value that doesn't match live `get_component_api` output |
| `endpoint-fields.yml` | PRs that touch `apps/refund-copilot/src/**`, `api.json`, the MCP `src/`, or the verifier | Runs `scripts/verify-endpoint-fields.js`; **fails the check** if the `Refund` type or an `api()` / `apiStream()` body uses a field or endpoint that isn't in the live `get_endpoint` contract |
| `token-drift.yml` | PRs that touch `tokens.json` | Reruns `generate-tokens.js`, fails if `index.css` is stale |
| `docs-drift.yml` | PRs that touch `packages/ui/src/**` | Rebuilds the MCP, reruns `generate-docs.js` + `generate-stories.js`, fails if `packages/ui/README.md` or `apps/ui-docs/stories/` is stale |
| `ci.yml` | Every push to `main` + every PR | Typechecks the MCP server and `refund-copilot` (UI, server and evals); runs `npm test` across all workspaces and the `scripts/` tests; runs both ESLint configs (including the server and eval TypeScript), the offline eval self-test (reading, Ask, Bulk, latency/cost budgets), the Playwright e2e tests (Chromium + axe, `AI_STUB=1`) and the docs reference check |
| `figma-tokens.yml` | Push to `main` touching `tokens.json` (or the publish script), and manual | Publishes `tokens.json` to Figma variables, code → Figma only; skips with a notice without the `FIGMA_TOKEN` / `FIGMA_FILE_KEY` secrets |
| `eval.yml` | Manual only (Run workflow) | Runs refund-copilot's `eval:extract` (reading, Ask, Bulk, latency and cost budgets) against the real model with the `ANTHROPIC_API_KEY` secret; never automatic, because every run costs money |

## PR review script

```bash
git diff main | ANTHROPIC_API_KEY=... node scripts/review-pr.js
```

The system prompt enforces project-specific rules: no hardcoded paths, no `console.log` in MCP src, loaders must be separate functions, `design-system.ts` and `loaders.ts` must stay in sync, no hardcoded hex colors.
