/**
 * Gradual release: send a new model to a share of users before everyone. A user's
 * bucket comes from a hash of feature and user id, so the same person always gets
 * the same variant (no flip-flopping between answers) and the share is the same
 * across restarts and instances. The model used is recorded on every draft and log
 * line, so the outcomes of the two variants can be compared before raising the share.
 *
 *   READ_CANARY_MODEL=<model id>  (or PLAN_ / ASK_)   CANARY_PERCENT=10
 */
import { createHash } from "node:crypto";

/** 0–99, stable for a given key. */
export function bucket(key: string): number {
  return createHash("sha256").update(key).digest().readUInt32BE(0) % 100;
}

export interface ModelChoice { model: string; variant: "stable" | "canary" }

export function pickModel(feature: string, stable: string, user: string | undefined, env: Record<string, string | undefined> = process.env): ModelChoice {
  const canary = env[`${feature.toUpperCase()}_CANARY_MODEL`];
  const percent = Math.min(100, Math.max(0, Number(env.CANARY_PERCENT ?? 0)));
  if (canary && user && percent > 0 && bucket(`${feature}|${user}`) < percent) return { model: canary, variant: "canary" };
  return { model: stable, variant: "stable" };
}
