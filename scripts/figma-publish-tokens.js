#!/usr/bin/env node
// Usage (repo root):
//   FIGMA_TOKEN=... FIGMA_FILE_KEY=... node scripts/figma-publish-tokens.js            # dry run: print the plan
//   FIGMA_TOKEN=... FIGMA_FILE_KEY=... node scripts/figma-publish-tokens.js --publish  # write it to Figma
//   node scripts/figma-publish-tokens.js --from <variables.json>                       # plan against a saved response, offline
//   add --prune to delete variables the code no longer has
//
// Code → Figma, one way: tokens.json is the source of truth (logic and rules in
// scripts/lib/figma-tokens.mjs). The token needs the file_variables:read and
// file_variables:write scopes; Figma offers the Variables API to full members of
// Enterprise orgs only. Runs in CI from figma-tokens.yml after tokens.json changes on main.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { planPublish, COLLECTION_NAME } from "./lib/figma-tokens.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOKENS = path.join(ROOT, "packages", "ui", "src", "tokens.json");
const API = "https://api.figma.com/v1";

const args = process.argv.slice(2);
const publish = args.includes("--publish");
const prune = args.includes("--prune");
const fromIdx = args.indexOf("--from");
const from = fromIdx >= 0 ? args[fromIdx + 1] : null;

async function figma(method, url, body) {
  const res = await fetch(`${API}${url}`, {
    method,
    headers: { "X-Figma-Token": process.env.FIGMA_TOKEN, ...(body ? { "Content-Type": "application/json" } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.error) throw new Error(`Figma ${method} ${url} → ${res.status}: ${data.message ?? JSON.stringify(data).slice(0, 300)}`);
  return data;
}

async function main() {
  const tokens = JSON.parse(readFileSync(TOKENS, "utf8"));
  const fileKey = process.env.FIGMA_FILE_KEY;
  if (!from && (!process.env.FIGMA_TOKEN || !fileKey)) {
    console.error("Set FIGMA_TOKEN and FIGMA_FILE_KEY, or pass --from <saved variables response> for an offline plan.");
    process.exit(2);
  }

  const meta = from ? JSON.parse(readFileSync(from, "utf8")).meta : (await figma("GET", `/files/${fileKey}/variables/local`)).meta;
  const { body, summary, changes } = planPublish(tokens, meta, { prune });

  const list = (label, xs) => xs.length && console.log(`${label} (${xs.length}): ${xs.join(", ")}`);
  console.log(`Collection "${COLLECTION_NAME}": ${tokens.length} tokens in tokens.json.`);
  list("Create", summary.created);
  list("Update", summary.updated);
  list("Delete", summary.deleted);
  list("In Figma but not in the code (use --prune to delete)", summary.orphans);
  list("Skipped", summary.skipped);
  console.log(`Unchanged: ${summary.unchanged.length}.`);

  if (changes === 0) return console.log("Figma already matches tokens.json.");
  if (!publish || from) return console.log(`\nDry run: ${changes} change(s) not sent. Add --publish to write them.`);
  await figma("POST", `/files/${fileKey}/variables`, body);
  console.log(`\nPublished ${changes} change(s) to Figma.`);
}

main().catch((err) => { console.error(err.message); process.exit(1); });
