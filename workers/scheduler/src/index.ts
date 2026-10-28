/**
 * scheduler — cron producer. Run exactly ONE replica.
 *
 * Jobs (IST assumed via TZ env or host clock):
 *   0 1 1 * *     prepaid billing for the new month (1st, 01:00)
 *   0 23 28-31 * * postpaid billing IF tomorrow is the 1st (month end, 23:00)
 *   0 9 * * *     payment due reminders (T-3, T-0, T+3)
 */
import { mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import cron from "node-cron";
import { prisma } from "@fii/database";
import { createLogger, runPgDump, startOpsServer } from "@fii/common";
import { TOPICS, makeEnvelope, publish } from "@fii/kafka";

const log = createLogger("scheduler");

function monthRange(year: number, monthIdx0: number): { start: Date; end: Date } {
  // UTC midnight boundaries keep periodStart stable across restarts
  const start = new Date(Date.UTC(year, monthIdx0, 1));
  const end = new Date(Date.UTC(year, monthIdx0 + 1, 0)); // last day of month
  return { start, end };
}

async function activeTenants(): Promise<string[]> {
  const tenants = await prisma.tenant.findMany({ where: { isActive: true }, select: { id: true } });
  return tenants.map((t) => t.id);
}

export async function publishBilling(cycleType: "PREPAID" | "POSTPAID", year: number, monthIdx0: number): Promise<number> {
  const { start, end } = monthRange(year, monthIdx0);
  const tenantIds = await activeTenants();
  for (const tenantId of tenantIds) {
    await publish(TOPICS.BILLING_GENERATE, tenantId, makeEnvelope(tenantId, {
      cycleType,
      periodStart: start.toISOString(),
      periodEnd: end.toISOString(),
    }));
  }
  log.info({ cycleType, period: `${year}-${monthIdx0 + 1}`, tenants: tenantIds.length }, "billing.generate published");
  return tenantIds.length;
}

async function dueReminders(): Promise<void> {
  // Historical imports must not trigger an unsolicited reminder campaign.
  // A user may still send an invoice explicitly from the billing screen.
  const historical = await prisma.legacyRecord.findMany({ where: { targetModel: "invoice", status: "IMPORTED", targetId: { not: null } }, select: { targetId: true } });
  const historicalIds = historical.map((row) => row.targetId!);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const targets = [
    { offsetDays: 3, template: "DUE_REMINDER_UPCOMING" },
    { offsetDays: 0, template: "DUE_REMINDER_TODAY" },
    { offsetDays: -3, template: "DUE_REMINDER_OVERDUE" },
  ];
  for (const t of targets) {
    const day = new Date(today.getTime() + t.offsetDays * 86_400_000);
    const next = new Date(day.getTime() + 86_400_000);
    const invoices = await prisma.invoice.findMany({
      where: { id: { notIn: historicalIds }, status: { in: ["UNPAID", "PARTIAL"] }, dueDate: { gte: day, lt: next } },
      include: { customer: { select: { name: true, email: true, phone: true } } },
    });
    for (const inv of invoices) {
      await publish(TOPICS.NOTIFICATION_SEND, inv.tenantId, makeEnvelope(inv.tenantId, {
        template: t.template,
        customerId: inv.customerId,
        to: { email: inv.customer.email, phone: inv.customer.phone },
        vars: {
          customerName: inv.customer.name,
          invoiceNumber: inv.invoiceNumber,
          amount: (Number(inv.grandTotal) - Number(inv.amountPaid)).toFixed(2),
          dueDate: inv.dueDate.toLocaleDateString("en-IN"),
        },
      }));
    }
    if (invoices.length) log.info({ template: t.template, count: invoices.length }, "reminders queued");
  }
}

/** Nightly full DB backup with retention (needs pg_dump on the host). */
async function autoBackup(): Promise<void> {
  const dir = process.env.BACKUP_DIR ?? "backups";
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
  const file = join(dir, `auto-${stamp}.dump`);
  await runPgDump(file);
  const keep = Number(process.env.BACKUP_KEEP ?? 14);
  const dumps = readdirSync(dir)
    .filter((f) => f.startsWith("auto-") && f.endsWith(".dump"))
    .map((f) => ({ f, t: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  for (const old of dumps.slice(keep)) rmSync(join(dir, old.f), { force: true });
  log.info({ file, kept: Math.min(dumps.length, keep) }, "nightly backup written");
}

// ── cron wiring
cron.schedule(process.env.CRON_BACKUP ?? "0 2 * * *", () => {
  void autoBackup().catch((e) => log.error({ err: String(e) }, "nightly backup failed"));
});

cron.schedule(process.env.CRON_PREPAID ?? "0 1 1 * *", () => {
  const now = new Date();
  void publishBilling("PREPAID", now.getFullYear(), now.getMonth()).catch((e) => log.error(String(e)));
});

cron.schedule(process.env.CRON_POSTPAID ?? "0 23 28-31 * *", () => {
  const now = new Date();
  const tomorrow = new Date(now.getTime() + 86_400_000);
  if (tomorrow.getDate() !== 1) return; // only on the true last day
  void publishBilling("POSTPAID", now.getFullYear(), now.getMonth()).catch((e) => log.error(String(e)));
});

cron.schedule(process.env.CRON_REMINDERS ?? "0 9 * * *", () => {
  void dueReminders().catch((e) => log.error(String(e)));
});

const stopOps = startOpsServer({ name: "scheduler", port: Number(process.env.SCHEDULER_OPS_PORT ?? 9104), checks: [{ name: "db", check: async () => { await prisma.$queryRaw`SELECT 1`; } }] });
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => { stopOps(); void prisma.$disconnect().finally(() => process.exit(0)); });
}
log.info("scheduler started (backup 02:00 · prepaid 1st 01:00 · postpaid month-end 23:00 · reminders 09:00)");
