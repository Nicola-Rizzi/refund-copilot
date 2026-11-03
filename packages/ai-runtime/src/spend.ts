/**
 * A daily AI spending cap per user. Every model call's estimated cost (from the
 * [usage] record, so the same numbers the logs show) is added to the user who made
 * it; once they pass the cap, the AI routes refuse them until the next UTC day and
 * point to the manual path. Per process and in memory, like the rate limit: a cost
 * guard for one deployment, while the account-level spend limit stays the backstop.
 * Calls to a model without a price in usage.ts add nothing.
 */
import type { UsageRecord } from "./types.ts";

export interface SpendOptions {
  dailyUsdPerUser?: number;
  now?: () => Date;
}

export function createSpendLedger({ dailyUsdPerUser = Number(process.env.DAILY_AI_BUDGET_USD ?? 1), now = () => new Date() }: SpendOptions = {}) {
  const spent = new Map<string, number>();   // `${day}|${user}` → USD
  const key = (user: string) => `${now().toISOString().slice(0, 10)}|${user}`;

  return {
    limit: dailyUsdPerUser,
    /** Feed every usage record here (makeComplete / makeStream `onUsage`). */
    record(r: UsageRecord) {
      if (!r.user || !r.est_usd) return;
      const k = key(r.user);
      spent.set(k, (spent.get(k) ?? 0) + r.est_usd);
      // Keep only today's entries: yesterday's totals can't matter again.
      const today = k.slice(0, 10);
      for (const old of spent.keys()) if (!old.startsWith(today)) spent.delete(old);
    },
    spentToday: (user: string) => spent.get(key(user)) ?? 0,
    isOverBudget(user: string) { return (spent.get(key(user)) ?? 0) >= dailyUsdPerUser; },
  };
}

export type SpendLedger = ReturnType<typeof createSpendLedger>;
