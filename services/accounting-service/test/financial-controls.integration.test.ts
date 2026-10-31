import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { prisma, createTenantBackup, validateTenantBackup } from "@fii/database";
import { journalBody, postJournal, trialBalance, yearEndSnapshot } from "../src/financial-controls.js";
const suite = process.env.RUN_INTEGRATION_TESTS === "true" ? describe : describe.skip;
suite("balanced journal accounts", () => {
  let tenantId = "", otherId = "", actorId = "", cash = "", capital = "", foreign = "";
  const date = new Date("2026-10-31");
  beforeAll(async () => {
    const stamp = Date.now();
    tenantId = (await prisma.tenant.create({ data: { name: "Journal test", subdomain: `journal-${stamp}` } })).id;
    otherId = (await prisma.tenant.create({ data: { name: "Other journal", subdomain: `journal-other-${stamp}` } })).id;
    actorId = (await prisma.user.create({ data: { tenantId, name: "Tester", email: "journal@example.test", passwordHash: "not-a-login" } })).id;
    await prisma.financialYear.create({ data: { tenantId, code: "2026-27", isActive: true, startDate: new Date("2026-04-01"), endDate: new Date("2027-03-31") } });
    cash = (await prisma.financialAccount.create({ data: { tenantId, code: "CASH", name: "Cash", type: "ASSET", isMoneyAccount: true } })).id;
    capital = (await prisma.financialAccount.create({ data: { tenantId, code: "CAPITAL", name: "Capital", type: "EQUITY" } })).id;
    foreign = (await prisma.financialAccount.create({ data: { tenantId: otherId, code: "BANK", name: "Other bank", type: "ASSET", isMoneyAccount: true } })).id;
  });
  afterAll(async () => {
    const where = { tenantId: { in: [tenantId,otherId] } };
    await prisma.auditLog.deleteMany({ where }); await prisma.$transaction([prisma.journalLine.deleteMany({ where }), prisma.journalEntry.deleteMany({ where })]); await prisma.financialAccount.deleteMany({ where });
    await prisma.financialYear.deleteMany({ where }); await prisma.user.deleteMany({ where }); await prisma.tenant.deleteMany({ where: { id: { in: [tenantId,otherId] } } }); await prisma.$disconnect();
  });
  it("rejects an unbalanced journal and cross-tenant accounts without partial posting", async () => {
    await expect(postJournal(tenantId, actorId, { entryDate: date, narration: "Verified opening funds", lines: [{ accountId: cash, debit: 100, credit: 0 }, { accountId: capital, debit: 0, credit: 90 }] })).rejects.toThrow("total debits");
    await expect(postJournal(tenantId, actorId, { entryDate: date, narration: "Wrong tenant transfer", lines: [{ accountId: cash, debit: 100, credit: 0 }, { accountId: foreign, debit: 0, credit: 100 }] })).rejects.toThrow("another tenant");
    expect(await prisma.journalEntry.count({ where: { tenantId } })).toBe(0);
    expect(journalBody.safeParse({ entryDate: date, narration: "Invalid precision amount", lines: [{ accountId: cash, debit: 1.001, credit: 0 }, { accountId: capital, debit: 0, credit: 1.001 }] }).success).toBe(false);
  });
  it("posts decimal-balanced opening funds and reverses without deleting audit history", async () => {
    const journal = await postJournal(tenantId, actorId, { entryDate: date, narration: "Verified opening cash and capital", lines: [{ accountId: cash, debit: 100.01, credit: 0 }, { accountId: capital, debit: 0, credit: 100.01 }] });
    const snapshot = await prisma.$transaction(tx => yearEndSnapshot(tx,tenantId,"2026-27"));
    expect(snapshot.signature).toMatch(/^[a-f0-9]{64}$/); expect(snapshot.profitBasis).toBeNull();
    const trial = await trialBalance(tenantId);
    expect(trial.difference).toBe("0.00"); expect(trial.items.find(a => a.id === cash)?.closing).toBe("100.01");
    await postJournal(tenantId, actorId, { entryDate: date, narration: "Reverse incorrect opening cash", lines: [{ accountId: cash, debit: 0, credit: 100.01 }, { accountId: capital, debit: 100.01, credit: 0 }] }, journal.id);
    const updatedSnapshot = await prisma.$transaction(tx => yearEndSnapshot(tx,tenantId,"2026-27"));
    expect(updatedSnapshot.signature).not.toBe(snapshot.signature);
    expect((await trialBalance(tenantId)).items.find(a => a.id === cash)?.closing).toBe("0.00");
    expect(await prisma.auditLog.count({ where: { tenantId, action: "JOURNAL_POSTED" } })).toBe(2);
    const backup = await createTenantBackup(tenantId); expect(() => validateTenantBackup(backup, tenantId)).not.toThrow();
    expect(backup.tables.JournalEntry).toHaveLength(2); expect(backup.tables.FinancialAccount).toHaveLength(2);
  });
  it("does not allow posting in a locked year", async () => {
    await prisma.financialYear.updateMany({ where: { tenantId }, data: { isLocked: true } });
    await expect(postJournal(tenantId, actorId, { entryDate: date, narration: "Attempt after year lock", lines: [{ accountId: cash, debit: 1, credit: 0 }, { accountId: capital, debit: 0, credit: 1 }] })).rejects.toThrow("unlocked financial year");
  });
});
