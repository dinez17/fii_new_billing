import { Prisma, prisma } from "@fii/database";

const IST_OFFSET = 330 * 60_000;
const money = (value: unknown) => Math.round(Number(value ?? 0) * 100) / 100;
export function dashboardDates(now: Date) {
  const today = new Date(now.getTime() + IST_OFFSET).toISOString().slice(0, 10);
  const dateStart = new Date(today + "T00:00:00Z"), dateEnd = new Date(today + "T23:59:59.999Z");
  const month = today.slice(0, 7), monthStart = new Date(month + "-01T00:00:00Z");
  const instantStart = new Date(dateStart.getTime() - IST_OFFSET), instantEnd = new Date(dateEnd.getTime() - IST_OFFSET);
  const months = Array.from({ length: 6 }, (_, i) => new Date(Date.UTC(dateStart.getUTCFullYear(), dateStart.getUTCMonth() - 5 + i, 1)).toISOString().slice(0, 7));
  return { today, month, dateStart, dateEnd, monthStart, instantStart, instantEnd, months };
}

/** Calendar-date documents and timestamp receipts have deliberately separate boundaries. */
export async function businessDashboard(tenantId: string, now = new Date()) {
  const dates = dashboardDates(now);
  return prisma.$transaction(async tx => {
    const fy = await tx.financialYear.findFirst({ where: { tenantId, isActive: true }, select: { code: true, startDate: true, endDate: true, isLocked: true } });
    const fyDateEnd = fy ? new Date(fy.endDate.toISOString().slice(0, 10) + "T23:59:59.999Z") : dates.dateEnd;
    const fyFilter = fy ? Prisma.sql`AND "fyCode" = ${fy.code}` : Prisma.empty;
    const invoiceStatus = Prisma.sql`status IN ('UNPAID','PARTIAL','PAID')`;
    const remaining = Prisma.sql`GREATEST("grandTotal" - "amountPaid" - "creditedAmount", 0)`;
    const fromChart = new Date(dates.months[0] + "-01T00:00:00Z");
    const monthReceiptStart = new Date(dates.monthStart.getTime() - IST_OFFSET);
    const monthDocFrom = fy && fy.startDate > dates.monthStart ? fy.startDate : dates.monthStart;
    const monthDocTo = fyDateEnd < dates.dateEnd ? fyDateEnd : dates.dateEnd;
    const monthReceiptFrom = fy && new Date(fy.startDate.getTime() - IST_OFFSET) > monthReceiptStart ? new Date(fy.startDate.getTime() - IST_OFFSET) : monthReceiptStart;
    const fyReceiptEnd = fy ? new Date(fy.endDate.toISOString().slice(0, 10) + "T23:59:59.999+05:30") : dates.instantEnd;
    const monthReceiptTo = fyReceiptEnd < dates.instantEnd ? fyReceiptEnd : dates.instantEnd;
    const [todayReceipts, monthReceipts, monthInvoices, fiscalInvoices, fiscalReceipts, expenses, purchases,
      balances, aging, recentPayments, overdueInvoices, subscribers, complaints, lowStock, quotations, proformas, tasks, heldInvoices, monthlySales, monthlyCollections, purchaseDue] = await Promise.all([
      tx.payment.aggregate({ where: { tenantId, status: "SUCCESS", paymentDate: { gte: dates.instantStart, lte: dates.instantEnd } }, _sum: { amount: true }, _count: true }),
      tx.payment.aggregate({ where: { tenantId, status: "SUCCESS", paymentDate: { gte: monthReceiptFrom, lte: monthReceiptTo } }, _sum: { amount: true } }),
      tx.invoice.aggregate({ where: { tenantId, status: { in: ["UNPAID", "PARTIAL", "PAID"] }, ...(fy ? { fyCode: fy.code } : {}), invoiceDate: { gte: monthDocFrom, lte: monthDocTo } }, _sum: { grandTotal: true }, _count: true }),
      fy ? tx.invoice.aggregate({ where: { tenantId, fyCode: fy.code, status: { in: ["UNPAID", "PARTIAL", "PAID"] }, invoiceDate: { gte: fy.startDate, lte: fyDateEnd < dates.dateEnd ? fyDateEnd : dates.dateEnd } }, _sum: { grandTotal: true }, _count: true }) : null,
      fy ? tx.payment.aggregate({ where: { tenantId, status: "SUCCESS", paymentDate: { gte: new Date(fy.startDate.getTime() - IST_OFFSET), lte: new Date(Math.min(dates.instantEnd.getTime(), new Date(fy.endDate.toISOString().slice(0, 10) + "T23:59:59.999+05:30").getTime())) } }, _sum: { amount: true } }) : null,
      tx.expense.aggregate({ where: { tenantId, status: "RECORDED", ...(fy ? { fyCode: fy.code } : {}), expenseDate: { gte: monthDocFrom, lte: monthDocTo } }, _sum: { total: true }, _count: true }),
      tx.purchaseInvoice.aggregate({ where: { tenantId, status: { not: "CANCELLED" }, ...(fy ? { fyCode: fy.code } : {}), invoiceDate: { gte: monthDocFrom, lte: monthDocTo } }, _sum: { grandTotal: true }, _count: true }),
      tx.$queryRaw<Array<{ due: Prisma.Decimal; credit: Prisma.Decimal; active: number; inactive: number; dueCustomers: number; top: { id: string; name: string; code: string; amount: number; invoiceCount: number; isActive: boolean }[] }>>`
        WITH inv AS (SELECT "customerId", SUM(${remaining}) AS balance, COUNT(*) FILTER (WHERE ${remaining} > 0)::int AS count
          FROM "Invoice" WHERE "tenantId"=${tenantId} AND ${invoiceStatus} GROUP BY "customerId"),
        credits AS (SELECT p."customerId", SUM(GREATEST(p.amount - COALESCE(a.amount,0),0)) AS balance
          FROM "Payment" p LEFT JOIN LATERAL (SELECT SUM(amount) AS amount FROM "PaymentAllocation" WHERE "paymentId"=p.id) a ON TRUE
          WHERE p."tenantId"=${tenantId} AND p.status='SUCCESS' GROUP BY p."customerId"),
        balances AS (SELECT c.id,c.name,c.code,c."isActive",c."openingBalance"+COALESCE(i.balance,0)-COALESCE(p.balance,0) AS amount,COALESCE(i.count,0) AS "invoiceCount"
          FROM "Customer" c LEFT JOIN inv i ON i."customerId"=c.id LEFT JOIN credits p ON p."customerId"=c.id WHERE c."tenantId"=${tenantId})
        SELECT COALESCE(SUM(GREATEST(amount,0)),0) AS due,COALESCE(SUM(GREATEST(-amount,0)),0) AS credit,
          COUNT(*) FILTER (WHERE "isActive")::int AS active, COUNT(*) FILTER (WHERE NOT "isActive")::int AS inactive, COUNT(*) FILTER (WHERE amount>0)::int AS "dueCustomers",
          COALESCE((SELECT jsonb_agg(t) FROM (SELECT * FROM balances WHERE amount>0 ORDER BY amount DESC,name,id LIMIT 5) t),'[]'::jsonb) AS top FROM balances`,
      tx.$queryRaw<Array<{ bucket: string; amount: Prisma.Decimal; count: number }>>`SELECT CASE
        WHEN "dueDate">=${dates.dateStart} THEN 'notDue' WHEN "dueDate">=${new Date(dates.dateStart.getTime()-30*86_400_000)} THEN 'days1to30'
        WHEN "dueDate">=${new Date(dates.dateStart.getTime()-60*86_400_000)} THEN 'days31to60' WHEN "dueDate">=${new Date(dates.dateStart.getTime()-90*86_400_000)} THEN 'days61to90' ELSE 'days90plus' END AS bucket,
        SUM(${remaining}) AS amount,COUNT(*)::int AS count FROM "Invoice" WHERE "tenantId"=${tenantId} AND ${invoiceStatus} AND ${remaining}>0 AND "invoiceDate"<=${dates.dateEnd} GROUP BY bucket`,
      tx.payment.findMany({ where: { tenantId, status: "SUCCESS", paymentDate: { lte: dates.instantEnd } }, orderBy: [{ paymentDate: "desc" }, { id: "desc" }], take: 5, select: { id: true, amount: true, paymentDate: true, mode: true, customer: { select: { name: true } }, receipt: { select: { receiptNumber: true } } } }),
      tx.$queryRaw<Array<{ id: string; invoiceNumber: string; dueDate: Date; grandTotal: Prisma.Decimal; amountPaid: Prisma.Decimal; creditedAmount: Prisma.Decimal; chargeGst: boolean; customer: { name: string } }>>`
        SELECT i.id,i."invoiceNumber",i."dueDate",i."grandTotal",i."amountPaid",i."creditedAmount",i."chargeGst",jsonb_build_object('name',c.name) AS customer
        FROM "Invoice" i JOIN "Customer" c ON c.id=i."customerId" AND c."tenantId"=${tenantId}
        WHERE i."tenantId"=${tenantId} AND i.status IN ('UNPAID','PARTIAL') AND i."invoiceDate"<=${dates.dateEnd} AND i."dueDate"<${dates.dateStart}
        AND GREATEST(i."grandTotal"-i."amountPaid"-i."creditedAmount",0)>0 ORDER BY i."dueDate",i.id LIMIT 5`,
      tx.subscriber.groupBy({ by: ["status", "chargeGst"], where: { tenantId }, _count: true }),
      tx.complaint.count({ where: { tenantId, status: { notIn: ["RESOLVED", "CLOSED"] } } }),
      tx.product.count({ where: { tenantId, isActive: true, isService: false, stockQty: { lte: prisma.product.fields.reorderLevel } } }),
      tx.salesDocument.aggregate({ where: { tenantId, kind: "QUOTATION", status: "OPEN" }, _count: true, _sum: { grandTotal: true } }),
      tx.salesDocument.aggregate({ where: { tenantId, kind: "PROFORMA", status: "OPEN" }, _count: true, _sum: { grandTotal: true } }),
      tx.task.count({ where: { tenantId, status: { in: ["PENDING", "IN_PROGRESS"] }, dueDate: { lt: dates.dateStart } } }),
      tx.legacyRecord.count({ where: { tenantId, status: "REVIEW", sourceTable: "user_bills" } }),
      tx.$queryRaw<Array<{ month: string; total: Prisma.Decimal; gst: Prisma.Decimal; withoutGst: Prisma.Decimal }>>`SELECT to_char("invoiceDate",'YYYY-MM') AS month,SUM("grandTotal") AS total,
        COALESCE(SUM("grandTotal") FILTER (WHERE "chargeGst"),0) AS gst,COALESCE(SUM("grandTotal") FILTER (WHERE NOT "chargeGst"),0) AS "withoutGst"
        FROM "Invoice" WHERE "tenantId"=${tenantId} AND ${invoiceStatus} ${fyFilter} AND "invoiceDate">=${fromChart} AND "invoiceDate"<=${dates.dateEnd} GROUP BY month`,
      tx.$queryRaw<Array<{ month: string; total: Prisma.Decimal }>>`SELECT to_char("paymentDate" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Kolkata','YYYY-MM') AS month,SUM(amount) AS total
        FROM "Payment" WHERE "tenantId"=${tenantId} AND status='SUCCESS' AND "paymentDate">=${new Date(Math.max(fromChart.getTime()-IST_OFFSET, fy ? fy.startDate.getTime()-IST_OFFSET : 0))}
        AND "paymentDate"<=${fy ? new Date(Math.min(dates.instantEnd.getTime(),new Date(fy.endDate.toISOString().slice(0,10)+'T23:59:59.999+05:30').getTime())) : dates.instantEnd} GROUP BY month`,
      tx.$queryRaw<Array<{ amount: Prisma.Decimal; count: number }>>`SELECT COALESCE(SUM(GREATEST("grandTotal"-"amountPaid",0)),0) AS amount,COUNT(*)::int AS count FROM "PurchaseInvoice"
        WHERE "tenantId"=${tenantId} AND status IN ('UNPAID','PARTIAL') AND "grandTotal">"amountPaid"`,
    ]);
    const customer = balances[0];
    const agingMap = Object.fromEntries(aging.map(row => [row.bucket, { amount: money(row.amount), count: row.count }]));
    const overdue = aging.filter(row => row.bucket !== "notDue");
    return {
      generatedAt: now.toISOString(), timeZone: "Asia/Kolkata", today: dates.today, month: dates.month, financialYear: fy,
      todayCollection: money(todayReceipts._sum.amount), todayReceiptCount: todayReceipts._count,
      mtdSales: money(monthInvoices._sum.grandTotal), monthInvoiceCount: monthInvoices._count, monthCollections: money(monthReceipts._sum.amount),
      fiscalSales: fiscalInvoices ? money(fiscalInvoices._sum.grandTotal) : null, fiscalInvoiceCount: fiscalInvoices?._count ?? null, fiscalCollections: fiscalReceipts ? money(fiscalReceipts._sum.amount) : null,
      outstanding: money(customer.due), customerCredit: money(customer.credit), dueCustomers: customer.dueCustomers,
      customers: { active: customer.active, inactive: customer.inactive }, topCustomers: customer.top,
      overdue: { amount: money(overdue.reduce((sum, row) => sum + Number(row.amount), 0)), count: overdue.reduce((sum, row) => sum + row.count, 0) }, aging: agingMap,
      monthExpenses: money(expenses._sum.total), monthExpenseCount: expenses._count, monthPurchases: money(purchases._sum.grandTotal), monthPurchaseCount: purchases._count,
      purchaseBillsDue: money(purchaseDue[0].amount), purchaseBillsDueCount: purchaseDue[0].count,
      subscribers: { active: subscribers.filter(row => row.status === "ACTIVE").reduce((sum, row) => sum + row._count, 0), suspended: subscribers.filter(row => row.status === "SUSPENDED").reduce((sum, row) => sum + row._count, 0), terminated: subscribers.filter(row => row.status === "TERMINATED").reduce((sum, row) => sum + row._count, 0), gst: subscribers.filter(row => row.status === "ACTIVE" && row.chargeGst).reduce((sum, row) => sum + row._count, 0), withoutGst: subscribers.filter(row => row.status === "ACTIVE" && !row.chargeGst).reduce((sum, row) => sum + row._count, 0) },
      openComplaints: complaints, lowStock, overdueTasks: tasks, heldInvoices,
      quotations: { count: quotations._count, amount: money(quotations._sum.grandTotal) }, proformas: { count: proformas._count, amount: money(proformas._sum.grandTotal) },
      monthly: dates.months.map(month => { const sales = monthlySales.find(row => row.month === month), collections = monthlyCollections.find(row => row.month === month); return { month, sales: money(sales?.total), collected: money(collections?.total), gstSales: money(sales?.gst), withoutGstSales: money(sales?.withoutGst) }; }),
      recentPayments: recentPayments.map(row => ({ ...row, amount: money(row.amount) })),
      overdueInvoices: overdueInvoices.map(row => ({ ...row, balance: money(Math.max(Number(row.grandTotal)-Number(row.amountPaid)-Number(row.creditedAmount),0)) })).filter(row => row.balance>0),
    };
  }, { isolationLevel: "RepeatableRead", timeout: 30_000 });
}
