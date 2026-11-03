#!/usr/bin/env node
/**
 * generate-docs.js
 *
 * Generates packages/ui/README.md by querying the refund-copilot-mcp server live.
 * Tokens and component API tables come from the same source an agent uses
 * to write code — so docs and implementation can't drift.
 *
 * Usage:
 *   node scripts/generate-docs.js
 *
 * Requires: the MCP server dist to be built (npm run build in packages/mcp-server)
 */

import { spawnSync } from "child_process";
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const MCP  = resolve(ROOT, "packages/mcp-server/dist/index.js");
const OUT  = resolve(ROOT, "packages/ui/README.md");

const env = {
  ...process.env,
  SHARED_UI_PATH:    resolve(ROOT, "packages/ui/src"),
  API_CONTRACT_PATH: resolve(ROOT, "apps/refund-copilot/api.json"),
};

function callTool(name, args = {}) {
  const payload = JSON.stringify({
    jsonrpc: "2.0", id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  });
  const result = spawnSync("node", [MCP], { input: payload + "\n", env, encoding: "utf8" });
  if (result.error) throw result.error;
  try {
    const parsed = JSON.parse(result.stdout);
    return parsed.result?.content?.[0]?.text ?? "";
  } catch {
    throw new Error(`Failed to parse MCP response for "${name}": ${result.stdout.slice(0, 200)}`);
  }
}

function table(headers, rows) {
  const widths = headers.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i] ?? "").length)));
  const pad = (s, w) => String(s).padEnd(w);
  const line = (row) => "| " + row.map((c, i) => pad(c, widths[i])).join(" | ") + " |";
  return [line(headers), "| " + widths.map((w) => "-".repeat(w)).join(" | ") + " |", ...rows.map(line)].join("\n");
}

function main() {
  process.stdout.write("Querying MCP tools...\n");

  // ── Tokens ──────────────────────────────────────────────────────────────────
  const categories = ["color", "spacing", "typography", "radius", "shadow"];
  const tokenSections = categories.map((cat) => {
      const text = callTool("list_tokens", { category: cat });
      const rows = text.split("\n").filter(Boolean).map((line) => {
        const m = line.match(/^(.+?)\s*=\s*(.+?)\s+\([^)]+\)\s*—\s*(.*)$/);
        return m ? [m[1].trim(), m[2].trim(), m[3].trim()] : null;
      }).filter(Boolean);
      return `### ${cat.charAt(0).toUpperCase() + cat.slice(1)}\n\n` +
        table(["Token", "Value", "Description"], rows);
    });

  // ── Components ──────────────────────────────────────────────────────────────
  const componentListText = callTool("list_components");
  const componentNames = componentListText.split("\n").filter(Boolean).map((l) => l.split(" ")[0]);

  const componentSections = componentNames.map((name) => {
      const text = callTool("get_component_api", { name });
      const lines = text.split("\n");
      const importLine = lines.find((l) => l.startsWith("import")) ?? "";
      const propLines = lines.filter((l) => l.trim().startsWith("- "));
      const example = lines.slice(lines.indexOf("Example:") + 1).join("\n").trim();

      const propRows = propLines.map((l) => {
        const m = l.match(/- (\w+):\s*(.+?)\s*\(([^)]+)\)/);
        return m ? [m[1], m[2], m[3]] : null;
      }).filter(Boolean);

      return `### ${name.charAt(0).toUpperCase() + name.slice(1)}\n\n` +
        "```tsx\n" + importLine + "\n```\n\n" +
        (propRows.length ? table(["Prop", "Type", "Notes"], propRows) + "\n\n" : "") +
        (example ? "**Example:**\n```tsx\n" + example + "\n```" : "");
    });

  // ── Write README ─────────────────────────────────────────────────────────────
  const readme = `# @refund-copilot/ui

A React component library built on Tailwind CSS + shadcn patterns with a custom brand token set.

> **Note:** This README is generated automatically from the live MCP tool output.
> Run \`node scripts/generate-docs.js\` from the monorepo root to regenerate.

## Installation

\`\`\`bash
npm install @refund-copilot/ui
\`\`\`

Add to \`vite.config.ts\`:
\`\`\`ts
resolve: { alias: { "@refund-copilot/ui": resolve(__dirname, "../../packages/ui/src/components/ui") } }
\`\`\`

Add to \`tsconfig.json\`:
\`\`\`json
"paths": { "@refund-copilot/ui/*": ["../../packages/ui/src/components/ui/*"] }
\`\`\`

## Design Tokens

${tokenSections.join("\n\n")}

## Components

${componentSections.join("\n\n---\n\n")}
`;

  writeFileSync(OUT, readme, "utf8");
  process.stdout.write(`README written to ${OUT}\n`);
}

try {
  main();
} catch (err) {
  console.error(err.message);
  process.exit(1);
}
