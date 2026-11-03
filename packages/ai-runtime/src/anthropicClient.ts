/**
 * Real model client. Wraps the Anthropic SDK (Anthropic's API, or Amazon Bedrock with
 * AI_PROVIDER=bedrock) into the thin contracts the cores expect — `complete(request,
 * meta)` for one-shot calls and `stream(request, meta)` for token streaming (see
 * types.ts). This is the only file that imports the SDKs, which is what keeps the cores
 * runtime-agnostic, the SDK out of the browser bundle, and a provider swap in one place.
 *
 * It is also the natural seam for instrumentation: every model call passes through
 * here, so token usage and latency are logged here (via usage.ts) without the
 * cores, the endpoints, or the frontend knowing anything about it. `meta` carries
 * the request's trace id and the prompt version, so each [usage] line joins back
 * to its [request] line.
 */
import Anthropic from "@anthropic-ai/sdk";
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import { logUsage, type TokenUsage } from "./usage.ts";
import type { CallMeta, Complete, ModelRequest, Stream, UsageRecord } from "./types.ts";

// Label a call by the tool it forces, else a generic tag.
// Toolsets (e.g. a browser toolset) have no name: only a named tool labels the call.
const firstToolName = (request: ModelRequest) => { const t = request.tools?.[0]; return t && "name" in t ? t.name : undefined; };
const labelFor = (request: ModelRequest, meta: CallMeta) => meta.label ?? firstToolName(request) ?? "completion";

/** The one part of either client the cores use. */
type MessagesClient = { messages: Anthropic["messages"] };

export interface Provider {
  name: "anthropic" | "bedrock";
  client: MessagesClient;
  /** The model id this provider expects for a first-party id. */
  modelId: (model: string) => string;
}

/**
 * Which API serves the model. Default: Anthropic's, with ANTHROPIC_API_KEY.
 * AI_PROVIDER=bedrock: Amazon Bedrock through the SDK's Mantle client, in AWS_REGION,
 * with AWS credentials from the default chain (env, profile, SSO, IAM role); no
 * Anthropic key. Data then stays in the company's AWS account and region, and access
 * follows its IAM policies. Requests are the same; only the client and the model id
 * (the "anthropic." prefix Bedrock uses) change.
 */
export function resolveProvider(apiKey: string | undefined, env: Record<string, string | undefined> = process.env): Provider {
  const name = (env.AI_PROVIDER ?? "anthropic").toLowerCase();
  if (name === "bedrock") {
    const awsRegion = env.AWS_REGION ?? env.AWS_DEFAULT_REGION;
    if (!awsRegion) throw new Error("AI_PROVIDER=bedrock needs AWS_REGION (e.g. eu-central-1).");
    return { name: "bedrock", client: new AnthropicBedrockMantle({ awsRegion }), modelId: (m) => (m.startsWith("anthropic.") ? m : `anthropic.${m}`) };
  }
  if (name !== "anthropic") throw new Error(`Unknown AI_PROVIDER "${name}": use anthropic or bedrock.`);
  if (!apiKey) throw new Error("ANTHROPIC_API_KEY is not set. Export it before running the server or eval.");
  return { name: "anthropic", client: new Anthropic({ apiKey }), modelId: (m) => m };
}

/**
 * @param onUsage - called with the structured usage record after every model
 *   call. The server ignores it (the stderr line from logUsage is enough); the
 *   eval passes a collector so it can report tokens / latency / cost alongside
 *   the quality score.
 */
export function makeComplete(apiKey = process.env.ANTHROPIC_API_KEY, onUsage?: (record: UsageRecord) => void, provider = resolveProvider(apiKey)): Complete {
  const { client, modelId } = provider;
  return async function complete(request, meta = {}) {
    const start = performance.now();
    const response = await client.messages.create({ ...request, model: modelId(request.model) }, { signal: meta.signal });
    const record = logUsage({
      label: labelFor(request, meta),
      model: request.model,
      usage: response.usage,
      latencyMs: performance.now() - start,
      traceId: meta.traceId,
      user: meta.user,
      promptVersion: meta.promptVersion,
    });
    onUsage?.(record);
    return response;
  };
}

/**
 * Streaming variant: an async generator of text deltas. Usage is logged once the
 * stream finishes — or when the client aborts (meta.signal), in which case the
 * partial usage the API reported so far is what gets logged.
 */
export function makeStream(apiKey = process.env.ANTHROPIC_API_KEY, onUsage?: (record: UsageRecord) => void, provider = resolveProvider(apiKey)): Stream {
  const { client, modelId } = provider;
  return async function* stream(request, meta = {}) {
    const start = performance.now();
    let firstTokenMs: number | null = null;
    const s = client.messages.stream({ ...request, model: modelId(request.model) }, { signal: meta.signal });
    let usage: TokenUsage | null = null;
    try {
      for await (const ev of s) {
        if (ev.type === "message_start") usage = { ...ev.message.usage };
        if (ev.type === "message_delta" && usage) usage.output_tokens = ev.usage.output_tokens;
        if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          firstTokenMs ??= performance.now() - start;
          yield ev.delta.text;
        }
      }
    } finally {
      const record = logUsage({
        label: labelFor(request, meta),
        model: request.model,
        usage,
        latencyMs: performance.now() - start,
        ttftMs: firstTokenMs,
        traceId: meta.traceId,
      user: meta.user,
        promptVersion: meta.promptVersion,
      });
      onUsage?.(record);
    }
  };
}
