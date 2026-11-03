#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createMcpServer } from "./server.js";

/**
 * stdio entry point — the client spawns this as a subprocess and talks over stdin/stdout.
 * Used by Claude Code / Cursor / Windsurf when configured with command + args.
 *
 * IMPORTANT: never write to stdout here (no console.log). stdout is the JSON-RPC channel;
 * any stray write corrupts the stream. Diagnostics go to stderr only.
 */
async function main() {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("refund-copilot-mcp running on stdio");
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
