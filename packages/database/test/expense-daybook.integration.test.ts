import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/client.js";
import { cancelExpenseDayBook, postRecordedExpenseDayBook } from "../src/expense-daybook.js";
const suite = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("expense cancellation and Day Book", () => {
  let tenantId = "", categoryId = "";
  const expense = (status: "RECORDED" | "CANCELLED" = "RECORDED") => prisma.expense.create({ data: { tenantId, categoryId, fyCode: "2026-27", expenseDate: new Date("2026-10-01"), description: "Test expense", amount: 100, total: 100, mode: "BANK_TRANSFER", status } });
  beforeEach(async () => {
    tenantId = (await prisma.tenant.create({ data: { name: "Expense cancellation test", subdomain: `expense-cancel-${Date.now()}` } })).id;
    categoryId = (await prisma.expenseCategory.create({ data: { tenantId, name: "Adjustment" } })).id;
  });
  afterEach(async () => {
    await prisma.auditLog.deleteMany({ where: { tenantId } }); await prisma.dayBookClosing.deleteMany({ where: { tenantId } });
    await prisma.dayBookEntry.deleteMany({ where: { tenantId } }); await prisma.expense.deleteMany({ where: { tenantId } });
    await prisma.expenseCategory.deleteMany({ where: { tenantId } }); await prisma.tenant.delete({ where: { id: tenantId } }); await prisma.$disconnect();
  });
  it("posts on the expense date once, removes the posting on cancellation and ignores delayed creation events", async () => {
    const e = await expense();
    expect((await prisma.$transaction((tx) => postRecordedExpenseDayBook(tx, tenantId, e.id))).posted).toBe(true);
    expect((await prisma.$transaction((tx) => postRecordedExpenseDayBook(tx, tenantId, e.id))).posted).toBe(false);
    const row = await prisma.dayBookEntry.findFirstOrThrow({ where: { tenantId } });
    expect(row.entryDate.toISOString()).toBe("2026-10-01T00:00:00.000Z");
    const cancelled = await prisma.$transaction((tx) => cancelExpenseDayBook(tx, tenantId, e.id));
    expect(cancelled.expense.status).toBe("CANCELLED"); expect(cancelled.removedPostings).toBe(1);
    expect((await prisma.$transaction((tx) => postRecordedExpenseDayBook(tx, tenantId, e.id))).posted).toBe(false);
    expect((await prisma.$transaction((tx) => cancelExpenseDayBook(tx, tenantId, e.id))).removedPostings).toBe(0);
    expect(await prisma.dayBookEntry.count({ where: { tenantId } })).toBe(0);
    expect(await prisma.expense.count({ where: { tenantId, status: "CANCELLED" } })).toBe(1);
  });
  it("repairs old stale postings and subsequent closed-day snapshots without reopening days", async () => {
    const e = await expense("CANCELLED");
    await prisma.dayBookEntry.createMany({ data: [
      { tenantId, fyCode: "2026-27", entryDate: new Date("2026-09-30"), type: "CASH_IN", source: "MANUAL", amount: 1000 },
      { tenantId, fyCode: "2026-27", entryDate: new Date("2026-10-27"), type: "CASH_OUT", source: "EXPENSE", refType: "EXPENSE", refId: e.id, amount: 100 },
      { tenantId, fyCode: "2026-27", entryDate: new Date("2026-10-28"), type: "CASH_OUT", source: "MANUAL", amount: 20 },
    ] });
    await prisma.dayBookClosing.createMany({ data: [
      { tenantId, closingDate: new Date("2026-10-27"), openingBalance: 1000, totalCashIn: 0, totalCashOut: 100, closingBalance: 900 },
      { tenantId, closingDate: new Date("2026-10-28"), openingBalance: 900, totalCashIn: 0, totalCashOut: 20, closingBalance: 880 },
    ] });
    const result = await prisma.$transaction((tx) => cancelExpenseDayBook(tx, tenantId, e.id));
    expect(result.rebuiltClosings).toBe(2);
    const closings = await prisma.dayBookClosing.findMany({ where: { tenantId }, orderBy: { closingDate: "asc" } });
    expect(closings.map((row) => Number(row.closingBalance))).toEqual([1000, 980]);
    expect(Number(closings[1].openingBalance)).toBe(1000); expect(Number(closings[0].totalCashOut)).toBe(0);
    expect(await prisma.dayBookEntry.count({ where: { tenantId } })).toBe(2);
  });
  it("serializes cancellation against concurrent event delivery and prevents cross-tenant posting", async () => {
    const e = await expense();
    await Promise.all([
      prisma.$transaction((tx) => postRecordedExpenseDayBook(tx, tenantId, e.id)),
      prisma.$transaction((tx) => cancelExpenseDayBook(tx, tenantId, e.id)),
    ]);
    expect(await prisma.dayBookEntry.count({ where: { tenantId } })).toBe(0);
    expect((await prisma.$transaction((tx) => postRecordedExpenseDayBook(tx, "another-tenant", e.id))).posted).toBe(false);
  });
});
