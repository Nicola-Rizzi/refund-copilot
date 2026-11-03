/**
 * End-to-end tests for the MCP server, using the official SDK *client* — the
 * same machinery Claude Code / Cursor use to talk to this server.
 *
 * Two levels, deliberately:
 *
 *   1. IN-MEMORY — client and server joined by a linked transport pair in the
 *      same process. Fast, no subprocess, tests everything from the JSON-RPC
 *      handshake down to the tool handlers and loaders. This is the level that
 *      runs on every change.
 *
 *   2. STDIO — the client spawns `node dist/index.js` as a real subprocess and
 *      talks over stdin/stdout, exactly as a real MCP client would. This is the
 *      only test that can catch transport-level regressions (e.g. a stray
 *      console.log corrupting the JSON-RPC stream). Requires `npm run build` first.
 *
 * Run: npm test   (from packages/mcp-server)
 */
import { test, before } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");

// The loaders read these at import time; point them at the real source files
// with absolute paths so the tests pass regardless of CWD.
process.env.SHARED_UI_PATH = resolve(REPO_ROOT, "packages/ui/src");
process.env.API_CONTRACT_PATH = resolve(REPO_ROOT, "apps/refund-copilot/api.json");
process.env.PROMPTS_PATH = resolve(REPO_ROOT, "prompts");

/** Connect an SDK client to a fresh server instance over an in-memory pair. */
async function connectInMemory() {
  // Import lazily so the env vars above are set before the loaders module runs.
  const { createMcpServer } = await import("../dist/server.js");
  const server = createMcpServer();
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "e2e-test", version: "0.0.0" });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return { client, server };
}

const text = (result) => result.content?.map((c) => c.text).join("\n") ?? "";

// ─── 1. In-memory: handshake + full tool surface ──────────────────────────────

test("handshake exposes all seven tools", async () => {
  const { client } = await connectInMemory();
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  assert.deepEqual(names, [
    "find_token_for_value",
    "get_component_api",
    "get_endpoint",
    "get_token",
    "list_components",
    "list_endpoints",
    "list_tokens",
  ]);
  // Every tool must carry a description — the model routes on these.
  for (const t of tools) assert.ok(t.description?.length > 10, `${t.name} has no description`);
});

test("get_component_api returns the real Button variants", async () => {
  const { client } = await connectInMemory();
  const result = await client.callTool({ name: "get_component_api", arguments: { name: "Button" } });
  const out = text(result);
  assert.ok(!result.isError, out);
  // The proof-point from the README: 'destructive' is real, 'danger' is not.
  assert.match(out, /destructive/);
  assert.doesNotMatch(out, /\bdanger\b/);
  assert.match(out, /import \{ Button \}/);
});

test("get_token returns a value for a real token", async () => {
  const { client } = await connectInMemory();
  const list = await client.callTool({ name: "list_tokens", arguments: { category: "color" } });
  const firstName = text(list).split("\n")[0]?.split(" = ")[0];
  assert.ok(firstName, "list_tokens returned no color tokens");

  const result = await client.callTool({ name: "get_token", arguments: { name: firstName } });
  assert.ok(!result.isError);
  assert.match(text(result), new RegExp(`^${firstName.replace(/\./g, "\\.")} = `));
});

test("unknown token → in-band isError with suggestions, not a protocol error", async () => {
  const { client } = await connectInMemory();
  // Must NOT throw: errors the model should react to are tool results, not JSON-RPC errors.
  const result = await client.callTool({ name: "get_token", arguments: { name: "color.nope" } });
  assert.equal(result.isError, true);
  assert.match(text(result), /not found/i);
  assert.match(text(result), /Did you mean/i); // recovery hint for the model
});

test("list_endpoints → get_endpoint round-trip", async () => {
  const { client } = await connectInMemory();
  const list = await client.callTool({ name: "list_endpoints", arguments: {} });
  const firstPath = text(list).split("\n")[0]?.split(" ")[1];
  assert.ok(firstPath?.startsWith("/"), `unexpected list output: ${text(list)}`);

  const result = await client.callTool({ name: "get_endpoint", arguments: { path: firstPath } });
  assert.ok(!result.isError);
  assert.match(text(result), /Response:/);
});

test("get_endpoint disambiguates a path served by several methods", async () => {
  const { client } = await connectInMemory();

  // No method on a shared path → first match, plus a note listing the others.
  const ambiguous = await client.callTool({ name: "get_endpoint", arguments: { path: "/api/refunds" } });
  assert.ok(!ambiguous.isError);
  assert.match(text(ambiguous), /served by GET, POST/);

  // method → the exact contract, including the POST body (unreachable before).
  const post = await client.callTool({
    name: "get_endpoint",
    arguments: { path: "/api/refunds", method: "POST" },
  });
  assert.ok(!post.isError);
  assert.match(text(post), /^POST \/api\/refunds/);
  assert.match(text(post), /Request body:/);

  // A method the path doesn't serve → in-band error, not a throw.
  const missing = await client.callTool({
    name: "get_endpoint",
    arguments: { path: "/api/refunds", method: "PUT" },
  });
  assert.ok(missing.isError);
  assert.match(text(missing), /Methods for this path: GET, POST/);
});

