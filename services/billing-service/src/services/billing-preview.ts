import { prisma } from "@fii/database";
import { billingCycleSpan, computeGst } from "@fii/common";

export async function previewBilling(tenantId: string, input: {
  year: number; month: number; cycleType: "PREPAID" | "POSTPAID";
  taxMode: "ALL" | "GST" | "WITHOUT_GST"; page: number; limit: number;
}) {
  const start = new Date(Date.UTC(input.year, input.month - 1, 1));
  const end = new Date(Date.UTC(input.year, input.month, 0));
  const invoiceDate = input.cycleType === "PREPAID" ? start : end;
  return prisma.$transaction(async tx => {
    const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    const fy = await tx.financialYear.findFirst({ where: { tenantId, startDate: { lte: invoiceDate }, endDate: { gte: invoiceDate } } });
    const where = { tenantId, subscriberType: input.cycleType,
      ...(input.taxMode === "ALL" ? {} : { chargeGst: input.taxMode === "GST" }) };
    const total = await tx.subscriber.count({ where });
    const subscribers = await tx.subscriber.findMany({ where, orderBy: { code: "asc" },
      skip: (input.page - 1) * input.limit, take: input.limit,
      include: { customer: true, plans: { where: { endDate: null }, include: { plan: true } } } });
    const items = [];
    for (const sub of subscribers) {
      const mappings = sub.plans.filter(p => p.startDate <= end);
      const serviceStart = mappings.length ? new Date(Math.min(...mappings.map(p => p.startDate.getTime()))) : sub.activationDate;
      const span = billingCycleSpan(input.cycleType, serviceStart, sub.billingCycleMonths, start, end);
      let reason = sub.status !== "ACTIVE" ? "Subscriber is not active" : !sub.customer.isActive ? "Customer is inactive"
        : !tenant.stateCode ? "Company state code is missing" : !fy ? "Financial year is missing" : fy.isLocked ? "Financial year is locked"
        : !span ? "Not due: outside cycle boundary or initial partial period" : !mappings.length ? "No active plan for this period" : "";
      if (!reason && span && mappings.some(p => p.startDate > span.spanStart && sub.billingCycleMonths > 1)) reason = "Connection starts inside this period; review initial manual billing";
      const overlaps = span ? await tx.invoice.findMany({ where: { tenantId, subscriberId: sub.id,
        OR: [{ status: { not: "CANCELLED" }, periodStart: { lte: span.spanEnd }, periodEnd: { gte: span.spanStart } }, { invoiceType: "SUBSCRIPTION", periodStart: span.spanStart }] }, select: { invoiceNumber: true } }) : [];
      if (!reason && overlaps.length) reason = `Already covered by ${overlaps.map(i => i.invoiceNumber).join(", ")}`;
      const totals = span && mappings.length ? computeGst(mappings.map(p => ({ quantity: sub.billingCycleMonths,
        unitPrice: Number(p.priceOverride ?? p.plan.price), discount: 0, gstRate: sub.chargeGst ? Number(p.plan.gstRate) : 0 })),
        (sub.customer.stateCode ?? tenant.stateCode) !== tenant.stateCode) : null;
      items.push({ subscriberId: sub.id, code: sub.code, customer: sub.customer.name, chargeGst: sub.chargeGst,
        cycleMonths: sub.billingCycleMonths, serviceStart, periodStart: span?.spanStart ?? null,
        periodEnd: span?.spanEnd ?? null, invoiceDate, amount: totals?.grandTotal ?? null,
        eligible: !reason, reason: reason || "Ready to invoice" });
    }
    return { items, total, page: input.page, limit: input.limit, readOnly: true };
  }, { isolationLevel: "RepeatableRead", timeout: 30000 });
}
