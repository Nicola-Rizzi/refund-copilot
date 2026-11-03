import { describe, it, expect } from "vitest";
import { isFeatureEnabled, resolveTraceId } from "./observability.ts";

describe("isFeatureEnabled", () => {
  it("reads a comma list, case-insensitive, with 'all' as a master switch", () => {
    expect(isFeatureEnabled("ask", {})).toBe(true);
    expect(isFeatureEnabled("ask", { DISABLED_AI_FEATURES: "plan, ASK" })).toBe(false);
    expect(isFeatureEnabled("read", { DISABLED_AI_FEATURES: "plan,ask" })).toBe(true);
    expect(isFeatureEnabled("read", { DISABLED_AI_FEATURES: "all" })).toBe(false);
  });
});

describe("resolveTraceId", () => {
  it("keeps a well-formed id and mints one otherwise", () => {
    expect(resolveTraceId("abc-12345")).toBe("abc-12345");
    expect(resolveTraceId(undefined)).toMatch(/^[0-9a-f-]{36}$/);
    expect(resolveTraceId("x".repeat(100))).not.toBe("x".repeat(100));
  });
});
