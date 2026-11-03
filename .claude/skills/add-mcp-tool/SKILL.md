---
name: add-mcp-tool
description: Add or change a tool, prompt or resource on the refund-copilot MCP server (packages/mcp-server) end to end — interface, loader, registration, e2e test, docs. Use when the user asks for a new MCP tool or a change to what an existing one returns.
---

# add-mcp-tool — a new MCP tool, end to end

The server reads the source files on every call: no cache, no in-memory state, no outbound HTTP. Keep it that way.

## Step 1 — Data interface

Add the shape to `packages/mcp-server/src/design-system.ts`. `design-system.ts` and `loaders.ts` must stay in sync: a field added to one is added to the other.

## Step 2 — Loader

Add a `load…()` function to `packages/mcp-server/src/loaders.ts` that reads its path from an env var with a root-cwd default (like `SHARED_UI_PATH`, `API_CONTRACT_PATH`, `PROMPTS_PATH`). Never call `readFileSync` inside a `server.tool()` handler. If the new source needs an env var, add it to `.mcp.json` too.

## Step 3 — Register

Register it in `createMcpServer()` in `packages/mcp-server/src/server.ts`, never in `index.ts` or `http.ts` (those are transports). Give every argument a zod `.describe()`. An unknown id returns `isError: true` with a message that names it. `list_*` tools paginate with `limit` / `offset` like the existing ones.

## Step 4 — Test

Add a case to `packages/mcp-server/test/e2e.test.mjs`. It drives the server through the real MCP SDK client, so it covers registration as well as output.

```bash
cd packages/mcp-server
npm test              # build + node --test
npm run eval          # only if loaders.ts changed: parser fidelity
```

## Step 5 — Docs (same commit)

The tool list is a claim in several docs: the MCP table in `CLAUDE.md` and `ARCHITECTURE.md` (the root `README.md` shows one example and no count). Update every one, then run the `docs-sync` skill. It republishes `ARCHITECTURE.md` if it changed.
