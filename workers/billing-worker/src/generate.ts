import { Prisma, allocateNumber, prisma, termsFor } from "@fii/database";
import { computeGst, createLogger } from "@fii/common";
import { TOPICS, makeEnvelope } from "@fii/kafka";

const log = createLogger("billing-worker");
const DUE_DAYS = 10;
const PAGE = 200;

export interface RunSpec {
  taxMode?: "ALL" | "GST" | "WITHOUT_GST";
  tenantId: string;
  cycleType: "PREPAID" | "POSTPAID";
  periodStart: Date;
  periodEnd: Date;
}

const fmt = (d: Date) =>
  d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

const startOfMonthUTC = (d: Date, addMonths = 0) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + addMonths, 1));
const endOfMonthUTC = (d: Date, addMonths = 0) =>
  new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + addMonths + 1, 0));
const monthDiff = (from: Date, to: Date) =>
  (to.getUTCFullYear() - from.getUTCFullYear()) * 12 + (to.getUTCMonth() - from.getUTCMonth());

/**
 * Subscribers choose a billing frequency (1/3/6/12 months) anchored to their
 * activation month. The scheduler still runs monthly; a subscriber is "due"
 * in this run only when their cycle boundary lands on this month:
 *   PREPAID  → billed at the START of each N-month span
 *   POSTPAID → billed at the END of each N-month span
 * Returns null when not due.
 */
function cycleSpan(
  cycleType: "PREPAID" | "POSTPAID",
  activationDate: Date,
  cycleMonths: number,
  periodStart: Date,
  periodEnd: Date,
): { spanStart: Date; spanEnd: Date } | null {
  const n = Math.max(1, cycleMonths);
  const diff = monthDiff(startOfMonthUTC(activationDate), periodStart);
  if (diff < 0) return null; // activated after this period
  if (cycleType === "PREPAID") {
    if (diff % n !== 0) return null;
    return { spanStart: periodStart, spanEnd: endOfMonthUTC(periodStart, n - 1) };
  }
  // POSTPAID: bill when the span's last month completes
  if ((diff + 1) % n !== 0 || diff < n - 1) return null;
  return { spanStart: startOfMonthUTC(periodStart, -(n - 1)), spanEnd: periodEnd };
}

/**
 * Generates one billing run. Idempotent and re-runnable:
 * - BillingRun is unique per (tenant, cycle, periodStart, taxMode)
 * - per subscriber, an existing SUBSCRIPTION invoice for the period is
 *   detected and counted as success (DB unique constraint is the backstop)
 * Re-triggering the same period only creates the invoices that are missing.
 */
