import { spawnSync } from "node:child_process";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "../../..");
const MCP = resolve(ROOT, "packages/mcp-server/dist/index.js");

const env = {
  ...process.env,
  SHARED_UI_PATH: resolve(ROOT, "packages/ui/src"),
  API_CONTRACT_PATH: resolve(ROOT, "apps/refund-copilot/api.json"),
};

// Same spawn-the-server-over-stdio pattern as scripts/generate-docs.js and
// scripts/generate-stories.js — the agent is just another MCP client, not a
// special case that needs its own protocol handling.
function callMcpTool(name, args = {}) {
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

/**
 * Parses find_token_for_value's text response into a token name, or null.
 *
 * An "Exact match" always resolves. A "Closest" line (which describeMatches puts
 * on line 2, hence the /m) resolves only when it's perceptually close — snapping
 * an unrelated colour onto a token would be a bug, not a fix, so a far-off
 * closest match is left for a human to judge from `raw`.
 */
const NEAR_MISS_MAX_DELTA_E = 0.05;

export function resolveHexToToken(hex) {
  const text = callMcpTool("find_token_for_value", { value: hex });

  const exact = text.match(/^Exact match:\s*([\w.]+)/m);
  if (exact) return { tokenName: exact[1], raw: text };

  const closest = text.match(/^Closest:\s*([\w.]+).*?ΔE ≈ ([\d.]+)/m);
  if (closest && Number(closest[2]) < NEAR_MISS_MAX_DELTA_E) {
    return { tokenName: closest[1], raw: text };
  }

  return { tokenName: null, raw: text };
}
