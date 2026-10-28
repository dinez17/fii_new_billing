import { FinancialReportPeriod, useFinancialReportPeriod } from "../../components/FinancialReportPeriod";
import { DateInput } from "../../components/DateInput";
import { formatDate } from "../../lib/date";
import { ListTable } from "../../components/ListPagination";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";

export type ReportType = "SALES" | "PURCHASES" | "COLLECTIONS" | "OUTSTANDING" | "PROFIT_LOSS";
interface ReportDef { key: ReportType; label: string; endpoint: string; ranged: boolean }
const REPORTS: Record<ReportType, ReportDef> = {
  SALES: { key: "SALES", label: "Sales Report", endpoint: "/reports/sales", ranged: true },
  PURCHASES: { key: "PURCHASES", label: "Purchase Report", endpoint: "/reports/purchases", ranged: true },
  COLLECTIONS: { key: "COLLECTIONS", label: "Collections Report", endpoint: "/reports/collections", ranged: true },
  OUTSTANDING: { key: "OUTSTANDING", label: "Outstanding Report", endpoint: "/reports/outstanding", ranged: false },
  PROFIT_LOSS: { key: "PROFIT_LOSS", label: "Profit & Loss", endpoint: "/reports/profit-loss", ranged: true },
};
const inr = (v: unknown) => `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const firstOfMonth = () => { const d = new Date(); return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString().slice(0, 10); };

interface Table { columns: string[]; rows: (string | number)[][]; summary: [string, string][]; }

/* eslint-disable @typescript-eslint/no-explicit-any */
function toTable(type: ReportType, data: any): Table {
  const money = (v: unknown) => inr(v);
  switch (type) {
    case "SALES":
      return {
        columns: ["Invoice", "Date", "Customer", "Taxable", "Total", "Paid", "Status"],
        rows: (data.rows ?? []).map((r: any) => [r.invoiceNumber, formatDate(r.invoiceDate), r.customer?.name ?? "", money(r.taxableValue), money(r.grandTotal), money(r.amountPaid), r.status]),
        summary: [["Invoices", String(data.summary.count)], ["Taxable", money(data.summary.taxableValue)], ["Grand total", money(data.summary.grandTotal)], ["Collected", money(data.summary.collected)], ["Outstanding", money(data.summary.outstanding)]],
      };
    case "PURCHASES":
      return {
        columns: ["Our No", "Bill No", "Date", "Supplier", "Taxable", "Total", "Status"],
        rows: (data.rows ?? []).map((r: any) => [r.ourNumber, r.billNumber, formatDate(r.invoiceDate), r.supplier?.name ?? "", money(r.taxableValue), money(r.grandTotal), r.status]),
        summary: [["Bills", String(data.summary.count)], ["Taxable", money(data.summary.taxableValue)], ["Grand total", money(data.summary.grandTotal)], ["Payable", money(data.summary.payable)]],
      };
    case "COLLECTIONS":
      return {
        columns: ["Date", "Receipt", "Customer", "Mode", "Reference", "Amount"],
        rows: (data.rows ?? []).map((r: any) => [formatDate(r.paymentDate), r.receipt?.receiptNumber ?? "-", r.customer?.name ?? "", r.mode, r.reference ?? "", money(r.amount)]),
        summary: [["Total", money(data.summary.total)], ...data.summary.byMode.map((m: any) => [m.mode, money(m.amount)] as [string, string])],
      };
    case "OUTSTANDING":
      return {
        columns: ["Customer", "Phone", "Open", "Overdue", "Outstanding"],
        rows: (data.rows ?? []).map((r: any) => [r.name, r.phone, r.count, money(r.overdue), money(r.outstanding)]),
        summary: [["Customers", String(data.summary.customers)], ["Total outstanding", money(data.summary.totalOutstanding)]],
      };
    case "PROFIT_LOSS":
      return {
        columns: ["Line", "Amount"],
        rows: [
          ["Revenue (net of notes)", money(data.revenue)],
          ["Cost of goods (purchases)", money(data.cogs)],
          ["Gross profit", money(data.grossProfit)],
          ...(data.breakdown?.expenses ?? []).map((e: any) => [`  Expense — ${e.category}`, money(e.amount)] as [string, string]),
          ["Total expenses", money(data.expenseTotal)],
          ["Net profit", money(data.netProfit)],
        ],
        summary: [["Net profit", money(data.netProfit)]],
      };
    default:
      return { columns: [], rows: [], summary: [] };
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Reusable single-report view: date range, summary and table.
 *  Export buttons queue a job; the files live on the Exports page. */
export function ReportView({ reportKey }: { reportKey: ReportType }) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const hasPerm = useAuth((s) => s.hasPerm);
  const meta = REPORTS[reportKey];
  const period = useFinancialReportPeriod(() => {});
  const [fromSelection, setFrom] = useState<string | null>(null);
  const from = reportKey === "PROFIT_LOSS" ? period.from : fromSelection ?? firstOfMonth();
  const to = period.to;
  const setTo = period.setTo;
  const [queued, setQueued] = useState(false);
  const params = meta.ranged ? { from, to } : {};

  const report = useQuery({
    queryKey: ["report", reportKey, from, to],
    queryFn: async () => (await api.get(meta.endpoint, { params })).data,
    enabled: hasPerm("report:read") && (reportKey !== "PROFIT_LOSS" || period.ready),
  });

  const queueExport = useMutation({
    mutationFn: async (format: string) => { await api.post("/reports/export", { reportType: reportKey, format, filters: params }); },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["report-jobs"] });
      setQueued(true);
      setTimeout(() => setQueued(false), 6000);
    },
    onError: (err) => alert(errMessage(err)),
  });

  const table = report.data ? toTable(reportKey, report.data) : null;

  return (
    <>
      <h2 className="page-title">{meta.label}</h2>
      <div className="toolbar">
        {reportKey === "PROFIT_LOSS" ? <FinancialReportPeriod period={period} /> : meta.ranged && (
          <>
            <DateInput value={from} onChange={(e) => setFrom(e.target.value)} />
            <span style={{ color: "var(--muted)" }}>to</span>
            <DateInput value={to} onChange={(e) => setTo(e.target.value)} />
          </>
        )}
        <div className="spacer" />
        {hasPerm("report:export") && (
          <>
            {queued && (
              <span style={{ color: "var(--ok)", fontSize: 13 }}>
                Export queued —{" "}
                <a style={{ cursor: "pointer", textDecoration: "underline" }} onClick={() => navigate("/exports")}>
                  view in Exports
                </a>
              </span>
            )}
            <button className="small" disabled={queueExport.isPending} onClick={() => queueExport.mutate("CSV")}>Export CSV</button>
            <button className="small" disabled={queueExport.isPending} onClick={() => queueExport.mutate("PDF")}>Export PDF</button>
          </>
        )}
      </div>

      {table && (
        <>
          <div style={{ display: "flex", gap: 16, flexWrap: "wrap", margin: "4px 0 12px", color: "var(--muted)" }}>
            {table.summary.map(([k, v]) => <span key={k}><strong style={{ color: "var(--text)" }}>{v}</strong> {k}</span>)}
          </div>
          <ListTable>
            <thead><tr>{table.columns.map((c, i) => <th key={c} style={{ textAlign: i === 0 ? "left" : "right" }}>{c}</th>)}</tr></thead>
            <tbody>
              {table.rows.map((row, ri) => (
                <tr key={ri}>{row.map((cell, ci) => <td key={ci} style={{ textAlign: ci === 0 ? "left" : "right" }}>{cell}</td>)}</tr>
              ))}
              {table.rows.length === 0 && <tr><td colSpan={table.columns.length} style={{ color: "var(--muted)" }}>No data for this range.</td></tr>}
            </tbody>
          </ListTable>
        </>
      )}

    </>
  );
}

// ── One page per report
export const SalesReportPage = () => <ReportView reportKey="SALES" />;
export const PurchaseReportPage = () => <ReportView reportKey="PURCHASES" />;
export const CollectionsReportPage = () => <ReportView reportKey="COLLECTIONS" />;
export const OutstandingReportPage = () => <ReportView reportKey="OUTSTANDING" />;
export const ProfitLossPage = () => <ReportView reportKey="PROFIT_LOSS" />;
