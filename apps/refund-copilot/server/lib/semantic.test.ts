// @vitest-environment node
import { describe, it, expect, vi } from "vitest";
import type { Embed } from "@refund-copilot/ai-runtime/embeddings";
import { createSemanticIndex, recordText } from "./semantic.ts";
import { retrieve, MAX_CONTEXT_RECORDS } from "./retrieve.ts";
import { askShop } from "./askShop.ts";
import { createStore } from "./refunds.ts";
import type { Order } from "./types.ts";

// A stand-in for a real embedding model: words map to concepts, so "ceramic", "glass"
// and "fragile" land close together while sharing no letters. Deterministic, offline.
const CONCEPTS: Record<string, string[]> = {
  fragile: ["fragile", "ceramic", "porcelain", "glass", "vase", "teapot", "carafe"],
  textile: ["wool", "linen", "cotton", "throw", "napkins", "towel"],
  furniture: ["oak", "table", "desk", "lamp"],
  damage: ["broken", "damaged", "cracked"],
};
const conceptEmbed: Embed = async (texts) => texts.map((t) => {
  const words = t.toLowerCase().split(/[^a-z]+/);
  return Object.values(CONCEPTS).map((vocab) => words.filter((w) => vocab.includes(w)).length);
});

// 300 orders, newest first. The three fragile items are old: beyond the newest 40.
const ordinary = ["Wool throw, grey", "Desk lamp, brass", "Linen napkins, set of 4", "Oak side table", "Cotton towel"];
const fragile: Record<number, string> = { 250: "Ceramic vase, sand", 260: "Porcelain teapot", 270: "Glass carafe" };
const orders: Order[] = Array.from({ length: 300 }, (_, i) => ({
  id: `ORD-${5000 + i}`, customerEmail: `customer${i}@example.com`, status: "delivered", shippedDaysAgo: i + 3, deliveredDaysAgo: i,
  shipping: 4.9, items: [{ sku: `SKU-${i}`, name: fragile[i] ?? ordinary[i % ordinary.length], qty: 1, unitPrice: 20 }],
}));
const FRAGILE_IDS = ["ORD-5250", "ORD-5260", "ORD-5270"];

describe("search by meaning", () => {
  it("finds the fragile orders that exact matching and the newest-first fallback miss", async () => {
    const question = "Did anything fragile arrive in pieces?";
    const exactOnly = retrieve(question, orders, []);
    expect(exactOnly.fallback).toBe(true);
    expect(exactOnly.orders).toHaveLength(MAX_CONTEXT_RECORDS);
    expect(exactOnly.orders.map((o) => o.id)).not.toContain("ORD-5250");

    const ids = await createSemanticIndex(conceptEmbed).search(question, orders, []);
    expect(ids.sort()).toEqual(FRAGILE_IDS);
    const hybrid = retrieve(question, orders, [], [], ids);
    expect(hybrid.fallback).toBe(false);
    expect(hybrid.matchedBy).toEqual(["meaning"]);
    expect(hybrid.orders.map((o) => o.id).sort()).toEqual(FRAGILE_IDS);
  });

  it("sends no customer data to the embedding provider, and embeds each record once", async () => {
    const seen: string[][] = [];
    const embed: Embed = async (texts, kind) => { seen.push(texts); return conceptEmbed(texts, kind); };
    const index = createSemanticIndex(embed);
    await index.search("fragile", orders, []);
    await index.search("textiles", orders, []);
    const documents = seen.filter((batch) => batch.length > 1).flat();
    expect(documents).toHaveLength(300);                              // the second search reused the vectors
    expect(documents.join(" ")).not.toMatch(/@example\.com/);
    expect(recordText(orders[250])).toBe("Order ORD-5250: 1 × Ceramic vase, sand; delivered 250 days ago.");
  });

  it("Ask still answers from exact signals when the embedding provider fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = createSemanticIndex(async () => { throw new Error("Voyage embeddings: HTTP 503"); });
    async function* stream() { yield "RF-2003 is pending [#RF-2003]."; }
    const store = createStore(undefined, { now: () => "2026-10-29" });
    const events = [];
    for await (const e of askShop({ question: "Which refunds are pending?" }, store, stream, { traceId: "trace-embed-01" }, undefined, failing)) events.push(e);
    expect(events.at(-1)).toMatchObject({ type: "result", citations: ["RF-2003"] });
    expect(vi.mocked(console.error).mock.calls.some((c) => String(c[0]).startsWith("[embed_error]"))).toBe(true);
    vi.restoreAllMocks();
  });
});
