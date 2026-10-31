import { describe, expect, it } from "vitest";
import { billingCycleSpan } from "../src/billing-cycle.js";

const date = (value: string) => new Date(`${value}T00:00:00.000Z`);
function span(type: "PREPAID" | "POSTPAID", n: number, month: number, start = "2026-11-05") {
  return billingCycleSpan(type, date(start), n,
    new Date(Date.UTC(2027, month - 1, 1)), new Date(Date.UTC(2027, month, 0)));
}
describe("financial-year subscription billing", () => {
  it.each([3, 6, 12])("uses only fiscal boundaries for %i month prepaid periods", (n) => {
    const months = Array.from({ length: 12 }, (_, i) => i + 1).filter((m) => span("PREPAID", n, m));
    expect(months).toEqual(n === 3 ? [1, 4, 7, 10] : n === 6 ? [4, 10] : [4]);
  });
  it("starts the November subscriber's quarterly auto billing in January", () => {
    expect(span("PREPAID", 3, 1)).toEqual({ spanStart: date("2027-01-01"), spanEnd: date("2027-03-31") });
    expect(billingCycleSpan("PREPAID", date("2026-11-05"), 3, date("2026-10-01"), date("2026-10-31"))).toBeNull();
    expect(billingCycleSpan("POSTPAID", date("2026-11-05"), 3, date("2026-12-01"), date("2026-12-31"))).toBeNull();
  });
  it.each([3, 6, 12])("bills completed full %i month postpaid periods in March", (n) => {
    expect(span("POSTPAID", n, 3, "2026-04-01")).toEqual({
      spanStart: date(n === 3 ? "2027-01-01" : n === 6 ? "2026-10-01" : "2026-04-01"),
      spanEnd: date("2027-03-31"),
    });
  });
  it("does not bill an annual period that started before service", () => {
    expect(span("POSTPAID", 12, 3)).toBeNull();
    expect(span("PREPAID", 12, 4)?.spanEnd).toEqual(date("2028-03-31"));
  });
  it("preserves monthly billing and accepts exact boundary starts", () => {
    expect(span("PREPAID", 1, 1, "2027-01-05")).not.toBeNull();
    expect(span("PREPAID", 3, 1, "2027-01-01")).not.toBeNull();
    expect(span("PREPAID", 3, 1, "2027-01-02")).toBeNull();
  });
});
