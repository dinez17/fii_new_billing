import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma as defaultClient } from "./client.js";

/**
 * Terms & conditions per document type, managed in Settings → Terms.
 * Falls back to the tenant-level invoiceTerms for INVOICE documents.
 */
export async function termsFor(
  tenantId: string,
  docType: "INVOICE" | "PROFORMA_INVOICE" | "QUOTATION" | "PURCHASE_ORDER" | "RECEIPT" | "CREDIT_NOTE" | "DEBIT_NOTE",
  client: PrismaClient | Prisma.TransactionClient = defaultClient,
): Promise<string | null> {
  const setting = await client.setting.findUnique({
    where: { tenantId_group_key: { tenantId, group: "TERMS", key: docType } },
  });
  if (setting?.value) return setting.value;
  if (docType === "INVOICE") {
    const tenant = await client.tenant.findUnique({ where: { id: tenantId }, select: { invoiceTerms: true } });
    return tenant?.invoiceTerms ?? null;
  }
  return null;
}
