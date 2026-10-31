import { Prisma, allocateNumber, prisma } from "@fii/database";
import { badRequest, notFound, billingCycleSpan } from "@fii/common";
import type { z } from "zod";
import type { subscriberCreateBody, subscriberListQuery } from "../validators.js";

type CreateInput = z.infer<typeof subscriberCreateBody>;
type ListQuery = z.infer<typeof subscriberListQuery>;

export async function listSubscribers(tenantId: string, q: ListQuery) {
  const where: Prisma.SubscriberWhereInput = {
    tenantId,
    ...(q.status ? { status: q.status } : {}),
    ...(q.subscriberType ? { subscriberType: q.subscriberType } : {}),
    ...(q.customerId ? { customerId: q.customerId } : {}),
    ...(q.search
      ? {
          OR: [
            { code: { contains: q.search, mode: "insensitive" } },
            { poNumber: { contains: q.search, mode: "insensitive" } },
            { customer: { name: { contains: q.search, mode: "insensitive" } } },
            { customer: { phone: { contains: q.search } } },
          ],
        }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.subscriber.findMany({
      where,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      orderBy: { createdAt: "desc" },
      include: {
        customer: { select: { id: true, name: true, phone: true, isActive: true } },
        plans: { where: { endDate: null }, include: { plan: true } },
      },
    }),
    prisma.subscriber.count({ where }),
  ]);
  const today = new Date(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date()));
  const invoices = await prisma.invoice.findMany({ where: { tenantId, subscriberId: { in: items.map(s => s.id) }, periodEnd: { gte: today } },
    select: { subscriberId: true, periodStart: true, periodEnd: true, status: true, invoiceType: true } });
  const enriched = items.map(sub => {
    const serviceStart = sub.plans.length ? new Date(Math.min(...sub.plans.map(p => p.startDate.getTime()))) : sub.activationDate;
    let nextBilling: { invoiceDate: Date; periodStart: Date; periodEnd: Date } | null = null;
    if (sub.status === "ACTIVE" && sub.customer.isActive && sub.plans.length) for (let offset = -11; offset < 25; offset++) {
      const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() + offset, 1));
      const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0));
      const span = billingCycleSpan(sub.subscriberType, serviceStart, sub.billingCycleMonths, start, end);
      if (!span || span.spanEnd < today) continue;
      if (sub.plans.some(p => p.startDate <= span.spanEnd && p.startDate > span.spanStart && sub.billingCycleMonths > 1)) continue;
      if (invoices.some(i => i.subscriberId === sub.id && i.periodStart && i.periodEnd && ((i.status !== "CANCELLED" && i.periodStart <= span.spanEnd && i.periodEnd >= span.spanStart) || (i.invoiceType === "SUBSCRIPTION" && i.periodStart.getTime() === span.spanStart.getTime())))) continue;
      nextBilling = { invoiceDate: sub.subscriberType === "PREPAID" ? span.spanStart : span.spanEnd, periodStart: span.spanStart, periodEnd: span.spanEnd };
      break;
    }
    return { ...sub, nextBilling };
  });
  return { items: enriched, total, page: q.page, limit: q.limit };
}

export async function getSubscriber(tenantId: string, id: string) {
  const sub = await prisma.subscriber.findFirst({
    where: { id, tenantId },
    include: {
      customer: true,
      plans: { include: { plan: true }, orderBy: { startDate: "desc" } },
    },
  });
  if (!sub) throw notFound("Subscriber");
  return sub;
}

export async function createSubscriber(tenantId: string, input: CreateInput) {
  const customer = await prisma.customer.findFirst({ where: { id: input.customerId, tenantId, isActive: true } });
  if (!customer) throw notFound("Customer");

  // plans are usable by both prepaid and postpaid subscribers
  const plans = await prisma.plan.findMany({
    where: { id: { in: input.plans.map((p) => p.planId) }, tenantId, isActive: true },
  });
  const planById = new Map(plans.map((p) => [p.id, p]));
  for (const sel of input.plans) {
    if (!planById.get(sel.planId)) throw notFound("Plan");
  }

  return prisma.$transaction(async (tx) => {
    const code = await allocateNumber(tx, tenantId, "SUBSCRIBER");
    return tx.subscriber.create({
      data: {
        tenantId,
        customerId: input.customerId,
        code,
        poNumber: input.poNumber,
        subscriberType: input.subscriberType,
        billingCycleMonths: input.billingCycleMonths,
        activationDate: input.activationDate,
        installAddress: input.installAddress,
        meta: input.meta,
        chargeGst: input.chargeGst,
        plans: {
          create: input.plans.map((sel) => ({
            tenantId,
            planId: sel.planId,
            location: sel.location || null,
            startDate: input.activationDate,
            priceOverride: sel.priceOverride !== undefined ? new Prisma.Decimal(sel.priceOverride) : undefined,
          })),
        },
      },
      include: { plans: { include: { plan: true } } },
    });
  });
}

