import { describe, it, expect } from "vitest";
import { createSpendLedger } from "./spend.ts";
import type { UsageRecord } from "./types.ts";

const call = (user: string | undefined, est_usd: number | undefined): UsageRecord =>
  ({ t: "", label: "read_request", model: "m", in_tokens: 1, out_tokens: 1, latency_ms: 1, ...(user ? { user } : {}), ...(est_usd ? { est_usd } : {}) });

describe("daily spend cap per user", () => {
  it("adds each call's cost to its user and stops them at the cap", () => {
    const ledger = createSpendLedger({ dailyUsdPerUser: 0.05, now: () => new Date("2026-11-02T10:00:00Z") });
    ledger.record(call("luca", 0.03));
    expect(ledger.isOverBudget("luca")).toBe(false);
    ledger.record(call("luca", 0.03));
    expect(ledger.isOverBudget("luca")).toBe(true);
    expect(ledger.isOverBudget("sara")).toBe(false);   // per user
  });

  it("starts over the next UTC day, and ignores calls without a user or a price", () => {
    let day = "2026-11-02";
    const ledger = createSpendLedger({ dailyUsdPerUser: 0.05, now: () => new Date(`${day}T23:00:00Z`) });
    ledger.record(call("luca", 0.06));
    ledger.record(call(undefined, 5));
    ledger.record(call("sara", undefined));
    expect(ledger.isOverBudget("luca")).toBe(true);
    expect(ledger.spentToday("sara")).toBe(0);
    day = "2026-11-03";
    expect(ledger.isOverBudget("luca")).toBe(false);
  });
});
