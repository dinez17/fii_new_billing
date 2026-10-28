import { prisma } from "@fii/database";

export async function audit(entry: {
  tenantId: string;
  userId?: string;
  action: string;
  entity?: string;
  entityId?: string;
  before?: object;
  after?: object;
  ip?: string;
  userAgent?: string;
}): Promise<void> {
  await prisma.auditLog.create({
    data: {
      tenantId: entry.tenantId,
      userId: entry.userId,
      action: entry.action,
      entity: entry.entity,
      entityId: entry.entityId,
      before: entry.before,
      after: entry.after,
      ip: entry.ip,
      userAgent: entry.userAgent?.slice(0, 255),
    },
  });
}
