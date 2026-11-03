import { describe, it, expect } from "vitest";
import { bucket, pickModel } from "./rollout.ts";

describe("gradual release", () => {
  it("is off unless a canary model and a percentage are both set", () => {
    expect(pickModel("read", "stable-m", "luca", {})).toEqual({ model: "stable-m", variant: "stable" });
    expect(pickModel("read", "stable-m", "luca", { READ_CANARY_MODEL: "new-m" }).variant).toBe("stable");
    expect(pickModel("read", "stable-m", "luca", { READ_CANARY_MODEL: "new-m", CANARY_PERCENT: "100" })).toEqual({ model: "new-m", variant: "canary" });
  });

  it("keeps each user on one variant, per feature, and sends about the set share", () => {
    const env = { READ_CANARY_MODEL: "new-m", CANARY_PERCENT: "10" };
    expect(pickModel("read", "s", "luca", env)).toEqual(pickModel("read", "s", "luca", env));
    expect(pickModel("plan", "s", "luca", env).variant).toBe("stable");   // no PLAN_CANARY_MODEL
    const users = Array.from({ length: 2000 }, (_, i) => `user-${i}`);
    const share = users.filter((u) => bucket(`read|${u}`) < 10).length / users.length;
    expect(share).toBeGreaterThan(0.07);
    expect(share).toBeLessThan(0.13);
  });
});
