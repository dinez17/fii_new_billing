import PDFDocument from "pdfkit";
import type { Writable } from "node:stream";
import { prisma } from "@fii/database";
import { notFound } from "@fii/common";

const inr = (v: unknown) => `Rs. ${Number(v).toFixed(2)}`;
const num = (v: unknown) => Number(v);

type Component = { name: string; amount: number };
const toComponents = (v: unknown): Component[] =>
  Array.isArray(v) ? (v as Component[]).map((c) => ({ name: String(c.name), amount: Number(c.amount || 0) })) : [];

async function loadPayslip(tenantId: string, payslipId: string) {
  const payslip = await prisma.payslip.findFirst({
    where: { id: payslipId, tenantId },
    include: {
      employee: { include: { department: { select: { name: true } } } },
      payrollRun: true,
    },
  });
  if (!payslip) throw notFound("Payslip");
  const tenant = await prisma.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  return { payslip, tenant };
}

type Loaded = Awaited<ReturnType<typeof loadPayslip>>;
export type PayslipWithRelations = Loaded["payslip"];

export function payslipFileName(p: PayslipWithRelations): string {
  const period = `${p.payrollRun.year}-${String(p.payrollRun.month).padStart(2, "0")}`;
  return `payslip-${p.employee.code}-${period}`;
}

