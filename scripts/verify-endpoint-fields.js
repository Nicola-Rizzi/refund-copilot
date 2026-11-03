#!/usr/bin/env node
// Usage: node scripts/verify-endpoint-fields.js
//
// Deterministic backstop for CLAUDE.md Rule 2 ("call get_endpoint before writing
// any API call"). The Rule 1 analogue is verify-component-props.js. Two checks,
// both a straight comparison against the live MCP contract — no LLM judgment, so
// it's safe to let this fail CI:
//
//   A. apps/refund-copilot/src/types.ts `Refund` matches the GET /api/refunds
//      response (every required contract field is on the type; every type field
//      is in the contract).
//   B. every api(...) / apiStream(...) call in apps/refund-copilot/src targets a
//      method + path the contract has, and an object-literal body sends only keys
//      that endpoint's contract lists.
//
// It re-derives everything on every run (one type, a handful of calls), like the
// parser eval and the token-drift check.

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { callMcpTool } from "./lib/mcp.mjs";
import { parseInterface, contractFieldsFromText, parseApiCalls, pathMatches, checkType } from "./lib/endpoint-fields.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP_SRC = path.join(ROOT, "apps", "refund-copilot", "src");
const TYPES_FILE = path.join(APP_SRC, "types.ts");

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.(test|spec)\./.test(entry) && full !== path.join(APP_SRC, "api.ts")) out.push(full);
  }
  return out;
}

async function contractFor(endpointPath, method) {
  const text = await callMcpTool("get_endpoint", { path: endpointPath, method });
  return contractFieldsFromText(text);
}

async function main() {
  const violations = [];

  // ── Check A: the Refund type vs GET /api/refunds ──────────────────────────
  const refundFields = parseInterface(readFileSync(TYPES_FILE, "utf8"), "Refund");
  if (refundFields.size === 0) {
    violations.push(`Could not find an \`interface Refund\` in ${path.relative(ROOT, TYPES_FILE)}.`);
  } else {
    const { responseFields } = await contractFor("/api/refunds", "GET");
    const { missingFromType, notInContract } = checkType(refundFields, responseFields);
    for (const f of missingFromType) {
      violations.push(`types.ts: \`Refund\` is missing "${f}" — it's in the GET /api/refunds contract. Add it, or the type lies about the API.`);
    }
    for (const f of notInContract) {
      violations.push(`types.ts: \`Refund.${f}\` is not in the GET /api/refunds contract. Remove it, fix the name, or add it to apps/refund-copilot/api.json.`);
    }
  }

  // ── Check B: every API call vs the contract ───────────────────────────────
  const listing = await callMcpTool("list_endpoints", {});
  const endpoints = [];
  for (const line of listing.split("\n")) {
    const lm = line.match(/^([A-Z]+)\s+(\S+)/);
    if (lm) endpoints.push({ method: lm[1], path: lm[2] });
  }

  const contractCache = new Map();
  for (const file of walk(APP_SRC)) {
    const where = (call) => `${path.relative(ROOT, file)}:${call.line}`;
    for (const call of parseApiCalls(readFileSync(file, "utf8"))) {
      const samePath = endpoints.filter((e) => pathMatches(call.path, e.path));
      const matches = samePath.filter((e) => e.method === call.method);
      if (matches.length === 0) {
        violations.push(`${where(call)}: no ${call.method} ${call.path} in the contract` +
          (samePath.length ? ` (that path serves: ${[...new Set(samePath.map((e) => e.method))].join(", ")}).` : "."));
        continue;
      }
      if (!call.keys) continue; // body is a variable: typed by TS, not checkable here
      const allowed = new Set();
      for (const e of matches) {
        const key = `${e.method} ${e.path}`;
        if (!contractCache.has(key)) contractCache.set(key, await contractFor(e.path, e.method));
        for (const f of contractCache.get(key).bodyFields) allowed.add(f);
      }
      for (const k of call.keys) {
        if (!allowed.has(k)) {
          violations.push(`${where(call)}: ${call.method} ${call.path} body sends "${k}", which isn't in the contract body (${[...allowed].join(", ") || "no body"}).`);
        }
      }
    }
  }

  if (violations.length === 0) {
    console.log("No issues found — the Refund type and every API call match the live endpoint contracts.");
    return;
  }
  console.log(`${violations.length} endpoint-contract violation(s):\n`);
  for (const v of violations) console.log(`  ✗ ${v}`);
  process.exitCode = 1;
}

main().catch(err => {
  console.error("verify-endpoint-fields error:", err.message);
  process.exit(1);
});
