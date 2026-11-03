import { describe, it, expect } from "vitest";
import { createRateLimiter } from "./rateLimit.ts";

describe("rate limiter", () => {
  it("allows requests under the budget and blocks the one that exceeds it", () => {
    const limiter = createRateLimiter();
    for (let i = 0; i < 20; i++) expect(limiter.isLimited("1.2.3.4")).toBe(false);
    expect(limiter.isLimited("1.2.3.4")).toBe(true);
  });

  it("tracks each IP independently, and each limiter on its own", () => {
    const a = createRateLimiter(), b = createRateLimiter();
    for (let i = 0; i < 20; i++) a.isLimited("1.2.3.4");
    expect(a.isLimited("1.2.3.4")).toBe(true);
    expect(a.isLimited("5.6.7.8")).toBe(false);
    expect(b.isLimited("1.2.3.4")).toBe(false);
  });

  it("forgets hits once the window has passed", () => {
    const limiter = createRateLimiter();
    const start = Date.now();
    for (let i = 0; i < 20; i++) limiter.isLimited("1.2.3.4", start);
    expect(limiter.isLimited("1.2.3.4", start + 61_000)).toBe(false);
  });

  it("sweeps stale IPs out of memory instead of growing forever", () => {
    const limiter = createRateLimiter({ sweepEvery: 500 });
    const start = Date.now();
    for (let i = 0; i < 500; i++) limiter.isLimited(`10.0.0.${i}`, start);   // the 500th call sweeps; all are fresh
    expect(limiter.size()).toBe(500);
    // 500 more calls a window later: the sweep at the 500th drops the stale first batch.
    for (let i = 0; i < 500; i++) limiter.isLimited(`10.1.0.${i}`, start + 61_000);
    expect(limiter.size()).toBe(500);
  });
});
