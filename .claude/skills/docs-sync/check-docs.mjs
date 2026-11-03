#!/usr/bin/env node
// Mechanical half of the docs-sync skill: every file path and `npm run <script>`
// a doc mentions must exist. Prints one line per miss; exit 1 if any.
// Usage (repo root): node .claude/skills/docs-sync/check-docs.mjs [doc.md ...]
// No args → every tracked *.md plus the local-only docs below, if present.
import { existsSync, readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import path from "node:path";

const git = (cmd) => execSync(`git ${cmd}`, { encoding: "utf8" }).trim().split("\n").filter(Boolean);
// Untracked-but-not-ignored files count: a doc written in the same change as a new file is fine.
const tracked = git("ls-files --cached --others --exclude-standard");
// Docs kept up to date locally but git-ignored: only READMEs go to the remote. Checked
// when present; a reference to one always resolves (in CI they don't exist).
const LOCAL_DOCS = ["ARCHITECTURE.md", "docs/production-notes.md", "docs/failure-analysis.md", "packages/ui/docs/dark-mode-adr.md",
  "INTERVIEW-PITCH.md", "packages/mcp-server/STORY.md"];
const extra = LOCAL_DOCS.filter(existsSync);
const basenames = new Set([...tracked, ...LOCAL_DOCS].map((f) => path.basename(f)));

const docs = process.argv.length > 2
  ? process.argv.slice(2)
  : [...tracked.filter((f) => f.endsWith(".md") && !f.includes("node_modules")), ...extra];

const scripts = new Set();
for (const p of tracked.filter((f) => f.endsWith("package.json"))) {
  for (const s of Object.keys(JSON.parse(readFileSync(p, "utf8")).scripts ?? {})) scripts.add(s);
}

const FILE_EXT = /\.(m?js|cjs|ts|tsx|jsx|json|ya?ml|md|css|sh|html)$/;
// Docs may describe files that are proposals, not code (an ADR's rejected option).
const KNOWN_NON_FILES = new Set(["tokens.light.json", "tokens.dark.json"]);

let misses = 0;
const miss = (doc, what) => { misses++; console.log(`${doc}: ${what}`); };

for (const doc of docs) {
  const txt = readFileSync(doc, "utf8");
  const refs = new Set();
  for (const m of txt.matchAll(/`([^`\s]+)`/g)) refs.add(m[1]);
  for (const m of txt.matchAll(/\]\(([^)\s]+)\)/g)) refs.add(m[1]);

  for (const raw of refs) {
    if (/^(https?:|mailto:|#|\/|~|@|\.\.\.)|[*<>{}$()|]/.test(raw)) continue; // URLs, routes, globs, calls
    const ref = raw.replace(/#.*$/, "").replace(/:\d+(-\d+)?$/, "").replace(/[:,.]$/, "");
    if (!FILE_EXT.test(ref) || /^\.[a-z]+$/.test(ref)) continue;            // not a file, or a bare extension
    if (KNOWN_NON_FILES.has(path.basename(ref))) continue;
    if (/^(dist|build)\//.test(ref)) continue;                                  // build output, not tracked
    const candidates = [ref, path.join(path.dirname(doc), ref)];
    if (candidates.some(existsSync)) continue;
    if (candidates.some((c) => LOCAL_DOCS.includes(path.normalize(c)))) continue; // a local-only doc
    if (!ref.includes("/") && basenames.has(ref)) continue;                 // bare filename that exists somewhere
    if (ref.includes("/") && tracked.some((f) => f.endsWith("/" + ref))) continue; // path relative to a package
    miss(doc, `missing file: ${raw}`);
  }

  for (const m of txt.matchAll(/npm run ([a-z][\w:-]*)/g)) {
    if (!scripts.has(m[1])) miss(doc, `missing npm script: ${m[1]}`);
  }
}

if (misses) { console.log(`\n${misses} stale reference(s).`); process.exit(1); }
console.log(`OK — ${docs.length} docs, every path and npm script resolves.`);
