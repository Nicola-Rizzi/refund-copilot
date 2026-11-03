#!/usr/bin/env node
// Usage: git diff origin/main...HEAD | node scripts/verify-component-props.js
//
// Deterministic backstop for CLAUDE.md Rule 1 ("call get_component_api before
// writing any JSX that uses a component"). Unlike review-pr.js, this doesn't
// ask an LLM to judge the diff — it's a plain string comparison between the
// literal variant/size values used in the diff and the live output of
// get_component_api. No judgment call, so it's safe to let this fail CI.

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MCP_ENTRY = path.join(__dirname, "..", "packages", "mcp-server", "dist", "index.js");

function callMcpTool(name, args) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [MCP_ENTRY], { stdio: ["pipe", "pipe", "pipe"] });
    let out = "";
    let err = "";
    child.stdout.on("data", d => { out += d; });
    child.stderr.on("data", d => { err += d; });
    child.on("close", code => {
      if (code !== 0 && !out.trim()) return reject(new Error(err || `MCP process exited ${code}`));
      try {
        const line = out.trim().split("\n").find(l => l.trim().startsWith("{"));
        const parsed = JSON.parse(line);
        if (parsed.error) return reject(new Error(parsed.error.message));
        resolve(parsed.result.content[0].text);
      } catch (e) {
        reject(new Error(`Could not parse MCP response for ${name}: ${e.message}\n${out}\n${err}`));
      }
    });
    child.stdin.write(JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args },
    }) + "\n");
    child.stdin.end();
  });
}

// Reconstructs, per hunk, the new-file text (context + added lines, '-' lines
// dropped) so a multi-line JSX tag can still be matched with one regex, plus
// which of those reconstructed lines were actually added — only usages that
// touch an added line get checked, so untouched pre-existing JSX never flags.
function splitFileHunks(diff) {
  const files = [];
  let currentFile = null;
  let currentHunk = null;

  const flushHunk = () => {
    if (currentHunk && currentFile) files.push({ file: currentFile, ...currentHunk });
    currentHunk = null;
  };

  for (const line of diff.split("\n")) {
    if (line.startsWith("+++ ")) {
      flushHunk();
      const p = line.slice(4).trim();
      currentFile = p === "/dev/null" ? null : p.replace(/^b\//, "");
      continue;
    }
    if (line.startsWith("@@ ")) {
      flushHunk();
      currentHunk = { lines: [], addedIdx: new Set() };
      continue;
    }
    if (!currentHunk) continue;
    if (line.startsWith("+")) {
      currentHunk.addedIdx.add(currentHunk.lines.length);
      currentHunk.lines.push(line.slice(1));
    } else if (line.startsWith("-")) {
      // removed line — contributes nothing to the new file's text
    } else if (line.startsWith(" ") || line === "") {
      currentHunk.lines.push(line.slice(1));
    }
  }
  flushHunk();

  return files
    .filter(f => f.file && /\.(tsx|jsx)$/.test(f.file))
    .map(f => ({ file: f.file, text: f.lines.join("\n"), addedIdx: f.addedIdx }));
}

const TAG_RE = /<([A-Z]\w*)((?:\s+[\w-]+(?:="[^"]*"|={[^}]*})?)*)\s*\/?>/gs;
const ATTR_RE = /([\w-]+)="([^"]*)"/g;

function findTagUsages(hunk, knownComponents) {
  const usages = [];
  let m;
  TAG_RE.lastIndex = 0;
  while ((m = TAG_RE.exec(hunk.text))) {
    const [full, tagName, attrText] = m;
    if (!knownComponents.has(tagName)) continue;

    const startLine = hunk.text.slice(0, m.index).split("\n").length - 1;
    const spanLines = full.split("\n").length;
    let touchesAdded = false;
    for (let i = startLine; i < startLine + spanLines; i++) {
      if (hunk.addedIdx.has(i)) { touchesAdded = true; break; }
    }
    if (!touchesAdded) continue;

    const props = {};
    let am;
    ATTR_RE.lastIndex = 0;
    while ((am = ATTR_RE.exec(attrText))) props[am[1]] = am[2];
    usages.push({ tagName, props });
  }
  return usages;
}

function parseApiText(text) {
  const props = {};
  for (const line of text.split("\n")) {
    const m = line.match(/^\s*-\s*([\w-]+):\s*(.+?)\s*\((required|optional).*\)\s*$/);
    if (!m) continue;
    const [, propName, typeText] = m;
    const literals = [...typeText.matchAll(/'([^']*)'/g)].map(x => x[1]);
    props[propName] = literals.length ? literals : null; // null = not a string-literal union, don't value-check
  }
  return props;
}

async function main() {
  const diff = await new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", c => { data += c; });
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });

  if (!diff.trim()) {
    console.log("No diff provided — pipe a git diff to stdin.");
    process.exit(0);
  }

  const componentList = await callMcpTool("list_components", {});
  const knownComponents = new Set(
    componentList.split("\n").map(l => l.match(/^(\w+)/)?.[1]).filter(Boolean)
  );

  const hunks = splitFileHunks(diff);
  const apiCache = new Map();
  const violations = [];

  for (const hunk of hunks) {
    for (const { tagName, props } of findTagUsages(hunk, knownComponents)) {
      if (!apiCache.has(tagName)) {
        apiCache.set(tagName, parseApiText(await callMcpTool("get_component_api", { name: tagName })));
      }
      const api = apiCache.get(tagName);
      for (const [propName, value] of Object.entries(props)) {
        if (!(propName in api)) continue; // not a documented prop (e.g. a DOM passthrough) — nothing to check
        const allowed = api[propName];
        if (allowed && !allowed.includes(value)) {
          violations.push({ file: hunk.file, component: tagName, prop: propName, value, allowed });
        }
      }
    }
  }

  if (violations.length === 0) {
    console.log("No issues found — every variant/size prop matches the live component API.");
    return;
  }

  console.log(`${violations.length} prop value(s) don't match the live component API:\n`);
  for (const v of violations) {
    console.log(`  ${v.file} — <${v.component} ${v.prop}="${v.value}" /> — "${v.value}" is not valid.`);
    console.log(`    Allowed: ${v.allowed.map(a => `"${a}"`).join(" | ")}\n`);
  }
  process.exitCode = 1;
}

main().catch(err => {
  console.error("verify-component-props error:", err.message);
  process.exit(1);
});
