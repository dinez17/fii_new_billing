/* eslint-disable no-console */
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

// ── Permission matrix ────────────────────────────────────────────────
const MODULES = [
  "platform", "user", "role", "audit",
  "customer", "plan", "subscriber",
  "invoice", "billing_run", "credit_note", "debit_note",
  "payment", "receipt",
  "supplier", "purchase_order", "grn", "purchase_invoice", "purchase_return", "supplier_payment",
  "product", "stock",
  "expense",
  "ledger", "day_book", "financial_year", "report", "gst_report",
  "department", "employee", "attendance", "leave", "payroll",
  "complaint", "task",
  "settings", "notification_template", "backup",
] as const;

const ACTIONS = ["create", "read", "update", "delete", "export", "approve"] as const;

// role code → permission selector
const ROLE_MATRIX: Record<string, (m: string, a: string) => boolean> = {
  SUPER_ADMIN: () => true,
  ADMIN: (m) => m !== "platform",
  MANAGER: (m, a) => a !== "delete" && m !== "settings" && m !== "role" && m !== "backup",
  ACCOUNTANT: (m) =>
    ["invoice", "credit_note", "debit_note", "payment", "receipt", "expense",
      "ledger", "day_book", "financial_year", "report", "gst_report",
      "supplier_payment", "purchase_invoice", "customer", "supplier"].includes(m),
  BILLING_STAFF: (m, a) =>
    (["invoice", "payment", "receipt", "customer", "subscriber", "plan", "billing_run"].includes(m) &&
      a !== "delete"),
  TECHNICIAN: (m, a) =>
    (["complaint", "task"].includes(m) && ["read", "update"].includes(a)) ||
    (m === "stock" && a === "read"),
  SUPPORT_STAFF: (m, a) =>
    ["complaint", "task", "customer", "subscriber"].includes(m) && a !== "delete",
  HR: (m, a) =>
    ["department", "employee", "attendance", "leave", "payroll"].includes(m) && a !== "delete",
  CUSTOMER: () => false, // portal access is enforced by ownDataGuard, not module perms
};

