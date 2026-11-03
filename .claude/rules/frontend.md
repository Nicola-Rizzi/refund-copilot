---
paths:
  - "packages/ui/src/**"
  - "apps/refund-copilot/src/**"
  - "apps/ui-docs/**"
---

# Frontend rules

- Call `get_component_api` live before using a component's `variant`/`size`, and `get_token` / `find_token_for_value` before writing a color. Don't rely on memory, even from earlier in the session.
- Colors only as `rgb(var(--<token>))`. No hex literals, even in `cn()`/`clsx()`.
- Before an `api()` / `apiStream()` call or a change to `src/types.ts`, call `get_endpoint(path, method)`. Responses are wrapped (`{ refunds: [...] }`), and the refund fields are `amount`, `status`, `approveBlocker`.
- `index.css` and `apps/ui-docs/stories/*.stories.tsx` (except `DesignTokens.stories.tsx`) are generated: edit `tokens.json` or the component, then regenerate.
- The UI never enforces a business rule on its own. It shows what the server returns (`approveBlocker`, checks); the server decides.
- New component → follow the `add-ui-component` skill.
