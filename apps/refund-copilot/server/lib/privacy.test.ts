// @vitest-environment node
import { describe, it, expect } from "vitest";
import { redact, createPseudonyms } from "./privacy.ts";

describe("redact", () => {
  it("removes phone, IBAN, card and email; keeps order ids, dates and amounts", () => {
    const { text, counts } = redact(
      "Order ORD-1042 from 2026-10-12, 39.90 €. Call me on +39 333 123 4567 or mario@example.com. " +
      "Refund to IT60 X054 2811 1010 0000 0123 456, not my card 4111 1111 1111 1111.",
    );
    expect(text).toContain("ORD-1042");
    expect(text).toContain("2026-10-12");
    expect(text).toContain("39.90 €");
    expect(text).not.toMatch(/333|mario@|IT60|4111/);
    expect(counts).toEqual({ phone: 1, email: 1, iban: 1, card: 1 });
  });

  it("leaves a 16-digit number that fails Luhn as a card, and short numbers alone", () => {
    expect(redact("ref 1234 5678 9012 3456").counts.card).toBeUndefined();
    expect(redact("2 vases, 500 EUR, order 1042").counts).toEqual({});
  });
});

describe("pseudonyms", () => {
  it("gives each address one alias and maps it back", () => {
    const p = createPseudonyms();
    const masked = p.mask("mario@example.com and Mario@Example.com and giulia@example.com");
    expect(masked).toBe("CUST-001 and CUST-001 and CUST-002");
    expect(p.unmask("CUST-002 asked first, CUST-009 is unknown")).toBe("giulia@example.com asked first, CUST-009 is unknown");
  });

  it("unmasks an alias split across streamed chunks", () => {
    const p = createPseudonyms();
    p.mask("mario@example.com");
    const s = p.unmaskStream();
    const out = ["Refund for CU", "ST-0", "01 [#RF-2003]. C", "heck it."].map((c) => s.push(c)).join("") + s.flush();
    expect(out).toBe("Refund for mario@example.com [#RF-2003]. Check it.");
  });
});
