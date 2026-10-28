import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { Prisma, forTenant, prisma } from "@fii/database";
import { conflict, notFound } from "@fii/common";
import { audit } from "./audit.service.js";

export interface UpsertUserInput {
  name: string;
  email: string;
  phone?: string;
  password?: string;
  roleIds: string[];
  status?: "ACTIVE" | "INACTIVE" | "LOCKED";
  employeeId?: string;
}

export async function listUsers(tenantId: string, q: { page: number; limit: number; search?: string }) {
  const where: Prisma.UserWhereInput = {
    tenantId,
    userType: "STAFF",
    ...(q.search
      ? { OR: [{ name: { contains: q.search, mode: "insensitive" } }, { email: { contains: q.search, mode: "insensitive" } }] }
      : {}),
  };
  const [items, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip: (q.page - 1) * q.limit,
      take: q.limit,
      orderBy: { createdAt: "desc" },
      select: {
        id: true, name: true, email: true, phone: true, status: true, lastLoginAt: true,
        roles: { select: { role: { select: { id: true, code: true, name: true } } } },
      },
    }),
    prisma.user.count({ where }),
  ]);
  return { items: items.map((u) => ({ ...u, roles: u.roles.map((r) => r.role) })), total, page: q.page, limit: q.limit };
}

export async function createUser(tenantId: string, actorId: string, input: UpsertUserInput) {
  const [tenant, userCount] = await Promise.all([
    prisma.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { maxUsers: true } }),
    prisma.user.count({ where: { tenantId } }),
  ]);
  if (userCount >= tenant.maxUsers) throw conflict(`User license limit reached (${tenant.maxUsers})`);
  await assertAssignableRoles(tenantId, input.roleIds);
  const exists = await prisma.user.findUnique({
    where: { tenantId_email: { tenantId, email: input.email } },
  });
  if (exists) throw conflict("Email already in use");

  const user = await prisma.user.create({
    data: {
      tenantId,
      userType: "STAFF",
      name: input.name,
      email: input.email,
      phone: input.phone,
      status: input.status ?? "ACTIVE",
      employeeId: input.employeeId,
      passwordHash: await bcrypt.hash(input.password ?? cryptoRandom(), 12),
      roles: { create: input.roleIds.map((roleId) => ({ roleId })) },
    },
  });
  await audit({ tenantId, userId: actorId, action: "USER_CREATE", entity: "User", entityId: user.id, after: { name: input.name, email: input.email, roleIds: input.roleIds } });
  return { id: user.id };
}

export async function updateUser(tenantId: string, actorId: string, id: string, input: Partial<UpsertUserInput>) {
  const db = forTenant(prisma, tenantId);
  const before = await db.user.findFirst({ where: { id }, include: { roles: true } });
  if (!before) throw notFound("User");
  if (input.roleIds) await assertAssignableRoles(tenantId, input.roleIds);

  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id },
      data: {
        name: input.name,
        phone: input.phone,
        status: input.status,
        ...(input.password ? { passwordHash: await bcrypt.hash(input.password, 12) } : {}),
      },
    });
    if (input.roleIds) {
      await tx.userRole.deleteMany({ where: { userId: id } });
      await tx.userRole.createMany({ data: input.roleIds.map((roleId) => ({ userId: id, roleId })) });
    }
  });
  await audit({ tenantId, userId: actorId, action: "USER_UPDATE", entity: "User", entityId: id, after: input as object });
}

export async function resetUserPassword(tenantId: string, actorId: string, id: string, newPassword: string) {
  const db = forTenant(prisma, tenantId);
  const user = await db.user.findFirst({ where: { id } });
  if (!user) throw notFound("User");
  await prisma.user.update({
    where: { id },
    data: { passwordHash: await bcrypt.hash(newPassword, 12), failedLogins: 0, status: "ACTIVE" },
  });
  await prisma.refreshToken.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
  await audit({ tenantId, userId: actorId, action: "USER_PASSWORD_RESET", entity: "User", entityId: id });
}

function cryptoRandom(): string {
  return randomBytes(24).toString("base64url");
}

async function assertAssignableRoles(tenantId: string, roleIds: string[]): Promise<void> {
  const unique = [...new Set(roleIds)];
  const count = await prisma.role.count({
    where: {
      id: { in: unique },
      OR: [{ tenantId }, { tenantId: null, code: { not: "SUPER_ADMIN" } }],
    },
  });
  if (count !== unique.length) throw conflict("One or more roles cannot be assigned in this tenant");
}
