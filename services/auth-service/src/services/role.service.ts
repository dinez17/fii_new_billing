import { prisma } from "@fii/database";
import { badRequest, conflict, notFound } from "@fii/common";
import { invalidatePermCache } from "@fii/auth";
import { audit } from "./audit.service.js";

export async function listRoles(tenantId: string) {
  return prisma.role.findMany({
    where: { OR: [{ tenantId }, { tenantId: null, code: { not: "SUPER_ADMIN" } }] },
    include: { _count: { select: { users: true, permissions: true } } },
    orderBy: [{ isSystem: "desc" }, { name: "asc" }],
  });
}

export async function listPermissions() {
  return prisma.permission.findMany({
    where: { module: { not: "platform" } },
    orderBy: [{ module: "asc" }, { action: "asc" }],
  });
}

export async function getRole(tenantId: string, roleId: string) {
  const role = await prisma.role.findFirst({
    where: { id: roleId, OR: [{ tenantId }, { tenantId: null, code: { not: "SUPER_ADMIN" } }] },
    include: { permissions: { select: { permissionId: true } } },
  });
  if (!role) throw notFound("Role");
  return { ...role, permissionIds: role.permissions.map((p) => p.permissionId), permissions: undefined };
}

export async function createRole(tenantId: string, actorId: string, input: { code: string; name: string; description?: string; permissionIds: string[] }) {
  const exists = await prisma.role.findFirst({ where: { tenantId, code: input.code } });
  if (exists) throw conflict("Role code already exists");
  const allowed = await prisma.permission.count({ where: { id: { in: input.permissionIds }, module: { not: "platform" } } });
  if (allowed !== new Set(input.permissionIds).size) throw badRequest("Platform permissions cannot be assigned to tenant roles");
  const role = await prisma.role.create({
    data: {
      tenantId,
      code: input.code,
      name: input.name,
      description: input.description,
      permissions: { create: input.permissionIds.map((permissionId) => ({ permissionId })) },
    },
  });
  await audit({ tenantId, userId: actorId, action: "ROLE_CREATE", entity: "Role", entityId: role.id, after: input });
  return { id: role.id };
}

export async function updateRolePermissions(tenantId: string, actorId: string, roleId: string, permissionIds: string[]) {
  const role = await prisma.role.findFirst({ where: { id: roleId, OR: [{ tenantId }, { tenantId: null }] } });
  if (!role) throw notFound("Role");
  if (role.isSystem) throw badRequest("System roles cannot be modified — clone into a tenant role instead");
  const allowed = await prisma.permission.count({ where: { id: { in: permissionIds }, module: { not: "platform" } } });
  if (allowed !== new Set(permissionIds).size) throw badRequest("Platform permissions cannot be assigned to tenant roles");

  await prisma.$transaction([
    prisma.rolePermission.deleteMany({ where: { roleId } }),
    prisma.rolePermission.createMany({ data: permissionIds.map((permissionId) => ({ roleId, permissionId })) }),
  ]);
  invalidatePermCache(roleId);
  await audit({ tenantId, userId: actorId, action: "ROLE_PERMISSIONS_UPDATE", entity: "Role", entityId: roleId, after: { permissionIds } });
}

export async function deleteRole(tenantId: string, actorId: string, roleId: string) {
  const role = await prisma.role.findFirst({ where: { id: roleId, tenantId } });
  if (!role) throw notFound("Role");
  if (role.isSystem) throw badRequest("System roles cannot be deleted");
  const inUse = await prisma.userRole.count({ where: { roleId } });
  if (inUse > 0) throw badRequest(`Role assigned to ${inUse} user(s)`);
  await prisma.role.delete({ where: { id: roleId } });
  invalidatePermCache(roleId);
  await audit({ tenantId, userId: actorId, action: "ROLE_DELETE", entity: "Role", entityId: roleId });
}