async function main() {
  // 1. Permissions
  const perms: { module: string; action: string }[] = [];
  for (const m of MODULES) for (const a of ACTIONS) perms.push({ module: m, action: a });
  for (const p of perms) {
    await prisma.permission.upsert({
      where: { module_action: p },
      create: p,
      update: {},
    });
  }
  const allPerms = await prisma.permission.findMany();
  console.log(`permissions: ${allPerms.length}`);

  // 2. System roles (tenantId = null)
  for (const [code, selector] of Object.entries(ROLE_MATRIX)) {
    const role = await prisma.role.upsert({
      where: { tenantId_code: { tenantId: null as never, code } },
      create: { code, name: code.replace(/_/g, " "), isSystem: true },
      update: {},
    }).catch(async () => {
      const existing = await prisma.role.findFirst({ where: { tenantId: null, code } });
      return existing ?? prisma.role.create({ data: { code, name: code.replace(/_/g, " "), isSystem: true } });
    });

    const grant = allPerms.filter((p) => selector(p.module, p.action));
    await prisma.rolePermission.deleteMany({ where: { roleId: role.id } });
    await prisma.rolePermission.createMany({
      data: grant.map((p) => ({ roleId: role.id, permissionId: p.id })),
      skipDuplicates: true,
    });
    console.log(`role ${code}: ${grant.length} permissions`);
  }

  // 3. Demo tenant + tenant admin
  const sub = process.env.SEED_DEMO_TENANT ?? "demo";
  const tenant = await prisma.tenant.upsert({
    where: { subdomain: sub },
    create: {
      name: "Demo Broadband Pvt Ltd",
      subdomain: sub,
      stateCode: "33",
      gstin: null,
    },
    update: { licenseStatus: "ACTIVE", licenseStartsAt: new Date(), licenseEndsAt: new Date("2099-12-31"), planCode: "ENTERPRISE" },
  });

  const email = process.env.SEED_TENANT_ADMIN_EMAIL ?? process.env.SEED_SUPERADMIN_EMAIL ?? "admin@demo.local";
  const password = process.env.SEED_TENANT_ADMIN_PASSWORD ?? process.env.SEED_SUPERADMIN_PASSWORD ?? "ChangeMe@123";
  const adminRole = await prisma.role.findFirstOrThrow({ where: { tenantId: null, code: "ADMIN" } });
  const superAdminRole = await prisma.role.findFirstOrThrow({ where: { tenantId: null, code: "SUPER_ADMIN" } });

  const admin = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: tenant.id, email } },
    create: {
      tenantId: tenant.id,
      userType: "STAFF",
      name: "Demo Tenant Admin",
      email,
      passwordHash: await bcrypt.hash(password, 12),
    },
    update: {},
  });
  await prisma.userRole.deleteMany({ where: { userId: admin.id, roleId: superAdminRole.id } });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: adminRole.id } },
    create: { userId: admin.id, roleId: adminRole.id },
    update: {},
  });

  // Dedicated platform tenant + SUPER_ADMIN. Platform APIs require the
  // platform:* permission and never infer authority from a customer tenant.
  const platformTenant = await prisma.tenant.upsert({
    where: { subdomain: "platform" },
    create: { name: "FII Platform", subdomain: "platform", planCode: "PLATFORM", licenseStatus: "ACTIVE", licenseStartsAt: new Date(), licenseEndsAt: new Date("2099-12-31") },
    update: { isActive: true, licenseStatus: "ACTIVE", licenseEndsAt: new Date("2099-12-31") },
  });
  const platformEmail = process.env.SEED_PLATFORM_ADMIN_EMAIL ?? "superadmin@platform.local";
  const platformPassword = process.env.SEED_PLATFORM_ADMIN_PASSWORD;
  if (!platformPassword || platformPassword.length < 16) throw new Error("SEED_PLATFORM_ADMIN_PASSWORD must be set and at least 16 characters");
  const platformAdmin = await prisma.user.upsert({
    where: { tenantId_email: { tenantId: platformTenant.id, email: platformEmail } },
    create: { tenantId: platformTenant.id, userType: "STAFF", name: "Platform Super Admin", email: platformEmail, passwordHash: await bcrypt.hash(platformPassword, 12), emailVerifiedAt: new Date() },
    update: { status: "ACTIVE", passwordHash: await bcrypt.hash(platformPassword, 12) },
  });
  await prisma.userRole.deleteMany({ where: { userId: platformAdmin.id } });
  await prisma.userRole.create({ data: { userId: platformAdmin.id, roleId: superAdminRole.id } });

  // 4. Active financial year (Indian FY from current date)
  const now = new Date();
  const fyStartYear = now.getMonth() >= 3 ? now.getFullYear() : now.getFullYear() - 1;
  const fyCode = `${fyStartYear}-${String(fyStartYear + 1).slice(2)}`;
  await prisma.financialYear.upsert({
    where: { tenantId_code: { tenantId: tenant.id, code: fyCode } },
    create: {
      tenantId: tenant.id,
      code: fyCode,
      startDate: new Date(Date.UTC(fyStartYear, 3, 1)),
      endDate: new Date(Date.UTC(fyStartYear + 1, 2, 31)),
      isActive: true,
    },
    update: { isActive: true },
  });

  // 5. Default number series for the FY
  const seriesDefaults: Array<[string, string]> = [
    ["INVOICE", "INV"], ["RECEIPT", "RCT"], ["CREDIT_NOTE", "CRN"], ["DEBIT_NOTE", "DBN"],
    ["COMPLAINT", "CMP"], ["PURCHASE_ORDER", "PO"], ["PURCHASE_INVOICE", "PIN"],
    ["PAYMENT_VOUCHER", "PV"], ["QUOTATION", "QTN"],
  ];
  for (const [docType, prefix] of seriesDefaults) {
    await prisma.numberSeries.upsert({
      where: { tenantId_docType_fyCode: { tenantId: tenant.id, docType: docType as never, fyCode } },
      create: {
        tenantId: tenant.id,
        docType: docType as never,
        fyCode,
        prefix: `${prefix}/${fyCode}/`,
      },
      update: {},
    });
  }

  // 6. Permanent series (never reset by FY)
  for (const [docType, prefix] of [["CUSTOMER", "CUST-"], ["SUBSCRIBER", "SUB-"]] as const) {
    await prisma.numberSeries.upsert({
      where: { tenantId_docType_fyCode: { tenantId: tenant.id, docType, fyCode: "PERM" } },
      create: { tenantId: tenant.id, docType, fyCode: "PERM", prefix, padding: 5 },
      update: {},
    });
  }

  // 7. Default notification templates (EMAIL)
  const TEMPLATES: Array<[string, string, string]> = [
    ["INVOICE_GENERATED", "Invoice {{invoiceNumber}} — ₹{{amount}}",
      "Dear {{customerName}},\n\nYour invoice {{invoiceNumber}} for ₹{{amount}} has been generated.\nDue date: {{dueDate}}.\n\nPlease pay on time to avoid service interruption.\n\nThank you."],
    ["PAYMENT_RECEIVED", "Payment received — receipt {{receiptNumber}}",
      "Dear {{customerName}},\n\nWe have received your payment of ₹{{amount}}.\nReceipt number: {{receiptNumber}}.\n\nThank you."],
    ["PAYMENT_FAILED", "Payment failed",
      "Dear {{customerName}},\n\nYour recent payment attempt failed: {{reason}}.\nPlease try again from the customer portal.\n\nThank you."],
    ["DUE_REMINDER_UPCOMING", "Reminder: invoice {{invoiceNumber}} due {{dueDate}}",
      "Dear {{customerName}},\n\nInvoice {{invoiceNumber}} (₹{{amount}}) is due on {{dueDate}}.\n\nPlease pay before the due date.\n\nThank you."],
    ["DUE_REMINDER_TODAY", "Invoice {{invoiceNumber}} is due TODAY",
      "Dear {{customerName}},\n\nInvoice {{invoiceNumber}} (₹{{amount}}) is due today.\n\nPlease pay to avoid service interruption.\n\nThank you."],
    ["DUE_REMINDER_OVERDUE", "OVERDUE: invoice {{invoiceNumber}}",
      "Dear {{customerName}},\n\nInvoice {{invoiceNumber}} (₹{{amount}}) is overdue since {{dueDate}}.\nPlease pay immediately to avoid disconnection.\n\nThank you."],
    ["LOW_STOCK", "Low stock alert: {{productName}}",
      "Stock alert.\n\nProduct: {{productName}} ({{sku}})\nCurrent stock: {{balance}}\nReorder level: {{reorderLevel}}\n\nPlease reorder soon."],
    ["COMPLAINT_CREATED", "Complaint {{complaintNumber}} registered",
      "Dear {{customerName}},\n\nYour complaint has been registered.\nNumber: {{complaintNumber}}\nSubject: {{subject}}\n\nWe will resolve it as soon as possible."],
    ["COMPLAINT_ASSIGNED", "Complaint {{complaintNumber}} assigned to you",
      "Hi {{employeeName}},\n\nComplaint {{complaintNumber}} has been assigned to you.\nSubject: {{subject}}\n\nPlease attend to it before the SLA due time."],
    ["COMPLAINT_RESOLVED", "Complaint {{complaintNumber}} resolved",
      "Dear {{customerName}},\n\nYour complaint {{complaintNumber}} ({{subject}}) has been resolved.\n\nResolution: {{resolutionNotes}}\n\nThank you for your patience."],
  ];
  for (const [code, subject, body] of TEMPLATES) {
    await prisma.notificationTemplate.upsert({
      where: { tenantId_code_channel: { tenantId: tenant.id, code, channel: "EMAIL" } },
      create: { tenantId: tenant.id, code, channel: "EMAIL", subject, body },
      update: {},
    });
  }
  console.log(`templates: ${TEMPLATES.length}`);

  console.log(`seeded tenant "${sub}" (${tenant.id}), admin ${email}, FY ${fyCode}`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
