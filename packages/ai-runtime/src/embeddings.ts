/**
 * Text embeddings for retrieval, from Voyage AI (the embedding provider Anthropic
 * recommends), through its REST API (docs.voyageai.com/reference/embeddings-api).
 * The same discipline as the model client: this file is the only code that knows
 * the provider, and each request logs one [embed] line (inputs, tokens, latency,
 * trace id). Off without VOYAGE_API_KEY: retrieval then uses its exact signals only.
 */
import { logEvent } from "./observability.ts";

export type EmbedKind = "query" | "document";
/** Texts → vectors, in input order. `kind` lets the provider tune for search queries vs stored records. */
export type Embed = (texts: string[], kind: EmbedKind, meta?: { traceId?: string }) => Promise<number[][]>;

const VOYAGE_URL = "https://api.voyageai.com/v1/embeddings";
const MAX_INPUTS = 1000;   // per request, per the API reference

export interface VoyageOptions {
  apiKey: string;
  model?: string;
  fetchImpl?: typeof fetch;
}

export function makeVoyageEmbed({ apiKey, model = "voyage-4-lite", fetchImpl = fetch }: VoyageOptions): Embed {
  return async (texts, kind, meta = {}) => {
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += MAX_INPUTS) {
      const batch = texts.slice(i, i + MAX_INPUTS);
      const start = performance.now();
      const res = await fetchImpl(VOYAGE_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
        body: JSON.stringify({ input: batch, model, input_type: kind }),
      });
      if (!res.ok) throw new Error(`Voyage embeddings: HTTP ${res.status}`);
      const body = (await res.json()) as { data: { embedding: number[]; index: number }[]; usage?: { total_tokens?: number } };
      const vectors = [...body.data].sort((a, b) => a.index - b.index).map((d) => d.embedding);
      if (vectors.length !== batch.length) throw new Error(`Voyage embeddings: ${vectors.length} vectors for ${batch.length} inputs`);
      out.push(...vectors);
      logEvent("embed", { ...(meta.traceId ? { trace_id: meta.traceId } : {}), model, kind, inputs: batch.length, tokens: body.usage?.total_tokens ?? null, latency_ms: Math.round(performance.now() - start) });
    }
    return out;
  };
}

/** Voyage when VOYAGE_API_KEY is set (EMBED_MODEL picks the model), otherwise none. */
export function embedFromEnv(env: Record<string, string | undefined> = process.env): Embed | null {
  return env.VOYAGE_API_KEY ? makeVoyageEmbed({ apiKey: env.VOYAGE_API_KEY, model: env.EMBED_MODEL ?? "voyage-4-lite" }) : null;
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}