function renderPayslip(doc: PDFKit.PDFDocument, payslip: Loaded["payslip"], tenant: Loaded["tenant"]): void {
  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const W = right - left;
  const monthName = new Date(Date.UTC(payslip.payrollRun.year, payslip.payrollRun.month - 1, 1))
    .toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });

  // ── Header
  doc.fontSize(16).font("Helvetica-Bold").fillColor("#000").text(tenant.name, { align: "center" });
  doc.fontSize(8).font("Helvetica").fillColor("#444");
  const addr = [tenant.addressLine1, tenant.city, tenant.phone].filter(Boolean).join(" · ");
  if (addr) doc.text(addr, { align: "center" });
  doc.moveDown(0.4);
  doc.fontSize(12).font("Helvetica-Bold").fillColor("#000")
    .text(`PAYSLIP — ${monthName}`, { align: "center" });
  doc.moveDown(0.8);

  // ── Employee meta (two columns)
  const metaTop = doc.y;
  const colW = W / 2;
  const metaRow = (label: string, value: string, col: 0 | 1, row: number) => {
    const x = left + col * colW;
    const y = metaTop + row * 14;
    doc.fontSize(9).font("Helvetica-Bold").fillColor("#000").text(`${label}: `, x, y, { continued: true, width: colW - 6 });
    doc.font("Helvetica").fillColor("#333").text(value || "-");
  };
  metaRow("Employee", payslip.employee.name, 0, 0);
  metaRow("Code", payslip.employee.code, 1, 0);
  metaRow("Designation", payslip.employee.designation ?? "-", 0, 1);
  metaRow("Department", payslip.employee.department?.name ?? "-", 1, 1);
  metaRow("Pay period", monthName, 0, 2);
  metaRow("Status", payslip.status + (payslip.paidMode ? ` (${payslip.paidMode})` : ""), 1, 2);
  metaRow("Present days", String(num(payslip.presentDays)), 0, 3);
  metaRow("LOP days", String(num(payslip.lopDays)), 1, 3);
  // Working days = calendar days − Sundays (Sunday is the weekly off; pay basis).
  const y0 = payslip.payrollRun.year;
  const m0 = payslip.payrollRun.month;
  const daysInMonth = new Date(Date.UTC(y0, m0, 0)).getUTCDate();
  let sundays = 0;
  for (let d = 1; d <= daysInMonth; d++) {
    if (new Date(Date.UTC(y0, m0 - 1, d)).getUTCDay() === 0) sundays++;
  }
  metaRow("Working days", `${daysInMonth - sundays} (excl. ${sundays} Sundays)`, 0, 4);
  doc.y = metaTop + 5 * 14 + 6;

  // ── Earnings / Deductions table
  const earnings: Component[] = [
    { name: "Basic", amount: num(payslip.basicSalary) },
    ...toComponents(payslip.allowances),
  ];
  if (num(payslip.overtimePay) > 0) earnings.push({ name: "Overtime", amount: num(payslip.overtimePay) });

  const deductions: Component[] = [...toComponents(payslip.deductions)];
  if (num(payslip.leaveDeduction) > 0) deductions.push({ name: "Loss of pay", amount: num(payslip.leaveDeduction) });

  const totalEarnings = earnings.reduce((s, c) => s + c.amount, 0);
  const totalDeductions = deductions.reduce((s, c) => s + c.amount, 0);

  const half = W / 2;
  const amtW = 90;
  const tableTop = doc.y;

  const headerCell = (label: string, x: number) => {
    doc.rect(x, tableTop, half, 18).fillAndStroke("#f0f0f0", "#cccccc");
    doc.fillColor("#000").fontSize(9.5).font("Helvetica-Bold").text(label, x + 6, tableTop + 5, { width: half - 12 });
  };
  headerCell("Earnings", left);
  headerCell("Deductions", left + half);

  let yL = tableTop + 18;
  let yR = tableTop + 18;
  doc.fontSize(9).font("Helvetica").fillColor("#000");
  const drawRows = (rows: Component[], x: number, startY: number): number => {
    let y = startY;
    for (const r of rows) {
      doc.font("Helvetica").fillColor("#333").text(r.name, x + 6, y + 4, { width: half - amtW - 12 });
      doc.text(inr(r.amount), x + half - amtW - 6, y + 4, { width: amtW, align: "right" });
      y += 15;
    }
    return y;
  };
  yL = drawRows(earnings, left, yL);
  yR = drawRows(deductions, left + half, yR);

  const bodyBottom = Math.max(yL, yR) + 2;
  // total row
  doc.rect(left, bodyBottom, half, 18).stroke("#cccccc");
  doc.rect(left + half, bodyBottom, half, 18).stroke("#cccccc");
  doc.font("Helvetica-Bold").fillColor("#000");
  doc.text("Total Earnings", left + 6, bodyBottom + 5, { width: half - amtW - 12 });
  doc.text(inr(totalEarnings), left + half - amtW - 6, bodyBottom + 5, { width: amtW, align: "right" });
  doc.text("Total Deductions", left + half + 6, bodyBottom + 5, { width: half - amtW - 12 });
  doc.text(inr(totalDeductions), left + W - amtW - 6, bodyBottom + 5, { width: amtW, align: "right" });

  // outer borders
  doc.rect(left, tableTop, half, bodyBottom + 18 - tableTop).stroke("#cccccc");
  doc.rect(left + half, tableTop, half, bodyBottom + 18 - tableTop).stroke("#cccccc");

  doc.y = bodyBottom + 30;

  // ── Net pay banner
  const netTop = doc.y;
  doc.rect(left, netTop, W, 30).fillAndStroke("#0f2a4a", "#0f2a4a");
  doc.fillColor("#ffffff").fontSize(11).font("Helvetica-Bold")
    .text("NET PAY", left + 10, netTop + 9, { continued: true });
  doc.text(inr(payslip.netSalary), left, netTop + 9, { width: W - 10, align: "right" });
  doc.fillColor("#000");

  doc.moveDown(3);
  doc.fontSize(7.5).font("Helvetica").fillColor("#888")
    .text("This is a system-generated payslip and does not require a signature.", left, doc.y, { width: W, align: "center" });
}

export async function streamPayslipPdf(
  tenantId: string,
  payslipId: string,
  out: Writable,
  onLoaded?: (payslip: PayslipWithRelations) => void,
): Promise<PayslipWithRelations> {
  const { payslip, tenant } = await loadPayslip(tenantId, payslipId);
  onLoaded?.(payslip);
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  doc.pipe(out);
  renderPayslip(doc, payslip, tenant);
  doc.end();
  return payslip;
}

export async function buildPayslipPdfBuffer(
  tenantId: string,
  payslipId: string,
): Promise<{ buffer: Buffer; payslip: PayslipWithRelations }> {
  const { payslip, tenant } = await loadPayslip(tenantId, payslipId);
  const doc = new PDFDocument({ size: "A4", margin: 40 });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  renderPayslip(doc, payslip, tenant);
  doc.end();
  return { buffer: await done, payslip };
}
