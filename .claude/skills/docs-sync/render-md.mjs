#!/usr/bin/env node
// Render a Markdown file to a self-contained HTML page for publishing as an artifact.
// Usage: node .claude/skills/docs-sync/render-md.mjs <in.md> <out.html> "<Title>"
// The Markdown is embedded as JSON and rendered client-side by marked (pinned, from cdnjs).
import { readFileSync, writeFileSync } from "node:fs";

const [, , input, output, title = "Document"] = process.argv;
if (!input || !output) {
  console.error("usage: render-md.mjs <in.md> <out.html> [title]");
  process.exit(1);
}

const md = readFileSync(input, "utf8");
const json = JSON.stringify(md).replace(/</g, "\\u003c");
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@400;500;600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
/* Layout: one reading column; code and diagrams break out wider and scroll on their own. */
:root {
  --bg: #f6f7f9; --surface: #ffffff; --ink: #1b2330; --muted: #5a6577;
  --rule: #dde2ea; --accent: #1f5fbf;
  --font-body: "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
  color-scheme: light;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    --bg: #11151c; --surface: #181e27; --ink: #e3e8f0; --muted: #98a3b5;
    --rule: #2a3340; --accent: #7fb0ff; color-scheme: dark;
  }
}
:root[data-theme="dark"] {
  --bg: #11151c; --surface: #181e27; --ink: #e3e8f0; --muted: #98a3b5;
  --rule: #2a3340; --accent: #7fb0ff; color-scheme: dark;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 16px/1.6 var(--font-body); }
main { max-width: 68rem; margin: 0 auto; padding: 2.5rem 1rem 4rem; }
#doc > :not(pre):not(table):not(.tw) { max-width: 46rem; }
h1, h2, h3 { line-height: 1.25; text-wrap: balance; font-weight: 600; }
h1 { font-size: 2rem; margin: 0 0 1rem; }
h2 { font-size: 1.4rem; margin: 2.75rem 0 .75rem; padding-top: 1rem; border-top: 1px solid var(--rule); }
h3 { font-size: 1.1rem; margin: 2rem 0 .5rem; }
a { color: var(--accent); }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
code { font-family: var(--font-mono); font-size: .88em; background: var(--surface); border: 1px solid var(--rule); border-radius: 4px; padding: .05em .3em; }
pre { background: var(--surface); border: 1px solid var(--rule); border-radius: 6px; padding: 1rem; overflow-x: auto; line-height: 1.4; }
pre code { border: 0; padding: 0; background: none; font-size: .82rem; }
.tw { overflow-x: auto; }
table { border-collapse: collapse; font-size: .92rem; }
th, td { border: 1px solid var(--rule); padding: .45rem .6rem; text-align: left; vertical-align: top; }
th { background: var(--surface); }
blockquote { margin: 1rem 0; padding: .25rem 1rem; border-left: 3px solid var(--accent); color: var(--muted); }
hr { border: 0; border-top: 1px solid var(--rule); margin: 2rem 0; }
.meta { color: var(--muted); font-size: .85rem; margin-bottom: 2rem; }
</style>
</head>
<body>
<main>
<p class="meta">Rendered from <code>${esc(input)}</code> on ${new Date().toISOString().slice(0, 10)}.</p>
<article id="doc"><pre id="fallback"></pre></article>
</main>
<script type="application/json" id="src">${json}</script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/marked/12.0.2/marked.min.js"></script>
<script>
const md = JSON.parse(document.getElementById("src").textContent);
const doc = document.getElementById("doc");
if (window.marked) {
  doc.innerHTML = marked.parse(md, { gfm: true });
  doc.querySelectorAll("table").forEach((t) => {
    const w = document.createElement("div"); w.className = "tw";
    t.replaceWith(w); w.appendChild(t);
  });
} else {
  document.getElementById("fallback").textContent = md;
}
</script>
</body>
</html>
`;
writeFileSync(output, html);
console.log(`wrote ${output} (${html.length} bytes)`);
