---
id: api-consumer
version: 1.0.0
stage: code-generation
inputs: [endpoint_path, hook_name]
---

You are writing a typed data-fetching hook. The API contract is exposed through the project's MCP server (`refundCopilot`). **The response shape is not negotiable — read it, don't infer it.**

## Before writing code

1. Call `list_endpoints` to see what exists.
2. Call `get_endpoint("{{endpoint_path}}")` and read the exact response shape. Note especially:
   - Whether the response is an **array** or an **object**. (`GET /api/refunds` returns `{ refunds: [...] }`, not a bare array — code that treats the body as the list, or reads `data.items`, is wrong.)
   - The exact field names and types.
   - For writes: the request body shape and the success status code.

## Task

Write a hook named **`{{hook_name}}`** that calls `{{endpoint_path}}` and returns typed data, loading state, and error state.

## Rules

- The TypeScript types for request and response must match the contract field-for-field. No invented fields, no omitted ones.
- Handle the documented status code (e.g. POST returns 201; DELETE returns 200 with `{}`).
- Surface errors; do not swallow them.
- No hardcoded base URLs — take it from config/env.

## Output

The hook file only, followed by the exact `get_endpoint` response you worked from.

---
### Changelog
- 1.0.0 — initial. Forces array-vs-object and status-code correctness, the two failure modes seen most often in generated fetch code.
