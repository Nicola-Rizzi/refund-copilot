// Minimal MCP client for the repo's build-time scripts: spawn the built server
// over stdio, send one tools/call, return the text of the first content block.
// Same shape scripts/verify-component-props.js / generate-*.js already use
// (those still carry their own copy; unify here when one of them next changes).
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const MCP_ENTRY = path.join(ROOT, "packages", "mcp-server", "dist", "index.js");

const DEFAULT_ENV = {
  SHARED_UI_PATH: path.join(ROOT, "packages", "ui", "src"),
  API_CONTRACT_PATH: path.join(ROOT, "apps", "refund-copilot", "api.json"),
  PROMPTS_PATH: path.join(ROOT, "prompts"),
};

export function callMcpTool(name, args = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [MCP_ENTRY], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, ...DEFAULT_ENV },
    });
    let out = "";
    let err = "";
    child.stdout.on("data", d => { out += d; });
    child.stderr.on("data", d => { err += d; });
    child.on("error", reject);
    child.on("close", code => {
      if (code !== 0 && !out.trim()) {
        return reject(new Error(err || `MCP process exited ${code}`));
      }
      try {
        const line = out.trim().split("\n").find(l => l.trim().startsWith("{"));
        const parsed = JSON.parse(line);
        if (parsed.error) return reject(new Error(parsed.error.message));
        resolve(parsed.result.content.map(c => c.text).join("\n"));
      } catch (e) {
        reject(new Error(`Could not parse MCP response for ${name}: ${e.message}\n${out}\n${err}`));
      }
    });
    child.stdin.write(
      JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }) + "\n"
    );
    child.stdin.end();
  });
}
