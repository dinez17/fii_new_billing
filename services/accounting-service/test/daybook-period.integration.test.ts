import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma } from "@fii/database";
import { computeDayBookPeriod } from "../src/daybook.js";
import { generate } from "../../../workers/report-worker/src/generators.js";
const suite = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("Day Book active financial year", () => {
  let tenantId = "", otherId = "";
  beforeAll(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: "Daybook test", subdomain: `daybook-${Date.now()}` } })).id;
    otherId = (await prisma.tenant.create({ data: { name: "Other daybook", subdomain: `other-daybook-${Date.now()}` } })).id;
    await prisma.financialYear.create({ data: { tenantId, code: "2026-27", startDate: new Date("2026-04-01"), endDate: new Date("2027-03-31T23:59:59Z"), isActive: true } });
    const base = { tenantId, source: "MANUAL" as const, mode: "CASH" as const, type: "CASH_IN" as const };
    await prisma.dayBookEntry.createMany({ data: [
      { ...base, fyCode: "2025-26", entryDate: new Date("2026-03-31"), amount: 100 },
      { ...base, fyCode: "2026-27", entryDate: new Date("2026-04-01"), amount: 20 },
      { ...base, fyCode: "2026-27", entryDate: new Date("2026-10-27"), amount: 5, type: "CASH_OUT" },
      { ...base, fyCode: "2026-27", entryDate: new Date("2026-10-28"), amount: 50 },
      { ...base, fyCode: "2025-26", entryDate: new Date("2026-05-01"), amount: 7 },
      { ...base, tenantId: otherId, fyCode: "2026-27", entryDate: new Date("2026-05-01"), amount: 1000 },
    ] });
  });
  afterAll(async () => {
    await prisma.dayBookEntry.deleteMany({ where: { tenantId: { in: [tenantId, otherId] } } });
    await prisma.financialYear.deleteMany({ where: { tenantId } }); await prisma.tenant.deleteMany({ where: { id: { in: [tenantId, otherId] } } }); await prisma.$disconnect();
  });
  it("uses the active FY, preserves opening balances and computes totals across all pages", async () => {
    const result = await computeDayBookPeriod(tenantId, { to: new Date("2026-10-27"), limit: 1 });
    expect(result.fyCode).toBe("2026-27"); expect(result.from.toISOString()).toBe("2026-04-01T00:00:00.000Z");
    expect(result.total).toBe(2); expect(result.entries).toHaveLength(1);
    expect(result.opening).toBe(100); expect(result.cashIn).toBe(20); expect(result.cashOut).toBe(5); expect(result.closing).toBe(115);
    const second = await computeDayBookPeriod(tenantId, { to: new Date("2026-10-27"), limit: 1, page: 2 });
    expect(second.entries[0].id).not.toBe(result.entries[0].id); expect(second.closing).toBe(115);
    await expect(computeDayBookPeriod(tenantId, { fyCode: "FOREIGN" })).rejects.toThrow("Financial year not found");
    await expect(computeDayBookPeriod(tenantId, { from: new Date("2026-10-28"), to: new Date("2026-10-27") })).rejects.toThrow("To date");
  });
  it("exports exactly the selected FY period with dates", async () => {
    const report = await generate("DAY_BOOK", tenantId, { fyCode: "2026-27", from: "2026-04-01", to: "2026-10-27" });
    expect(report.columns[0]).toBe("Date"); expect(report.rows).toHaveLength(2);
    expect(report.rows.map((row) => row[0])).toEqual(["01-04-2026", "27-10-2026"]);
    expect(report.summary).toContainEqual(["Net", 15]);
  });
});
