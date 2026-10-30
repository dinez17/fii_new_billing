import type { DocType, Prisma } from "@prisma/client";

/** fyCode for series that never reset (customer/subscriber codes). */
export const PERMANENT_FY = "PERM";

const DEFAULT_PREFIX: Partial<Record<DocType, string>> = {
  CUSTOMER: "CUST-",
  SUBSCRIBER: "SUB-",
};

/**
 * Allocates the next document number atomically. MUST be called inside a
 * transaction — the row-level lock taken by `update` guarantees no gaps or
 * duplicates under concurrency.
 */
export async function allocateNumber(
  tx: Prisma.TransactionClient,
  tenantId: string,
  docType: DocType,
  fyCode: string = PERMANENT_FY,
): Promise<string> {
  const key = { tenantId_docType_fyCode: { tenantId, docType, fyCode } };

  let series = await tx.numberSeries.findUnique({ where: key });
  if (!series) {
    try {
      series = await tx.numberSeries.create({
        data: {
          tenantId,
          docType,
          fyCode,
          prefix: DEFAULT_PREFIX[docType] ?? `${docType === "NON_GST_INVOICE" ? "NG" : docType === "PROFORMA_INVOICE" ? "PI" : docType.slice(0, 3)}/${fyCode}/`,
        },
      });
    } catch {
      series = await tx.numberSeries.findUniqueOrThrow({ where: key }); // lost the race
    }
  }

  const updated = await tx.numberSeries.update({
    where: { id: series.id },
    data: { nextNumber: { increment: 1 } },
  });
  const n = updated.nextNumber - 1;
  return `${updated.prefix}${String(n).padStart(updated.padding, "0")}`;
}
