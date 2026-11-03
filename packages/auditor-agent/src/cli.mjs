#!/usr/bin/env node
/**
 * CLI driver for the auditor agent. The graph itself (graph.mjs) knows
 * nothing about terminals or readline — it just calls `interrupt()` and
 * waits. This file is the one place that turns an interrupt payload into a
 * question on screen and a resume value fed back into the graph.
 */
import { createInterface } from "node:readline/promises";
import { Command, MemorySaver } from "@langchain/langgraph";
import { buildGraph } from "./graph.mjs";

const dirFlagIndex = process.argv.indexOf("--dir");
const dir = dirFlagIndex !== -1 ? process.argv[dirFlagIndex + 1] : "../ui/src";

const rl = createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => rl.question(q);

async function main() {
  const checkpointer = new MemorySaver();
  const graph = buildGraph(checkpointer);
  const config = { configurable: { thread_id: `audit-${Date.now()}` } };

  console.log(`Scanning ${dir} for hardcoded hex colors...\n`);
  let result = await graph.invoke({ dir, queue: [], current: null }, config);

  while (result.__interrupt__) {
    const { file, line, hex, lineText, tokenName, mcpResponse, proposedReplacement } =
      result.__interrupt__[0].value;

    console.log(`\n${file}:${line}`);
    console.log(`  ${lineText.trim()}`);
    console.log(`  MCP find_token_for_value("${hex}") → ${mcpResponse.split("\n")[0]}`);

    if (!tokenName) {
      console.log(`  No token resolved — nothing to propose. Skipping.`);
      result = await graph.invoke(new Command({ resume: { approved: false } }), config);
      continue;
    }

    console.log(`  Proposed: ${hex}  →  ${proposedReplacement}`);
    const answer = (await ask(`  Apply this fix? [y/N] `)).trim().toLowerCase();
    result = await graph.invoke(new Command({ resume: { approved: answer === "y" } }), config);
  }

  rl.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