/** Attach an additional plan to a subscriber. */
export async function addPlan(
  tenantId: string,
  id: string,
  input: { planId: string; startDate: Date; priceOverride?: number; location?: string },
) {
  const sub = await prisma.subscriber.findFirst({ where: { id, tenantId } });
  if (!sub) throw notFound("Subscriber");
  if (sub.status === "TERMINATED") throw badRequest("Subscriber is terminated");

  const plan = await prisma.plan.findFirst({ where: { id: input.planId, tenantId, isActive: true } });
  if (!plan) throw notFound("Plan");

  return prisma.subscriberPlan.create({
    data: {
      tenantId,
      subscriberId: id,
      planId: input.planId,
      location: input.location || null,
      startDate: input.startDate,
      priceOverride: input.priceOverride !== undefined ? new Prisma.Decimal(input.priceOverride) : undefined,
    },
    include: { plan: true },
  });
}

export async function updatePlanLocation(tenantId: string, subscriberId: string, mappingId: string, location: string | null) {
  return updateSubscriberPlan(tenantId, subscriberId, mappingId, { location });
}

export async function updateSubscriberPlan(tenantId: string, subscriberId: string, mappingId: string,
  input: { planId?: string; location?: string | null; priceOverride?: number | null; startDate?: Date }) {
  const mapping = await prisma.subscriberPlan.findFirst({ where: { id: mappingId, tenantId, subscriberId, endDate: null, subscriber: { tenantId, status: { not: "TERMINATED" } } } });
  if (!mapping) throw notFound("Active plan mapping");
  if (input.planId && input.planId !== mapping.planId && !await prisma.plan.findFirst({ where: { id: input.planId, tenantId, isActive: true } })) throw notFound("Plan");
  return prisma.subscriberPlan.update({ where: { id: mappingId }, data: {
    planId: input.planId, startDate: input.startDate,
    location: input.location === undefined ? undefined : input.location || null,
    priceOverride: input.priceOverride === undefined ? undefined : input.priceOverride === null ? null : new Prisma.Decimal(input.priceOverride),
  }, include: { plan: true } });
}

/** End one active plan mapping (subscriber keeps any others). */
export async function endPlan(tenantId: string, subscriberId: string, mappingId: string, endDate: Date) {
  const mapping = await prisma.subscriberPlan.findFirst({
    where: { id: mappingId, subscriberId, tenantId, endDate: null },
  });
  if (!mapping) throw notFound("Active plan mapping");
  if (endDate < mapping.startDate) throw badRequest("End date cannot precede the plan start date");
  return prisma.subscriberPlan.update({ where: { id: mappingId }, data: { endDate } });
}

const TRANSITIONS: Record<string, string[]> = {
  ACTIVE: ["SUSPENDED", "TERMINATED"],
  SUSPENDED: ["ACTIVE", "TERMINATED"],
  TERMINATED: [],
};

export async function setStatus(
  tenantId: string,
  id: string,
  status: "ACTIVE" | "SUSPENDED" | "TERMINATED",
) {
  const sub = await prisma.subscriber.findFirst({ where: { id, tenantId } });
  if (!sub) throw notFound("Subscriber");
  if (!TRANSITIONS[sub.status].includes(status)) {
    throw badRequest(`Cannot move from ${sub.status} to ${status}`);
  }

  if (status !== "TERMINATED") {
    return prisma.subscriber.update({ where: { id }, data: { status } });
  }

  // termination automatically ends every active plan mapping (history kept)
  const now = new Date();
  return prisma.$transaction(async (tx) => {
    await tx.subscriberPlan.updateMany({
      where: { subscriberId: id, endDate: null },
      data: { endDate: now },
    });
    return tx.subscriber.update({
      where: { id },
      data: { status: "TERMINATED", deactivationDate: now },
    });
  });
}
