import { prisma } from "@fii/database";
import { notFound } from "@fii/common";

export function licenseSummary(tenant: { isActive: boolean; licenseStatus: string; trialEndsAt: Date | null; licenseEndsAt: Date | null }, now = new Date()) {
  const validUntil = tenant.licenseStatus === "TRIAL" ? tenant.trialEndsAt : tenant.licenseEndsAt;
  const expired = ["TRIAL", "ACTIVE"].includes(tenant.licenseStatus) && validUntil !== null && validUntil < now;
  const effectiveStatus = !tenant.isActive && !["SUSPENDED", "EXPIRED", "CANCELLED"].includes(tenant.licenseStatus)
    ? "SUSPENDED" : expired ? "EXPIRED" : tenant.licenseStatus;
  return { effectiveStatus, validUntil, daysRemaining: validUntil ? Math.max(0, Math.ceil((validUntil.getTime() - now.getTime()) / 86_400_000)) : null };
}

export async function getTenantLicense(tenantId: string) {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: {
    name: true, subdomain: true, planCode: true, licenseStatus: true, isActive: true,
    licenseStartsAt: true, licenseEndsAt: true, trialEndsAt: true, maxUsers: true, maxCustomers: true,
    _count: { select: { users: true, customers: true } },
  } });
  if (!tenant) throw notFound("Tenant");
  const { _count, ...details } = tenant;
  return { ...details, ...licenseSummary(tenant), usage: { users: _count.users, customers: _count.customers } };
}
