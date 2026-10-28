import { Prisma, prisma } from "@fii/database";
import { badRequest, conflict, notFound } from "@fii/common";
import type { z } from "zod";
import type { planBody } from "../validators.js";

type PlanInput = z.infer<typeof planBody>;

export async function listPlans(tenantId: string, includeInactive = false) {
  return prisma.plan.findMany({
    where: { tenantId, ...(includeInactive ? {} : { isActive: true }) },
    orderBy: { name: "asc" },
    include: { _count: { select: { subscriberPlans: { where: { endDate: null } } } } },
  });
}

export async function createPlan(tenantId: string, input: PlanInput) {
  try {
    return await prisma.plan.create({
      data: {
        ...input,
        code: input.code.toUpperCase(),
        price: new Prisma.Decimal(input.price),
        gstRate: new Prisma.Decimal(input.gstRate),
        tenantId,
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw conflict("Plan code already exists");
    }
    throw err;
  }
}

export async function updatePlan(tenantId: string, id: string, input: Partial<PlanInput>) {
  const existing = await prisma.plan.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("Plan");
  return prisma.plan.update({
    where: { id },
    data: {
      ...input,
      code: input.code?.toUpperCase(),
      price: input.price !== undefined ? new Prisma.Decimal(input.price) : undefined,
      gstRate: input.gstRate !== undefined ? new Prisma.Decimal(input.gstRate) : undefined,
    },
  });
}

export async function deletePlan(tenantId: string, id: string) {
  const existing = await prisma.plan.findFirst({ where: { id, tenantId } });
  if (!existing) throw notFound("Plan");
  const active = await prisma.subscriberPlan.count({ where: { planId: id, endDate: null } });
  if (active > 0) throw badRequest(`Plan has ${active} active subscriber(s) — deactivate instead`);
  await prisma.plan.update({ where: { id }, data: { isActive: false } });
}
