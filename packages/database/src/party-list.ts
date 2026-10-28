import { Prisma } from "@prisma/client";
import { prisma } from "./client.js";

export interface PartyListQuery {
  page: number; limit: number; search?: string;
  activity?: "all" | "active" | "inactive";
  balance?: "all" | "due" | "settled" | "credit";
  sortBy?: "name" | "code" | "invoiceCount" | "outstanding" | "createdAt" | "status";
  order?: "asc" | "desc";
}

/** Aggregate before pagination; never sort a single page in memory. */
export async function rankParties(tenantId: string, type: "CUSTOMER" | "SUPPLIER", query: PartyListQuery) {
  const customer = type === "CUSTOMER";
  const party = Prisma.raw(customer ? '"Customer"' : '"Supplier"');
  const invoices = Prisma.raw(customer ? '"Invoice"' : '"PurchaseInvoice"');
  const partyKey = Prisma.raw(customer ? '"customerId"' : '"supplierId"');
  const debit = Prisma.sql`COALESCE(l.debit, 0)`;
  const credit = Prisma.sql`COALESCE(l.credit, 0)`;
  const search = `%${(query.search ?? "").replace(/[\\%_]/g, "\\$&")}%`;
  const remaining = customer
    ? Prisma.sql`GREATEST("grandTotal" - "amountPaid" - "creditedAmount", 0)`
    : Prisma.sql`GREATEST("grandTotal" - "amountPaid", 0)`;
  const cte = Prisma.sql`WITH ranked AS (
    SELECT p.id, p.name, p.code, p."createdAt", p."isActive",
      COALESCE(i.count, 0)::int AS "invoiceCount",
      ${customer ? Prisma.sql`COALESCE(i.due, 0)` : Prisma.sql`p."openingBalance" + ${credit} - ${debit}`} AS outstanding,
      p."openingBalance" + ${customer ? debit : credit} - ${customer ? credit : debit} AS "ledgerOutstanding"
    FROM ${party} p
    LEFT JOIN (SELECT ${partyKey} AS id, COUNT(*) AS count, SUM(${remaining}) AS due FROM ${invoices}
      WHERE "tenantId" = ${tenantId}
      ${customer ? Prisma.sql`AND status <> 'CANCELLED' AND ${remaining} > 0` : Prisma.empty}
      GROUP BY ${partyKey}) i ON i.id = p.id
    LEFT JOIN (SELECT "partyId", SUM(debit) AS debit, SUM(credit) AS credit FROM "LedgerEntry"
      WHERE "tenantId" = ${tenantId} AND "partyType"::text = ${type} GROUP BY "partyId") l ON l."partyId" = p.id
    WHERE p."tenantId" = ${tenantId}
      ${query.search ? Prisma.sql`AND (p.name ILIKE ${search} OR p.code ILIKE ${search} OR p.phone ILIKE ${search})` : Prisma.empty}
      ${query.activity && query.activity !== "all" ? Prisma.sql`AND p."isActive" = ${query.activity === "active"}` : Prisma.empty}
  ), filtered AS (SELECT * FROM ranked WHERE TRUE
    ${query.balance === "due" ? Prisma.sql`AND outstanding > 0` : query.balance === "credit" ? Prisma.sql`AND outstanding < 0` : query.balance === "settled" ? Prisma.sql`AND outstanding = 0` : Prisma.empty}
  )`;
  const columns = { name: 'name', code: 'code', invoiceCount: '"invoiceCount"', outstanding: 'outstanding', createdAt: '"createdAt"', status: '"isActive"' };
  const sortBy = query.sortBy ?? (customer ? "createdAt" : "name");
  if (!(sortBy in columns)) throw new Error("Invalid party sort column");
  const direction = query.order ?? (customer ? "desc" : "asc");
  if (direction !== "asc" && direction !== "desc") throw new Error("Invalid party sort direction");
  const [items, counts] = await prisma.$transaction([
    prisma.$queryRaw<Array<{ id: string; invoiceCount: number; outstanding: Prisma.Decimal; ledgerOutstanding: Prisma.Decimal }>>`${cte}
      SELECT id, "invoiceCount", outstanding, "ledgerOutstanding" FROM filtered
      ORDER BY ${Prisma.raw(columns[sortBy])} ${Prisma.raw(direction)}, name ASC, id ASC
      LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
    prisma.$queryRaw<Array<{ total: number }>>`${cte} SELECT COUNT(*)::int AS total FROM filtered`,
  ], { isolationLevel: "RepeatableRead" });
  return { items, total: counts[0].total };
}
