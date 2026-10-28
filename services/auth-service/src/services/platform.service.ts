import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import { Prisma, prisma } from "@fii/database";
import { conflict, notFound } from "@fii/common";

const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const fyFor = (date = new Date()) => {
  const start = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  return { code: `${start}-${String(start + 1).slice(2)}`, start: new Date(Date.UTC(start, 3, 1)), end: new Date(Date.UTC(start + 1, 2, 31)) };
};

export async function listTenants(q: { page: number; limit: number; search?: string; status?: string }) {
  const where = {
    subdomain: { not: "platform" },
    ...(q.search ? { OR: [{ name: { contains: q.search, mode: "insensitive" as const } }, { subdomain: { contains: q.search, mode: "insensitive" as const } }] } : {}),
    ...(q.status ? { licenseStatus: q.status as "TRIAL" | "ACTIVE" | "SUSPENDED" | "EXPIRED" | "CANCELLED" } : {}),
  };
  const [items, total] = await Promise.all([
    prisma.tenant.findMany({ where, skip: (q.page - 1) * q.limit, take: q.limit, orderBy: { createdAt: "desc" }, include: { _count: { select: { users: true, customers: true } } } }),
    prisma.tenant.count({ where }),
  ]);
  return { items, total, page: q.page, limit: q.limit };
}

export async function getTenant(id: string) {
  const tenant = await prisma.tenant.findFirst({ where: { id, subdomain: { not: "platform" } }, include: { _count: { select: { users: true, customers: true } }, licenseEvents: { orderBy: { createdAt: "desc" }, take: 50 } } });
  if (!tenant) throw notFound("Tenant");
  return tenant;
}

export async function createTenant(actorUserId: string, input: { name: string; subdomain: string; adminName: string; adminEmail: string; adminPassword: string; trialDays: number; maxUsers: number; maxCustomers: number }) {
  if (await prisma.tenant.findUnique({ where: { subdomain: input.subdomain } })) throw conflict("Subdomain already exists");
  const adminRole = await prisma.role.findFirstOrThrow({ where: { tenantId: null, code: "ADMIN" } });
  const fy = fyFor();
  const result = await prisma.$transaction(async (tx) => {
    const tenant = await tx.tenant.create({ data: {
      name: input.name, subdomain: input.subdomain, licenseStatus: "TRIAL",
      trialEndsAt: new Date(Date.now() + input.trialDays * 86_400_000), maxUsers: input.maxUsers, maxCustomers: input.maxCustomers,
    } });
    const admin = await tx.user.create({ data: { tenantId: tenant.id, userType: "STAFF", name: input.adminName, email: input.adminEmail, passwordHash: await bcrypt.hash(input.adminPassword, 12), roles: { create: { roleId: adminRole.id } } } });
    await tx.financialYear.create({ data: { tenantId: tenant.id, code: fy.code, startDate: fy.start, endDate: fy.end, isActive: true } });
    const defaults = [["CUSTOMER", "CUST-"], ["SUBSCRIBER", "SUB-"], ["INVOICE", "INV"], ["RECEIPT", "RCT"], ["CREDIT_NOTE", "CRN"], ["DEBIT_NOTE", "DBN"], ["COMPLAINT", "CMP"], ["PURCHASE_ORDER", "PO"], ["PURCHASE_INVOICE", "PIN"], ["PAYMENT_VOUCHER", "PV"], ["QUOTATION", "QTN"]] as const;
    await tx.numberSeries.createMany({ data: defaults.map(([docType, prefix]) => ({ tenantId: tenant.id, docType, fyCode: fy.code, prefix: `${prefix}/${fy.code}/`, nextNumber: 1, padding: 5 })) });
    await tx.tenantLicenseEvent.create({ data: { tenantId: tenant.id, action: "TENANT_CREATED", planCode: tenant.planCode, status: "TRIAL", endsAt: tenant.trialEndsAt, maxUsers: tenant.maxUsers, maxCustomers: tenant.maxCustomers, actorUserId } });
    return { tenant, admin: { id: admin.id, email: admin.email } };
  });
  return result;
}

export async function updateTenant(id: string, input: { name?: string; subdomain?: string; legalName?: string; email?: string; phone?: string }) {
  await getTenant(id);
  try {
    return await prisma.tenant.update({ where: { id }, data: input });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw conflict("Subdomain already exists. Choose a different subdomain.");
    }
    throw error;
  }
}

const adminWhere = (tenantId: string, id?: string) => ({ tenantId, ...(id ? { id } : {}), userType: "STAFF" as const,
  roles: { some: { role: { tenantId: null, code: "ADMIN" } }, none: { role: { code: "SUPER_ADMIN" } } } });
const adminSelect = { id: true, name: true, email: true, status: true, lastLoginAt: true } as const;

