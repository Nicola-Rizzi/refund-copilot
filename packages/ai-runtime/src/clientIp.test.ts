import { describe, it, expect } from "vitest";
import { clientIp } from "./clientIp.ts";

describe("clientIp", () => {
  it("prefers x-forwarded-for (proxy/serverless case)", () => {
    const req = { headers: { "x-forwarded-for": "9.9.9.9, 10.0.0.1" }, socket: { remoteAddress: "127.0.0.1" } };
    expect(clientIp(req)).toBe("9.9.9.9");
  });

  it("falls back to the socket address with no proxy header", () => {
    const req = { headers: {}, socket: { remoteAddress: "127.0.0.1" } };
    expect(clientIp(req)).toBe("127.0.0.1");
  });

  it("falls back to 'unknown' with neither", () => {
    const req = { headers: {}, socket: {} };
    expect(clientIp(req)).toBe("unknown");
  });
});
