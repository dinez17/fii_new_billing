import { prisma, type Tenant } from "@fii/database";
import { badRequest, NON_GST_COMPANY_FIELDS } from "@fii/common";

/** Applies a display profile only; accounting ownership always remains the authenticated tenant. */
export function resolveInvoiceCompany(tenant: Tenant, chargeGst: boolean, profile: Record<string, string>): Tenant {
  if (chargeGst || profile.enabled !== "true") return tenant;
  if (!profile.name?.trim() || profile.name.trim().length < 2) throw badRequest("Complete the without-GST company profile in Settings before generating this document");
  const company = { ...tenant, gstin: null };
  for (const key of NON_GST_COMPANY_FIELDS) {
    Object.assign(company, { [key]: key === "name" ? profile.name.trim() : profile[key]?.trim() || null });
  }
  return company;
}

export async function loadInvoiceCompany(tenantId: string, chargeGst: boolean): Promise<Tenant> {
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  if (chargeGst) return tenant;
  const rows = await prisma.setting.findMany({ where: { tenantId, group: "NON_GST_COMPANY" } });
  return resolveInvoiceCompany(tenant, false, Object.fromEntries(rows.map(row => [row.key, row.value])));
}
