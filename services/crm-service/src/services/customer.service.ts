import bcrypt from "bcryptjs";
import { Prisma, allocateNumber, forTenant, prisma, rankParties, type PartyListQuery } from "@fii/database";
import { badRequest, conflict, isValidGstin, notFound } from "@fii/common";
import type { z } from "zod";
import type { customerBody } from "../validators.js";

type CustomerInput = z.infer<typeof customerBody>;

export function validateGst(input: Pick<CustomerInput, "gstin" | "gstTreatment" | "stateCode">): void {
  if (input.gstTreatment === "B2B" && !input.gstin) {
    throw badRequest("B2B customers require a GSTIN");
  }
  if (input.gstin && !isValidGstin(input.gstin, input.stateCode)) {
    throw badRequest("Invalid GSTIN (or state-code mismatch)");
  }
}

export async function listCustomers(
  tenantId: string,
  q: PartyListQuery,
) {
  const ranked = await rankParties(tenantId, "CUSTOMER", q);
  const items = await prisma.customer.findMany({
      where: { tenantId, id: { in: ranked.items.map((item) => item.id) } },
      include: { _count: { select: { subscribers: true } }, portalUser: { select: { id: true, status: true } } },
  });
  const byId = new Map(items.map((item) => [item.id, item]));
  // Held source invoices have no ledger postings. Flag their customers rather than
  // presenting a partially migrated ledger as a fully reconciled closing balance.
  const held = items.length ? await prisma.legacyRecord.findMany({
    where: { tenantId, status: "REVIEW", sourceTable: "user_bills" },
    select: { data: true },
  }) : [];
  const heldByParty = new Map<string, number>();
  const origins = items.length ? await prisma.legacyRecord.findMany({
    where: { tenantId, sourceTable: "user_cust_vendor_details", targetModel: "Customer", targetId: { in: items.map((item) => item.id) } },
    select: { sourceId: true, targetId: true },
  }) : [];
  const customerBySource = new Map(origins.map((origin) => [origin.sourceId, origin.targetId!]));
  for (const item of items) if (item.code.startsWith("LISOFT-C-")) customerBySource.set(item.code.slice("LISOFT-C-".length), item.id);
  for (const record of held) {
    const source = record.data as Record<string, unknown> | null;
    if (source && typeof source.billto === "string") {
      const id = customerBySource.get(source.billto);
      if (id) heldByParty.set(id, (heldByParty.get(id) ?? 0) + 1);
    }
  }
  return { items: ranked.items.flatMap((rank) => {
    const item = byId.get(rank.id);
    return item ? [{ ...item, invoiceCount: rank.invoiceCount,
      currentOutstanding: rank.outstanding.toFixed(2),
      ledgerOutstanding: rank.ledgerOutstanding.toFixed(2),
      heldInvoiceCount: heldByParty.get(item.id) ?? 0,
    }] : [];
  }), total: ranked.total, page: q.page, limit: q.limit };
}

export async function getCustomer(tenantId: string, id: string) {
  const customer = await prisma.customer.findFirst({
    where: { id, tenantId },
    include: {
      subscribers: { include: { plans: { where: { endDate: null }, include: { plan: true } } } },
      portalUser: { select: { id: true, email: true, status: true, lastLoginAt: true } },
    },
  });
  if (!customer) throw notFound("Customer");
  return customer;
}

export async function createCustomer(tenantId: string, input: CustomerInput) {
  validateGst(input);
  try {
    return await prisma.$transaction(async (tx) => {
      // Serialize quota checks for concurrent imports belonging to this tenant.
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { maxCustomers: true } });
      const customerCount = await tx.customer.count({ where: { tenantId } });
      if (customerCount >= tenant.maxCustomers) throw conflict(`Customer license limit reached (${tenant.maxCustomers})`);
      const code = await allocateNumber(tx, tenantId, "CUSTOMER");
      return tx.customer.create({
        data: { ...input, openingBalance: new Prisma.Decimal(input.openingBalance), tenantId, code },
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw conflict("A customer with this phone number already exists");
    }
    throw err;
  }
}

export async function updateCustomer(tenantId: string, id: string, input: Partial<CustomerInput>) {
  const db = forTenant(prisma, tenantId);
  const existing = await db.customer.findFirst({ where: { id } });
  if (!existing) throw notFound("Customer");
  const portalUser = await prisma.user.findFirst({ where: { tenantId, customerId: id, userType: "CUSTOMER" } });
  if (portalUser && input.email !== undefined && !input.email) throw badRequest("Primary email is required for this customer's portal account");
  validateGst({
    gstin: "gstin" in input ? input.gstin : existing.gstin ?? undefined,
    gstTreatment: input.gstTreatment ?? (existing.gstTreatment as CustomerInput["gstTreatment"]),
    stateCode: input.stateCode ?? existing.stateCode ?? undefined,
  });
  try {
    return await prisma.$transaction(async (tx) => {
      if (portalUser && input.email && input.email !== existing.email) {
        await tx.user.update({ where: { id: portalUser.id }, data: { email: input.email } });
        await tx.refreshToken.updateMany({ where: { userId: portalUser.id, revokedAt: null }, data: { revokedAt: new Date() } });
      }
      return tx.customer.update({
        where: { id },
        data: {
          ...input,
          gstin: "gstin" in input ? input.gstin ?? null : undefined,
          openingBalance: input.openingBalance !== undefined ? new Prisma.Decimal(input.openingBalance) : undefined,
        },
      });
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw conflict("Customer phone or portal email is already in use");
    }
    throw err;
  }
}

/** Enable/disable customer portal login. Creates the portal User on first enable. */
export async function setPortalAccess(
  tenantId: string,
  id: string,
  enable: boolean,
  password?: string,
) {
  const customer = await prisma.customer.findFirst({ where: { id, tenantId }, include: { portalUser: true } });
  if (!customer) throw notFound("Customer");

  if (!enable) {
    await prisma.customer.update({ where: { id }, data: { portalEnabled: false } });
    if (customer.portalUser) {
      await prisma.user.update({ where: { id: customer.portalUser.id }, data: { status: "INACTIVE" } });
      await prisma.refreshToken.updateMany({
        where: { userId: customer.portalUser.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { enabled: false };
  }

  if (!customer.email) throw badRequest("Customer needs an email address for portal access");

  if (customer.portalUser) {
    await prisma.user.update({
      where: { id: customer.portalUser.id },
      data: {
        status: "ACTIVE",
        ...(password ? { passwordHash: await bcrypt.hash(password, 12) } : {}),
      },
    });
  } else {
    if (!password) throw badRequest("Password required to create portal access");
    const customerRole = await prisma.role.findFirst({ where: { tenantId: null, code: "CUSTOMER" } });
    await prisma.user.create({
      data: {
        tenantId,
        userType: "CUSTOMER",
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        passwordHash: await bcrypt.hash(password, 12),
        customerId: customer.id,
        ...(customerRole ? { roles: { create: { roleId: customerRole.id } } } : {}),
      },
    });
  }
  await prisma.customer.update({ where: { id }, data: { portalEnabled: true } });
  return { enabled: true };
}
