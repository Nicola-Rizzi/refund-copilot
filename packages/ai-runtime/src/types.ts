/**
 * The contracts between the AI cores and the model client. The cores build a
 * request and read a response; they never import the SDK, so a test can pass a
 * stub and a different provider (e.g. Bedrock) only has to honour these shapes.
 */
import type Anthropic from "@anthropic-ai/sdk";

export type ModelRequest = Anthropic.MessageCreateParamsNonStreaming;

/** The part of a content block the cores read. A real SDK block satisfies it. */
export interface ResponseBlock {
  type: string;
  name?: string;
  input?: unknown;
  text?: string;
}

/** The part of a model response the cores read. A real SDK Message satisfies it. */
export interface ModelResponse {
  stop_reason?: string | null;
  content?: ResponseBlock[];
}

/** Carried with every model call so its [usage] line joins the request's trace. */
export interface CallMeta {
  traceId?: string;
  /** Who the call is for: the spend cap adds its cost to this user. */
  user?: string;
  signal?: AbortSignal;
  label?: string;
  promptVersion?: string;
}

export type Complete = (request: ModelRequest, meta?: CallMeta) => Promise<ModelResponse>;
export type Stream = (request: ModelRequest, meta?: CallMeta) => AsyncIterable<string>;

/** One structured [usage] record, as logged and as handed to an eval collector. */
export interface UsageRecord {
  t: string;
  trace_id?: string;
  user?: string;
  label: string;
  prompt_version?: string;
  model: string;
  in_tokens: number | null;
  out_tokens: number | null;
  latency_ms: number | null;
  ttft_ms?: number;
  est_usd?: number;
}

// SDK shapes the cores need to build requests, re-exported so app code never imports the SDK.
export type ToolParam = Anthropic.Tool;
export type ContentBlockParam = Anthropic.ContentBlockParam;
export type MessageParam = Anthropic.MessageParam;