export async function listTenantAdmins(tenantId: string) {
  await getTenant(tenantId);
  return prisma.user.findMany({ where: adminWhere(tenantId), select: adminSelect, orderBy: { name: "asc" } });
}

export async function createTenantAdmin(actorId: string, tenantId: string, input: { name: string; email: string; password: string }) {
  await getTenant(tenantId);
  const passwordHash = await bcrypt.hash(input.password, 12);
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
      const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } });
      if (await tx.user.count({ where: { tenantId } }) >= tenant.maxUsers) throw conflict(`User license limit reached (${tenant.maxUsers})`);
      const role = await tx.role.findFirstOrThrow({ where: { tenantId: null, code: "ADMIN" } });
      const user = await tx.user.create({ data: { tenantId, name: input.name, email: input.email, passwordHash, userType: "STAFF", roles: { create: { roleId: role.id } } }, select: adminSelect });
      await tx.auditLog.create({ data: { tenantId, userId: actorId, action: "PLATFORM_ADMIN_CREATED", entity: "User", entityId: user.id, after: { name: user.name, email: user.email } } });
      return user;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw conflict("Email already in use in this tenant");
    throw error;
  }
}

export async function updateTenantAdmin(actorId: string, tenantId: string, userId: string, input: { name?: string; email?: string; password?: string }) {
  await getTenant(tenantId);
  const passwordHash = input.password ? await bcrypt.hash(input.password, 12) : undefined;
  try {
    return await prisma.$transaction(async (tx) => {
      const before = await tx.user.findFirst({ where: adminWhere(tenantId, userId), select: adminSelect });
      if (!before) throw notFound("Tenant admin");
      const user = await tx.user.update({ where: { id: userId }, data: { name: input.name, email: input.email,
        ...(input.email !== undefined && input.email !== before.email ? { emailVerifiedAt: null } : {}),
        ...(passwordHash ? { passwordHash, failedLogins: 0, lockoutUntil: null, ...(before.status === "LOCKED" ? { status: "ACTIVE" as const } : {}) } : {}),
      }, select: adminSelect });
      if (input.email !== undefined || passwordHash) {
        await tx.refreshToken.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
        await tx.accountToken.deleteMany({ where: { userId } });
      }
      await tx.auditLog.create({ data: { tenantId, userId: actorId, action: passwordHash ? "PLATFORM_ADMIN_PASSWORD_RESET" : "PLATFORM_ADMIN_UPDATED", entity: "User", entityId: userId,
        before: { name: before.name, email: before.email }, after: { name: user.name, email: user.email } } });
      return user;
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") throw conflict("Email already in use in this tenant");
    throw error;
  }
}

export async function updateLicense(actorUserId: string, id: string, input: { planCode: string; status: "TRIAL" | "ACTIVE" | "SUSPENDED" | "EXPIRED" | "CANCELLED"; startsAt?: Date; endsAt?: Date; maxUsers: number; maxCustomers: number; notes?: string }) {
  const tenant = await getTenant(id);
  const rawKey = `fii_${randomBytes(24).toString("base64url")}`;
  await prisma.$transaction([
    prisma.tenant.update({ where: { id }, data: { planCode: input.planCode, licenseStatus: input.status, licenseStartsAt: input.startsAt, licenseEndsAt: input.endsAt, licenseKeyHash: hash(rawKey), maxUsers: input.maxUsers, maxCustomers: input.maxCustomers, isActive: !["SUSPENDED", "EXPIRED", "CANCELLED"].includes(input.status), suspendedAt: input.status === "SUSPENDED" ? new Date() : null } }),
    prisma.tenantLicenseEvent.create({ data: { tenantId: id, action: "LICENSE_UPDATED", planCode: input.planCode, status: input.status, startsAt: input.startsAt, endsAt: input.endsAt, maxUsers: input.maxUsers, maxCustomers: input.maxCustomers, actorUserId, notes: input.notes } }),
  ]);
  return { tenantId: tenant.id, licenseKey: rawKey };
}

export async function suspendTenant(actorUserId: string, id: string, reason: string) {
  const tenant = await getTenant(id);
  await prisma.$transaction([
    prisma.tenant.update({ where: { id }, data: { isActive: false, licenseStatus: "SUSPENDED", suspendedAt: new Date(), suspensionReason: reason } }),
    prisma.refreshToken.updateMany({ where: { user: { tenantId: id }, revokedAt: null }, data: { revokedAt: new Date() } }),
    prisma.tenantLicenseEvent.create({ data: { tenantId: id, action: "TENANT_SUSPENDED", planCode: tenant.planCode, status: "SUSPENDED", startsAt: tenant.licenseStartsAt, endsAt: tenant.licenseEndsAt, maxUsers: tenant.maxUsers, maxCustomers: tenant.maxCustomers, actorUserId, notes: reason } }),
  ]);
}