export async function processRun(spec: RunSpec): Promise<void> {
  const { tenantId, cycleType, periodStart, periodEnd } = spec;
  const taxMode = spec.taxMode ?? "ALL";
  if (!["ALL", "GST", "WITHOUT_GST"].includes(taxMode)) throw new Error("Invalid billing GST mode");

  const run = await prisma.billingRun.upsert({
    where: { tenantId_cycleType_periodStart_taxMode: { tenantId, cycleType, periodStart, taxMode } },
    create: { tenantId, cycleType, periodStart, periodEnd, taxMode, status: "RUNNING", startedAt: new Date() },
    update: { status: "RUNNING", startedAt: new Date(), finishedAt: null },
  });
  await prisma.billingRunItem.deleteMany({ where: { billingRunId: run.id } });

  const invoiceDate = cycleType === "PREPAID" ? periodStart : periodEnd;
  const dueDate = new Date(invoiceDate.getTime() + DUE_DAYS * 86_400_000);

  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
  const fy = await prisma.financialYear.findFirst({
    where: { tenantId, startDate: { lte: invoiceDate }, endDate: { gte: invoiceDate } },
  });

  const abort = async (reason: string) => {
    log.error({ tenantId, cycleType, reason }, "billing run aborted");
    await prisma.billingRun.update({
      where: { id: run.id },
      data: { status: "FAILED", finishedAt: new Date() },
    });
  };
  if (!tenant?.stateCode) return abort("company state code not set");
  if (!fy) return abort(`no financial year covers ${invoiceDate.toISOString()}`);
  if (fy.isLocked) return abort(`FY ${fy.code} is locked`);

  const invoiceTerms = await termsFor(tenantId, "INVOICE");

  let total = 0, ok = 0, failed = 0;
  let cursor: string | undefined;

  for (;;) {
    const subscribers = await prisma.subscriber.findMany({
      where: { tenantId, status: "ACTIVE", subscriberType: cycleType, ...(taxMode === "ALL" ? {} : { chargeGst: taxMode === "GST" }) },
      include: {
        customer: true,
        plans: { where: { endDate: null, startDate: { lte: periodEnd } }, include: { plan: true } },
        _count: { select: { plans: { where: { endDate: null } } } },
      },
      orderBy: { id: "asc" },
      take: PAGE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (subscribers.length === 0) break;
    cursor = subscribers[subscribers.length - 1].id;

    for (const sub of subscribers) {
      if (sub.plans.length === 0 && sub._count.plans > 0) continue; // all connections start in a later period
      // frequency check — quarterly/half-yearly/annual subscribers are only
      // due on their cycle boundary months; others are skipped silently
      // A saved connection can predate subscriber creation (historical billing).
      // Use the same service start shown by the subscriber list.
      const serviceStart = sub.plans.length
        ? sub.plans.reduce((earliest, mapping) => mapping.startDate < earliest ? mapping.startDate : earliest, sub.plans[0].startDate)
        : sub.activationDate;
      const span = cycleSpan(cycleType, serviceStart, sub.billingCycleMonths, periodStart, periodEnd);
      if (!span) continue;
      const { spanStart, spanEnd } = span;

      total++;
      try {
        const existing = await prisma.invoice.findFirst({
          where: { tenantId, subscriberId: sub.id, periodStart: spanStart, invoiceType: "SUBSCRIPTION" },
          select: { id: true },
        });
        if (existing) {
          ok++;
          await prisma.billingRunItem.create({
            data: { billingRunId: run.id, subscriberId: sub.id, invoiceId: existing.id, success: true, error: "already billed" },
          });
          continue;
        }

        const mappings = sub.plans;
        if (mappings.length === 0) throw new Error("no active plan mapped");
        if (!sub.customer.isActive) throw new Error("customer inactive");

        const placeOfSupply = sub.customer.stateCode ?? tenant.stateCode!;
        const isInterState = placeOfSupply !== tenant.stateCode;
        const cycleN = Math.max(1, sub.billingCycleMonths);
        // one invoice line per active plan; plan price is PER MONTH,
        // multiplied by the subscriber's billing frequency
        const totals = computeGst(
          mappings.map((m) => ({
            quantity: cycleN,
            unitPrice: Number(m.priceOverride ?? m.plan.price),
            discount: 0,
            gstRate: sub.chargeGst ? Number(m.plan.gstRate) : 0,
          })),
          isInterState,
        );

        const invoiceId = await prisma.$transaction(async (tx) => {
          const invoiceNumber = await allocateNumber(tx, tenantId, sub.chargeGst ? "INVOICE" : "NON_GST_INVOICE", fy.code);
          const invoice = await tx.invoice.create({
            data: {
              tenantId,
              invoiceNumber,
              invoiceType: "SUBSCRIPTION",
              fyCode: fy.code,
              customerId: sub.customerId,
              subscriberId: sub.id,
              poNumber: sub.poNumber,
              periodStart: spanStart,
              periodEnd: spanEnd,
              invoiceDate,
              dueDate,
              placeOfSupply,
              gstTreatment: sub.customer.gstTreatment,
              chargeGst: sub.chargeGst,
              isInterState,
              subTotal: totals.subTotal,
              discountTotal: totals.discountTotal,
              taxableValue: totals.taxableValue,
              cgst: totals.cgst,
              sgst: totals.sgst,
              igst: totals.igst,
              roundOff: totals.roundOff,
              grandTotal: totals.grandTotal,
              status: "UNPAID",
              terms: invoiceTerms,
              items: {
                create: mappings.map((m, i) => ({
                  description: `${m.plan.name}\n${m.location ? `${m.location} · ` : ""}${fmt(spanStart)} – ${fmt(spanEnd)}`,
                  hsnSac: m.plan.hsnSac,
                  quantity: new Prisma.Decimal(cycleN),
                  unitPrice: new Prisma.Decimal(Number(m.priceOverride ?? m.plan.price)),
                  discount: new Prisma.Decimal(0),
                  gstRate: sub.chargeGst ? m.plan.gstRate : new Prisma.Decimal(0),
                  taxableValue: totals.lines[i].taxableValue,
                  cgst: totals.lines[i].cgst,
                  sgst: totals.lines[i].sgst,
                  igst: totals.lines[i].igst,
                  lineTotal: totals.lines[i].lineTotal,
                })),
              },
            },
          });
          await tx.outboxEvent.create({
            data: {
              tenantId,
              topic: TOPICS.INVOICE_CREATED,
              eventKey: tenantId,
              payload: makeEnvelope(tenantId, {
                invoiceId: invoice.id,
                invoiceNumber,
                customerId: sub.customerId,
                invoiceDate: invoiceDate.toISOString(),
                fyCode: fy.code,
                grandTotal: totals.grandTotal,
                dueDate: dueDate.toISOString(),
              }) as unknown as Prisma.InputJsonValue,
            },
          });
          return invoice.id;
        });

        ok++;
        await prisma.billingRunItem.create({
          data: { billingRunId: run.id, subscriberId: sub.id, invoiceId, success: true },
        });
      } catch (err) {
        failed++;
        await prisma.billingRunItem.create({
          data: { billingRunId: run.id, subscriberId: sub.id, success: false, error: String(err).slice(0, 500) },
        });
      }
    }
  }

  await prisma.billingRun.update({
    where: { id: run.id },
    data: {
      status: failed === 0 ? "COMPLETED" : "COMPLETED_WITH_ERRORS",
      totalCount: total,
      successCount: ok,
      failedCount: failed,
      finishedAt: new Date(),
    },
  });
  log.info({ tenantId, cycleType, total, ok, failed }, "billing run finished");
}
