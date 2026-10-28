import { Prisma, allocateNumber, prisma } from "@fii/database";
import { badRequest, notFound } from "@fii/common";
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
        customer: { select: { id: true, name: true, phone: true } },
        plans: { where: { endDate: null }, include: { plan: true } },
      },
    }),
    prisma.subscriber.count({ where }),
  ]);
  return { items, total, page: q.page, limit: q.limit };
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
        plans: {
          create: input.plans.map((sel) => ({
            tenantId,
            planId: sel.planId,
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
  input: { planId: string; startDate: Date; priceOverride?: number },
) {
  const sub = await prisma.subscriber.findFirst({ where: { id, tenantId } });
  if (!sub) throw notFound("Subscriber");
  if (sub.status === "TERMINATED") throw badRequest("Subscriber is terminated");

  const plan = await prisma.plan.findFirst({ where: { id: input.planId, tenantId, isActive: true } });
  if (!plan) throw notFound("Plan");

  const alreadyActive = await prisma.subscriberPlan.findFirst({
    where: { subscriberId: id, planId: input.planId, endDate: null },
  });
  if (alreadyActive) throw badRequest(`Plan "${plan.name}" is already active on this subscriber`);

  return prisma.subscriberPlan.create({
    data: {
      tenantId,
      subscriberId: id,
      planId: input.planId,
      startDate: input.startDate,
      priceOverride: input.priceOverride !== undefined ? new Prisma.Decimal(input.priceOverride) : undefined,
    },
    include: { plan: true },
  });
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
