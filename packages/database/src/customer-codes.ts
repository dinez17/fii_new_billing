import type { Prisma } from "@prisma/client";
import { PERMANENT_FY } from "./number-series.js";

/** Run within a transaction. Uses the same tenant/series locks as customer creation. */
export async function syncCustomerCodePrefix(tx: Prisma.TransactionClient, tenantId: string, apply = false) {
  await tx.$queryRaw`SELECT id FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
  const key = { tenantId, docType: "CUSTOMER" as const, fyCode: PERMANENT_FY };
  const series = await tx.numberSeries.findUniqueOrThrow({ where: { tenantId_docType_fyCode: key } });
  await tx.$queryRaw`SELECT id FROM "NumberSeries" WHERE id = ${series.id} FOR UPDATE`;
  const customers = await tx.customer.findMany({ where: { tenantId }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  const pattern = new RegExp(`^${series.prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[0-9]{${series.padding},}$`);
  const used = new Set(customers.map((customer) => customer.code));
  let nextNumber = Math.max(series.nextNumber, ...customers.filter((customer) => pattern.test(customer.code)).map((customer) => Number(customer.code.slice(series.prefix.length)) + 1));
  const changes: Array<{ id: string; name: string; oldCode: string; newCode: string }> = [];
  for (const customer of customers) {
    if (pattern.test(customer.code)) continue;
    let code: string;
    do { code = `${series.prefix}${String(nextNumber++).padStart(series.padding, "0")}`; } while (used.has(code));
    used.add(code);
    changes.push({ id: customer.id, name: customer.name, oldCode: customer.code, newCode: code });
    if (apply) await tx.customer.update({ where: { id: customer.id }, data: { code } });
  }
  if (apply && nextNumber !== series.nextNumber) await tx.numberSeries.update({ where: { id: series.id }, data: { nextNumber } });
  return { prefix: series.prefix, padding: series.padding, nextNumber, customerCount: customers.length, changes };
}
