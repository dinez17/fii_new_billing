import { describe, expect, it } from "vitest";
import { z } from "zod";
import { transactionPeriodFilters } from "../src/transaction-filters.js";
describe("transaction period filters", () => {
  const schema = z.object(transactionPeriodFilters);
  it("keeps filters optional for existing lookup callers", () => {
    expect(schema.parse({})).toEqual({});
  });
  it("includes the complete final calendar day and preserves exact timestamp bounds", () => {
    expect(schema.parse({ to: "2026-10-27" }).to?.toISOString()).toBe("2026-10-27T23:59:59.999Z");
    expect(schema.parse({ to: "2026-10-27T12:30:00Z" }).to?.toISOString()).toBe("2026-10-27T12:30:00.000Z");
    expect(schema.safeParse({ from: "invalid" }).success).toBe(false);
  });
});
