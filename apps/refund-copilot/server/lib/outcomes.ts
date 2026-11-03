/**
 * The online half of the eval: what happened to the AI's output once a person
 * saw it. Two signals, both joined to the model call by trace id:
 *
 *   feedback  an explicit 👍/👎 on an answer, a reading or a plan
 *   outcome   what the agent did with an AI draft: created it as proposed or
 *             edited first, and whether it was later approved or rejected
 *
 * A rising "edited" rate is quality drift the golden set won't show. Each event
 * is logged as one [feedback] / [outcome] line for the log drain; the counters
 * here are per process (a restart resets them), enough for the supervisor's view.
 */
import { logEvent } from "@refund-copilot/ai-runtime/observability";
import type { AiProvenance, Refund } from "./types.ts";

export const FEEDBACK_FEATURES = ["read", "ask", "plan"] as const;
export type FeedbackFeature = (typeof FEEDBACK_FEATURES)[number];
type Rating = "up" | "down";

/** Per model, so a canary (rollout.ts) can be compared with the stable model. */
interface ModelOutcomes { created: number; edited: number; approved: number; rejected: number }

interface FeatureMetrics {
  feedback: { up: number; down: number };
  created: number;     // AI drafts turned into refunds
  edited: number;      // … of which the agent changed first
  approved: number;
  rejected: number;
  failures: number;    // the model's output was unusable (no tool call, invalid shape, invented citation)
  byModel: Record<string, ModelOutcomes>;
}

const empty = (): FeatureMetrics => ({ feedback: { up: 0, down: 0 }, created: 0, edited: 0, approved: 0, rejected: 0, failures: 0, byModel: {} });

export function createOutcomes() {
  const metrics: Record<FeedbackFeature, FeatureMetrics> = { read: empty(), ask: empty(), plan: empty() };

  return {
    feedback(f: { feature: FeedbackFeature; traceId: string; rating: Rating; comment?: string | null; user: string }) {
      metrics[f.feature].feedback[f.rating]++;
      logEvent("feedback", { trace_id: f.traceId, feature: f.feature, rating: f.rating, user: f.user, ...(f.comment ? { comment: f.comment } : {}) });
    },

    /** Call after a refund changes; only AI drafts count. */
    outcome(r: Refund, outcome: "created" | "approved" | "rejected") {
      const ai: AiProvenance | undefined = r.ai;
      if (!ai) return;
      const m = metrics[ai.feature];
      const byModel = (m.byModel[ai.model] ??= { created: 0, edited: 0, approved: 0, rejected: 0 });
      m[outcome]++;
      byModel[outcome]++;
      if (outcome === "created" && ai.edited) { m.edited++; byModel.edited++; }
      logEvent("outcome", { trace_id: ai.traceId, feature: ai.feature, outcome, edited: ai.edited, refund: r.id, model: ai.model, prompt_version: ai.promptVersion });
    },

    /** The model's output couldn't be used as is. */
    failure(f: { feature: FeedbackFeature; traceId: string; kind: string; detail?: string }) {
      metrics[f.feature].failures++;
      logEvent("tool_failure", { trace_id: f.traceId, feature: f.feature, kind: f.kind, ...(f.detail ? { detail: f.detail } : {}) });
    },

    snapshot: (): Record<FeedbackFeature, FeatureMetrics> => structuredClone(metrics),
  };
}

export type Outcomes = ReturnType<typeof createOutcomes>;
