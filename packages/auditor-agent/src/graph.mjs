import { readFileSync, writeFileSync } from "node:fs";
import { Annotation, StateGraph, START, END, interrupt } from "@langchain/langgraph";
import { scanForHexLiterals } from "./scan.mjs";
import { resolveHexToToken } from "./mcp-client.mjs";

const AuditState = Annotation.Root({
  dir: Annotation(),
  queue: Annotation(),
  current: Annotation(),
  fixes: Annotation({
    reducer: (left, right) => left.concat(right),
    default: () => [],
  }),
});

// ── Nodes ──────────────────────────────────────────────────────────────────

function scan(state) {
  const queue = scanForHexLiterals(state.dir);
  return { queue };
}

function lookupToken(state) {
  const [current, ...rest] = state.queue;
  const { tokenName, raw } = resolveHexToToken(current.hex);
  return { queue: rest, current: { ...current, tokenName, mcpResponse: raw } };
}

// Pauses the graph and surfaces the proposed fix for a human to approve or
// reject. `interrupt()` throws internally on first pass (persisting state via
// the checkpointer) and returns the resume value once the caller re-invokes
// the graph with `new Command({ resume })`.
function approve(state) {
  const { file, line, hex, lineText, tokenName, mcpResponse } = state.current;
  // Resume value is always an object ({ approved }), never a bare boolean:
  // `new Command({ resume: false })` collides with LangGraph's "was a resume
  // value actually provided?" check, which treats a falsy resume as if none
  // was given at all and throws EmptyInputError. Wrapping it keeps "resume
  // with false" and "no resume" distinguishable.
  const decision = interrupt({
    file, line, hex, lineText, tokenName, mcpResponse,
    proposedReplacement: tokenName ? `rgb(var(--${tokenName.split(".").slice(1).join("-")}))` : null,
  });
  return { current: { ...state.current, approved: !!decision?.approved } };
}

function applyOrSkip(state) {
  const { file, hex, tokenName, approved } = state.current;

  if (!approved || !tokenName) {
    return { fixes: [{ file, hex, tokenName, applied: false }] };
  }

  const cssVar = `--${tokenName.split(".").slice(1).join("-")}`;
  const replacement = `rgb(var(${cssVar}))`;
  const src = readFileSync(file, "utf8");
  writeFileSync(file, src.split(hex).join(replacement), "utf8");

  return { fixes: [{ file, hex, tokenName, replacement, applied: true }] };
}

function report(state) {
  const applied = state.fixes.filter(f => f.applied).length;
  const skipped = state.fixes.length - applied;
  console.log(`\nDone. ${applied} fix(es) applied, ${skipped} skipped.`);
  for (const f of state.fixes) {
    console.log(
      f.applied
        ? `  ✓ ${f.file}: ${f.hex} → ${f.replacement}`
        : `  – ${f.file}: ${f.hex} left as-is${f.tokenName ? "" : " (no matching token found)"}`
    );
  }
  return {};
}

// ── Edges ──────────────────────────────────────────────────────────────────

function hasMoreToScan(state) {
  return state.queue.length > 0 ? "lookupToken" : "report";
}

function hasMoreAfterFix(state) {
  return state.queue.length > 0 ? "lookupToken" : "report";
}

export function buildGraph(checkpointer) {
  return new StateGraph(AuditState)
    .addNode("scan", scan)
    .addNode("lookupToken", lookupToken)
    .addNode("approve", approve)
    .addNode("applyOrSkip", applyOrSkip)
    .addNode("report", report)
    .addEdge(START, "scan")
    .addConditionalEdges("scan", hasMoreToScan, ["lookupToken", "report"])
    .addEdge("lookupToken", "approve")
    .addEdge("approve", "applyOrSkip")
    .addConditionalEdges("applyOrSkip", hasMoreAfterFix, ["lookupToken", "report"])
    .addEdge("report", END)
    .compile({ checkpointer });
}
