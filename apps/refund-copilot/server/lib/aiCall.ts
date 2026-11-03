/**
 * The AI features in one table: each one's default model and prompt version.
 * aiCall() turns a request into what a core needs: the model for this user (the
 * canary share in rollout.ts may pick a new one), the call metadata (trace id,
 * abort signal, user for the spend cap) and the provenance the response returns.
 * A new AI feature is one entry here; no route builds these by hand.
 */
import { pickModel } from "@refund-copilot/ai-runtime/rollout";
import type { CallMeta } from "@refund-copilot/ai-runtime/types";
import { READ_MODEL, READ_PROMPT_VERSION } from "./readRequest.ts";
import { PLAN_MODEL, PLAN_PROMPT_VERSION } from "./planRefunds.ts";
import { ASK_MODEL, ASK_PROMPT_VERSION } from "./askShop.ts";
import type { User } from "./types.ts";

export const AI_FEATURES = {
  read: { model: READ_MODEL, promptVersion: READ_PROMPT_VERSION },
  plan: { model: PLAN_MODEL, promptVersion: PLAN_PROMPT_VERSION },
  ask: { model: ASK_MODEL, promptVersion: ASK_PROMPT_VERSION },
} as const;

export type AiFeature = keyof typeof AI_FEATURES;

export function aiCall<F extends AiFeature>(feature: F, ctx: { user: User; traceId: string; signal?: AbortSignal }) {
  const { model } = pickModel(feature, AI_FEATURES[feature].model, ctx.user.id);
  const meta: CallMeta = { traceId: ctx.traceId, signal: ctx.signal, user: ctx.user.id };
  return { model, meta, provenance: { feature, traceId: ctx.traceId, model, promptVersion: AI_FEATURES[feature].promptVersion } };
}
