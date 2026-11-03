import { describe, it, expect, vi, afterEach } from "vitest";
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import { makeComplete, resolveProvider, type Provider } from "./anthropicClient.ts";

afterEach(() => vi.restoreAllMocks());

describe("provider selection", () => {
  it("defaults to Anthropic's API and needs ANTHROPIC_API_KEY", () => {
    expect(resolveProvider("sk-test", {}).name).toBe("anthropic");
    expect(() => resolveProvider(undefined, {})).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("AI_PROVIDER=bedrock: the Mantle client in AWS_REGION, no Anthropic key, anthropic.-prefixed model ids", () => {
    const p = resolveProvider(undefined, { AI_PROVIDER: "bedrock", AWS_REGION: "eu-central-1" });
    expect(p.name).toBe("bedrock");
    expect(p.client).toBeInstanceOf(AnthropicBedrockMantle);
    expect(p.modelId("claude-sonnet-5")).toBe("anthropic.claude-sonnet-5");
    expect(p.modelId("anthropic.claude-sonnet-5")).toBe("anthropic.claude-sonnet-5");
  });

  it("fails clearly on a missing region or an unknown provider", () => {
    expect(() => resolveProvider(undefined, { AI_PROVIDER: "bedrock" })).toThrow(/AWS_REGION/);
    expect(() => resolveProvider("k", { AI_PROVIDER: "vertex" })).toThrow(/Unknown AI_PROVIDER/);
  });
});

describe("a call through a provider", () => {
  it("sends the provider's model id, and logs usage under the model the core asked for", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const create = vi.fn(async (req: { model: string }) => ({ id: "m", content: [], stop_reason: "end_turn", usage: { input_tokens: 1000, output_tokens: 100 }, model: req.model }));
    const fake = { name: "bedrock", client: { messages: { create } }, modelId: (m: string) => `anthropic.${m}` } as unknown as Provider;
    const records: { model: string; est_usd?: number; user?: string }[] = [];
    const complete = makeComplete(undefined, (r) => records.push(r), fake);
    await complete({ model: "claude-sonnet-5", max_tokens: 10, messages: [{ role: "user", content: "hi" }] }, { user: "luca", label: "read_request" });
    expect(create.mock.calls[0][0].model).toBe("anthropic.claude-sonnet-5");
    expect(records[0]).toMatchObject({ model: "claude-sonnet-5", user: "luca" });
    expect(records[0].est_usd).toBeGreaterThan(0);
  });

  it("through the real Bedrock client: regional endpoint, anthropic. model id, signed with AWS credentials, no API key", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    // No AWS account: fake credentials, and fetch intercepted before anything leaves the process.
    const sent: { url: string; headers: Headers; body: { model: string } }[] = [];
    const fetch = async (url: string | URL | Request, init?: RequestInit) => {
      sent.push({ url: String(url), headers: new Headers(init?.headers), body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ id: "msg_1", type: "message", role: "assistant", model: "anthropic.claude-sonnet-5",
        content: [{ type: "text", text: "ok" }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 2 } }),
        { status: 200, headers: { "content-type": "application/json" } });
    };
    const client = new AnthropicBedrockMantle({ awsRegion: "eu-central-1", awsAccessKey: "AKIDEXAMPLE", awsSecretAccessKey: "not-a-real-secret", fetch });
    const provider: Provider = { name: "bedrock", client, modelId: resolveProvider(undefined, { AI_PROVIDER: "bedrock", AWS_REGION: "eu-central-1" }).modelId };
    await makeComplete(undefined, undefined, provider)({ model: "claude-sonnet-5", max_tokens: 10, messages: [{ role: "user", content: "hi" }] });

    expect(sent).toHaveLength(1);
    expect(sent[0].url).toMatch(/^https:\/\/bedrock-mantle\.eu-central-1\.api\.aws\/anthropic\/v1\/messages/);
    expect(sent[0].body.model).toBe("anthropic.claude-sonnet-5");
    expect(sent[0].headers.get("authorization")).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/eu-central-1\//);
    expect(sent[0].headers.get("x-api-key")).toBeNull();
  });
});