test("resource devcontext://overview is listed and readable", async () => {
  const { client } = await connectInMemory();
  const { resources } = await client.listResources();
  assert.ok(resources.some((r) => r.uri === "devcontext://overview"));
  const { contents } = await client.readResource({ uri: "devcontext://overview" });
  assert.match(contents[0].text, /Rules for agents/);
});

test("prompt component_from_spec is listed with its three arguments", async () => {
  const { client } = await connectInMemory();
  const { prompts } = await client.listPrompts();
  const prompt = prompts.find((p) => p.name === "component_from_spec");
  assert.ok(prompt, "component_from_spec prompt not found");
  const argNames = prompt.arguments?.map((a) => a.name).sort();
  assert.deepEqual(argNames, ["component_name", "reference_component", "spec"]);
});

test("prompt component_from_spec substitutes real arguments into the template", async () => {
  const { client } = await connectInMemory();
  const result = await client.getPrompt({
    name: "component_from_spec",
    arguments: { component_name: "Tooltip", spec: "a hover hint", reference_component: "Button" },
  });
  const rendered = result.messages[0].content.text;
  assert.doesNotMatch(rendered, /\{\{.*?\}\}/);
  assert.match(rendered, /Build \*\*`Tooltip`\*\* — a hover hint/);
  assert.match(rendered, /get_component_api\("Button"\)/);
});

test("every parameterized prompt in prompts/ is registered and renders", async () => {
  const { client } = await connectInMemory();
  const { prompts } = await client.listPrompts();
  const names = prompts.map((p) => p.name).sort();
  assert.deepEqual(names, ["api_consumer", "component_from_spec", "migration", "test_generation"]);

  // api_consumer takes endpoint_path + hook_name and must substitute both.
  const rendered = (
    await client.getPrompt({
      name: "api_consumer",
      arguments: { endpoint_path: "/api/refunds", hook_name: "useRefunds" },
    })
  ).messages[0].content.text;
  assert.doesNotMatch(rendered, /\{\{.*?\}\}/);
  assert.match(rendered, /useRefunds/);
  assert.match(rendered, /\/api\/refunds/);
});

test("list_tokens paginates: limit + offset + truncation notice", async () => {
  const { client } = await connectInMemory();

  // Page 1: two items, with a notice telling the model how to continue.
  const page1 = await client.callTool({ name: "list_tokens", arguments: { limit: 2 } });
  const out1 = text(page1);
  assert.equal(out1.split("\n").filter((l) => l.includes(" = ")).length, 2);
  assert.match(out1, /Showing 1–2 of \d+/);
  assert.match(out1, /offset=2/);

  // Page 2 must start where page 1 ended — no overlap, no gap.
  const page2 = await client.callTool({ name: "list_tokens", arguments: { limit: 2, offset: 2 } });
  const first1 = out1.split("\n")[0];
  const first2 = text(page2).split("\n")[0];
  assert.notEqual(first1, first2);

  // No limit at this repo's scale → no notice, output unchanged for existing clients.
  const all = await client.callTool({ name: "list_tokens", arguments: {} });
  assert.doesNotMatch(text(all), /Showing/);
});

test("find_token_for_value: exact match through the real tool call", async () => {
  const { client } = await connectInMemory();
  const result = await client.callTool({ name: "find_token_for_value", arguments: { value: "#6D28D9" } });
  assert.ok(!result.isError);
  assert.match(text(result), /Exact match: color\.brand\.primary/);
});

test("find_token_for_value: near-miss color returns closest + ΔE via the real tool call", async () => {
  const { client } = await connectInMemory();
  const result = await client.callTool({ name: "find_token_for_value", arguments: { value: "#7A3AE0" } });
  assert.match(text(result), /No exact match/);
  assert.match(text(result), /Closest: color\.brand\.primary/);
  assert.match(text(result), /ΔE/);
});

// ─── 2. Stdio: real subprocess, real transport ────────────────────────────────

test("stdio transport: spawn dist/index.js and call a tool end-to-end", async (t) => {
  const transport = new StdioClientTransport({
    command: process.execPath, // node
    args: [resolve(__dirname, "../dist/index.js")],
    env: {
      ...process.env,
      SHARED_UI_PATH: resolve(REPO_ROOT, "packages/ui/src"),
      API_CONTRACT_PATH: resolve(REPO_ROOT, "apps/refund-copilot/api.json"),
      PROMPTS_PATH: resolve(REPO_ROOT, "prompts"),
    },
  });
  const client = new Client({ name: "e2e-stdio", version: "0.0.0" });
  await client.connect(transport);
  t.after(() => client.close());

  const { tools } = await client.listTools();
  assert.equal(tools.length, 7);

  const result = await client.callTool({ name: "get_component_api", arguments: { name: "badge" } });
  assert.ok(!result.isError, text(result));
  assert.match(text(result), /Badge/); // case-insensitive lookup works over the wire
});
