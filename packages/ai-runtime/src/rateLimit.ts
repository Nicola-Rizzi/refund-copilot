/**
 * A per-IP rate limit for the AI routes: a speed bump against casual abuse, not
 * the real leash (that's the account spend limit, plus spend.ts per user). It's an
 * object the server creates and passes to the handlers, like the spend ledger, so
 * every test gets a fresh one and a shared store (e.g. Redis, for several
 * instances) would plug in at the same place. In memory: a restart resets it.
 */
export interface RateLimitOptions {
  perWindow?: number;
  windowMs?: number;
  /** Every N calls, IPs with no hits in the window are dropped, so memory stays bounded. */
  sweepEvery?: number;
}

export function createRateLimiter({ perWindow = 20, windowMs = 60_000, sweepEvery = 500 }: RateLimitOptions = {}) {
  const hits = new Map<string, number[]>();
  let callsSinceSweep = 0;

  const sweep = (now: number) => {
    for (const [ip, times] of hits) {
      const recent = times.filter((t) => now - t < windowMs);
      if (recent.length === 0) hits.delete(ip);
      else hits.set(ip, recent);
    }
  };

  return {
    /** Records this request; true if `ip` is now over the budget for the window. */
    isLimited(ip: string, now: number = Date.now()): boolean {
      const recent = (hits.get(ip) ?? []).filter((t) => now - t < windowMs);
      recent.push(now);
      hits.set(ip, recent);
      if (++callsSinceSweep >= sweepEvery) { callsSinceSweep = 0; sweep(now); }
      return recent.length > perWindow;
    },
    /** How many IPs are tracked: shows the sweep frees memory. */
    size: () => hits.size,
  };
}

export type RateLimiter = ReturnType<typeof createRateLimiter>;
