---
paths:
  - "packages/mcp-server/**"
---

# MCP server rules

- Tools, prompts and the resource are registered only in `createMcpServer()` (`src/server.ts`). `index.ts` (stdio) and `http.ts` (HTTP) are transports.
- No in-memory state, no file caching, no outbound HTTP. Every call re-reads the source files; that is the point.
- File access goes through a loader in `src/loaders.ts` that takes its path from an env var. Keep `design-system.ts` and `loaders.ts` in sync.
- No `console.log` in `src/`: stdout is the stdio transport. Log to stderr.
- After a `src/` change: `npm run build`, then `npm test`. After a `loaders.ts` change: also `npm run eval`.
- New tool → follow the `add-mcp-tool` skill.
