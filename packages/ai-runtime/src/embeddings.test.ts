import { describe, it, expect, vi } from "vitest";
import { makeVoyageEmbed, embedFromEnv, cosine } from "./embeddings.ts";

describe("Voyage embeddings", () => {
  it("posts the batch with the query/document hint and returns vectors in input order", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const fetchImpl = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const { input } = JSON.parse(String(init?.body)) as { input: string[] };
      // Out of order on purpose: the client must sort by index.
      const data = input.map((_t, i) => ({ embedding: [i], index: i })).reverse();
      return new Response(JSON.stringify({ data, usage: { total_tokens: 12 } }), { status: 200 });
    });
    const embed = makeVoyageEmbed({ apiKey: "pa-test", model: "voyage-4-lite", fetchImpl });
    expect(await embed(["a", "b", "c"], "document")).toEqual([[0], [1], [2]]);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toBe("https://api.voyageai.com/v1/embeddings");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer pa-test");
    expect(JSON.parse(String(init?.body))).toEqual({ input: ["a", "b", "c"], model: "voyage-4-lite", input_type: "document" });
  });

  it("fails loudly on an HTTP error or a short answer", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const down = makeVoyageEmbed({ apiKey: "k", fetchImpl: async () => new Response("{}", { status: 429 }) });
    await expect(down(["a"], "query")).rejects.toThrow(/HTTP 429/);
    const short = makeVoyageEmbed({ apiKey: "k", fetchImpl: async () => new Response(JSON.stringify({ data: [] }), { status: 200 }) });
    await expect(short(["a"], "query")).rejects.toThrow(/0 vectors for 1 inputs/);
  });

  it("is off without VOYAGE_API_KEY; cosine scores direction", () => {
    expect(embedFromEnv({})).toBeNull();
    expect(embedFromEnv({ VOYAGE_API_KEY: "k" })).toBeTypeOf("function");
    expect(cosine([1, 0], [2, 0])).toBeCloseTo(1);
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });
});
