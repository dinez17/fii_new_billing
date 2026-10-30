import { Prisma, PrismaClient } from "@prisma/client";

/**
 * Models that carry a `tenantId` column and must be tenant-scoped.
 * Child tables (InvoiceItem, PaymentAllocation, ...) are reached through
 * their tenant-scoped parents and are intentionally not listed.
 * `Role` is excluded because system roles have tenantId = null.
 */
export const TENANT_SCOPED_MODELS = new Set<string>([
  "User", "AuditLog", "LegacyRecord",
  "Customer", "Plan", "Subscriber", "SubscriberPlan",
  "FinancialYear", "NumberSeries",
  "BillingRun", "Invoice", "SalesDocument", "CreditNote", "DebitNote",
  "Payment", "Receipt",
  "Supplier", "PurchaseOrder", "Grn", "PurchaseInvoice",
  "PurchaseReturn", "SupplierPayment",
  "Product", "StockMovement",
  "ExpenseCategory", "ExpenseVendor", "Expense",
  "LedgerEntry", "DayBookEntry", "DayBookClosing",
  "Department", "Employee", "Attendance", "LeaveRequest",
  "PayrollRun", "Payslip",
  "Complaint", "Task",
  "Setting", "NotificationTemplate", "NotificationLog",
  "OutboxEvent", "ReportJob", "TenantLicenseEvent",
]);

const WHERE_OPS = new Set([
  "findMany", "findFirst", "findFirstOrThrow", "count", "aggregate",
  "groupBy", "updateMany", "deleteMany",
]);

/**
 * Returns a Prisma client whose every query on a tenant-scoped model is
 * constrained to `tenantId`. Use one instance per request:
 *   const db = forTenant(prisma, req.tenantId)
 *
 * Notes:
 * - findUnique is rewritten to findFirst so the tenant filter always applies.
 * - update/delete first verify row ownership, then act (2 queries; correctness
 *   over micro-optimisation — composite uniques already include tenantId for
 *   most business keys).
 */
export function forTenant(prisma: PrismaClient, tenantId: string) {
  if (!tenantId) throw new Error("forTenant: tenantId is required");

  return prisma.$extends({
    name: "tenant-scope",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          if (!model || !TENANT_SCOPED_MODELS.has(model)) return query(args);
          const a: any = args ?? {};

          if (WHERE_OPS.has(operation)) {
            a.where = { AND: [{ tenantId }, a.where ?? {}] };
            return query(a);
          }

          switch (operation) {
            case "findUnique":
            case "findUniqueOrThrow": {
              // rewrite to findFirst with tenant filter
              const delegate = (prisma as any)[
                model.charAt(0).toLowerCase() + model.slice(1)
              ];
              const fn = operation === "findUnique" ? "findFirst" : "findFirstOrThrow";
              return delegate[fn]({ ...a, where: { AND: [{ tenantId }, a.where] } });
            }
            case "create":
              a.data = { ...a.data, tenantId };
              return query(a);
            case "createMany":
              a.data = (Array.isArray(a.data) ? a.data : [a.data]).map(
                (d: object) => ({ ...d, tenantId }),
              );
              return query(a);
            case "upsert":
              a.create = { ...a.create, tenantId };
              a.where = a.where; // unique key must itself be tenant-composite
              return query(a);
            case "update":
            case "delete": {
              const delegate = (prisma as any)[
                model.charAt(0).toLowerCase() + model.slice(1)
              ];
              const found = await delegate.findFirst({
                where: { AND: [{ tenantId }, a.where] },
                select: { id: true },
              });
              if (!found) {
                throw new Prisma.PrismaClientKnownRequestError(
                  `No ${model} found for tenant`,
                  { code: "P2025", clientVersion: Prisma.prismaVersion.client },
                );
              }
              return query(a);
            }
            default:
              return query(a);
          }
        },
      },
    },
  });
}

export type TenantClient = ReturnType<typeof forTenant>;
