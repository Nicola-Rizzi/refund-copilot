---
name: ai-feature-change
description: Change one of refund-copilot's AI features (reading a request, Ask, Bulk) — its prompt, model, tool schema or the code around the model call — without letting the model start deciding money. Use whenever you touch apps/refund-copilot/server/lib/readRequest.ts, askShop.ts, planRefunds.ts, retrieve.ts, the eval, or packages/ai-runtime.
---

# ai-feature-change — change an AI feature, eval first

The product rule is **the model reads and proposes; code decides; people approve**. Every AI change is checked against it, and against the eval, before it's done.

## Step 1 — Write the failing case first

Add the behaviour you want as a case before changing the prompt:

| Feature | Core | Cases |
|---|---|---|
| Reading a request | `apps/refund-copilot/server/lib/readRequest.ts` | `CASES` in `apps/refund-copilot/eval/cases.ts` (`ReadingCase`) |
| Ask | `askShop.ts` + `retrieve.ts` | `ASK_CASES` in `apps/refund-copilot/eval/assistant.ts` (`retrieves`, `cites`, `abstain`) |
| Bulk refunds | `planRefunds.ts` | `PLAN_CASES` in `apps/refund-copilot/eval/assistant.ts` (`proposed`, `blocked`) |

Grade with deterministic fields (`orderId`, `skus`, `amount`, `blocks`, `neverAmount`, citations) wherever there's one right answer. Use an LLM judge only when there isn't one.

## Step 2 — Make the change, inside the boundary

- **Money stays in code.** The model may report an order id, items and a reason. It never produces an amount, a policy verdict or an approval. Prices come from `computeAmount` and `runChecks` in `server/lib/checks.ts`; roles come from `server/lib/refunds.ts`.
- **Customer text is data.** It stays fenced as untrusted input; the identity comes from the mail envelope, not the body.
- **One SDK seam.** Only `packages/ai-runtime` imports `@anthropic-ai/sdk`. Cores take `complete` / `stream` as parameters, so tests stub them.
- **Tool schemas are Zod** (`ReportSchema` in `readRequest.ts`, the plan schemas in `planRefunds.ts`, via `server/lib/toolSchema.ts`): the same object is the JSON Schema the model gets and the check on its answer. Change the schema, never a hand-written copy; `toolSchema.test.ts` pins what the model is told.
- **Bump the prompt version** (`READ_PROMPT_VERSION`, `ASK_PROMPT_VERSION`, `PLAN_PROMPT_VERSION`) whenever the prompt or the tool schema changes. Usage logs are keyed by it.
- A model change goes through the env override (`READ_MODEL`, `ASK_MODEL`, `PLAN_MODEL`), with the default updated in the same file.

## Step 3 — Verify offline (free, always)

```bash
cd apps/refund-copilot
npx vitest run                     # unit + API + UI flow, stubbed model
npm run eval:extract:selftest      # proves every eval still fails on a misled model
npx tsc -b --noEmit && npm run lint
```

If you added a new grader, add a self-test scenario to `eval/extract.selftest.ts` showing it fails on a bad output. An eval that can't fail proves nothing.

## Step 4 — The real model (costs money: ask first)

```bash
ANTHROPIC_API_KEY=... npm run eval:extract --workspace apps/refund-copilot
```

Run it only with the user's go-ahead. Hard fails (an asked amount reaching the price, a Bulk proposal nobody asked for) block the change whatever the pass rate. Check p95 latency and $/call against the budgets in `eval/performance.ts`.

## Step 5 — Write it down

- A bug the eval or the self-test caught → a new entry in `docs/failure-analysis.md` (*What broke / The fix / The lesson*).
- A new model, limit, budget or prompt version quoted in the docs → run the `docs-sync` skill.
