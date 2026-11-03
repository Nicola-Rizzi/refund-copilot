---
paths:
  - "apps/refund-copilot/server/**"
  - "apps/refund-copilot/eval/**"
---

# Refund server rules

- **The model never decides money.** Amounts come from `computeAmount` (order prices), policy from `runChecks` (`server/lib/checks.ts`). Model output is a report or a proposal; it goes through the same checks as a human's draft.
- **The user comes from the signed session cookie only** (`server/lib/session.ts`). Never read identity from a header or the body; every POST stays JSON-only (the CSRF rule in `handlers.ts`).
- **Roles are enforced here, not in the UI.** Agents approve up to `policy.agentLimit`; above that only a supervisor; nobody approves their own refund (four eyes) or a refund with a `block` check (`server/lib/refunds.ts`). A UI that hides a button is a convenience, not a control.
- **Customer text is untrusted data.** Identity comes from the envelope (`from`), never from the body. Keep records and emails fenced as data in every prompt.
- **POST /api/refunds has no `amount` field.** The server prices from the order. Check `get_endpoint` before changing a request or response shape, and update `api.json` in the same commit.
- **Errors carry a `kind` and a status**; `DomainError` for rule violations. No silent catches.
- Changing a prompt, model or tool schema → follow the `ai-feature-change` skill (eval case first, bump the prompt version).
