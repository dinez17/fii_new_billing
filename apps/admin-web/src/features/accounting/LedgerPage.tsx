import { FinancialReportPeriod, useFinancialReportPeriod } from "../../components/FinancialReportPeriod";
import { formatDate } from "../../lib/date";
import { ListTable } from "../../components/ListPagination";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";
import { EntitySelect } from "../../components/EntitySelect";

/* ── Customer / Supplier ledger with FY + date range, opening/closing ────── */

type PartyType = "CUSTOMER" | "SUPPLIER";
interface LedgerEntryRow {
  id: string; entryDate: string; entryType: string; refNumber?: string | null;
  narration?: string | null; debit: string; credit: string; balance: number;
}
interface StatementResp {
  party: { id: string; name: string; phone?: string; gstin?: string | null };
  opening: number; closing: number; entries: LedgerEntryRow[];
}

const inr = (v: unknown) => Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const drcr = (v: number) => `${inr(Math.abs(v))} ${v >= 0 ? "Dr" : "Cr"}`;
const dmy = (s: string) => formatDate(s);

function PartyLedgerView({ partyType }: { partyType: PartyType }) {
  const navigate = useNavigate();
  const hasPerm = useAuth((s) => s.hasPerm);
  const isCustomer = partyType === "CUSTOMER";
  const stmtEndpoint = (id: string) => (isCustomer ? `/reports/customer-statement/${id}` : `/reports/supplier-statement/${id}`);
  const reportType = isCustomer ? "CUSTOMER_STATEMENT" : "SUPPLIER_STATEMENT";

  const [partyId, setPartyId] = useState("");
  const period = useFinancialReportPeriod(() => {});
  const { from, to } = period;
  const [queued, setQueued] = useState(false);

  const params = useMemo(() => ({ ...(from ? { from } : {}), ...(to ? { to } : {}) }), [from, to]);
  const stmt = useQuery({
    queryKey: ["ledger-statement", partyType, partyId, from, to],
    queryFn: async () => (await api.get(stmtEndpoint(partyId), { params })).data as StatementResp,
    enabled: !!partyId && period.ready,
  });

  const queueExport = useMutation({
    mutationFn: async (format: string) => {
      await api.post("/reports/export", {
        reportType, format,
        filters: { ...(isCustomer ? { customerId: partyId } : { supplierId: partyId }), ...params },
      });
    },
    onSuccess: () => { setQueued(true); setTimeout(() => setQueued(false), 6000); },
    onError: (err) => alert(errMessage(err)),
  });

  function printLedger() {
    const d = stmt.data;
    if (!d) return;
    const rows = d.entries.map((e) => `
      <tr>
        <td>${dmy(e.entryDate)}</td><td>${e.entryType}</td><td>${e.refNumber ?? ""}</td>
        <td>${e.narration ?? ""}</td>
        <td class="r">${Number(e.debit) ? inr(e.debit) : ""}</td>
        <td class="r">${Number(e.credit) ? inr(e.credit) : ""}</td>
        <td class="r">${drcr(e.balance)}</td>
      </tr>`).join("");
    const html = `<!doctype html><html><head><title>${d.party.name} — Ledger</title><style>
      body { font-family: Arial, sans-serif; font-size: 12px; margin: 24px; }
      h2 { margin: 0 0 2px; } .muted { color: #555; margin-bottom: 12px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #999; padding: 4px 6px; text-align: left; }
      th { background: #eee; } .r { text-align: right; }
      .open td, .close td { font-weight: bold; background: #f6f6f6; }
      @media print { button { display: none; } }
    </style></head><body>
      <h2>${d.party.name} — ${isCustomer ? "Customer" : "Supplier"} Ledger</h2>
      <div class="muted">${from ? `From ${dmy(from)}` : "From beginning"} ${to ? `to ${dmy(to)}` : ""}${d.party.gstin ? ` · GSTIN: ${d.party.gstin}` : ""}</div>
      <table>
        <thead><tr><th>Date</th><th>Type</th><th>Ref</th><th>Narration</th><th class="r">Debit</th><th class="r">Credit</th><th class="r">Balance</th></tr></thead>
        <tbody>
          <tr class="open"><td>${from ? dmy(from) : ""}</td><td></td><td></td><td>Opening Balance</td><td></td><td></td><td class="r">${drcr(d.opening)}</td></tr>
          ${rows}
          <tr class="close"><td>${to ? dmy(to) : ""}</td><td></td><td></td><td>Closing Balance</td><td></td><td></td><td class="r">${drcr(d.closing)}</td></tr>
        </tbody>
      </table>
    </body></html>`;
    const w = window.open("", "_blank", "width=900,height=700");
    if (!w) { alert("Popup blocked — allow popups to print"); return; }
    w.document.write(html);
    w.document.close();
    w.focus();
    setTimeout(() => w.print(), 300);
  }

  const d = stmt.data;
  const totals = d
    ? d.entries.reduce((acc, e) => ({ debit: acc.debit + Number(e.debit), credit: acc.credit + Number(e.credit) }), { debit: 0, credit: 0 })
    : null;

  return (
    <>
      <h2 className="page-title">{isCustomer ? "Customer Ledger" : "Supplier Ledger"}</h2>
      <div className="toolbar" style={{ flexWrap: "wrap" }}>
        <div style={{ width: 280 }}><EntitySelect key={partyType} kind={isCustomer ? "customers" : "suppliers"} value={partyId} onChange={setPartyId} /></div>
        <FinancialReportPeriod period={period} />
        <div className="spacer" />
        {queued && (
          <span style={{ color: "var(--ok)", fontSize: 13 }}>
            Export queued —{" "}
            <a style={{ cursor: "pointer", textDecoration: "underline" }} onClick={() => navigate("/exports")}>view in Exports</a>
          </span>
        )}
        {d && hasPerm("report:export") && (
          <>
            <button className="small" disabled={queueExport.isPending} onClick={() => queueExport.mutate("XLSX")}>Export Excel</button>
            <button className="small" disabled={queueExport.isPending} onClick={() => queueExport.mutate("PDF")}>Export PDF</button>
          </>
        )}
        {d && <button className="small" onClick={printLedger}>Print</button>}
      </div>

      {!partyId && <p style={{ color: "var(--muted)" }}>Select a {isCustomer ? "customer" : "supplier"} to view the ledger. Pick a financial year or a custom date range for opening/closing balances.</p>}
      {stmt.isLoading && partyId && <p style={{ color: "var(--muted)" }}>Loading ledger…</p>}

      {d && (
        <>
          <div style={{ display: "flex", gap: 20, flexWrap: "wrap", margin: "4px 0 12px", color: "var(--muted)" }}>
            <span><strong style={{ color: "var(--text)" }}>{d.party.name}</strong>{d.party.gstin ? ` · ${d.party.gstin}` : ""}</span>
            <span>Opening <strong style={{ color: "var(--text)" }}>{drcr(d.opening)}</strong></span>
            <span>Closing <strong style={{ color: "var(--text)" }}>{drcr(d.closing)}</strong></span>
            {totals && <span>Dr <strong style={{ color: "var(--text)" }}>₹{inr(totals.debit)}</strong> · Cr <strong style={{ color: "var(--text)" }}>₹{inr(totals.credit)}</strong></span>}
          </div>
          <ListTable>
            <thead>
              <tr>
                <th>Date</th><th>Type</th><th>Ref</th><th>Narration</th>
                <th style={{ textAlign: "right" }}>Debit</th>
                <th style={{ textAlign: "right" }}>Credit</th>
                <th style={{ textAlign: "right" }}>Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr style={{ fontWeight: 600, background: "var(--panel, #f7f9fb)" }}>
                <td>{from ? dmy(from) : ""}</td><td /><td /><td>Opening Balance</td><td /><td />
                <td style={{ textAlign: "right" }}>{drcr(d.opening)}</td>
              </tr>
              {d.entries.map((e) => (
                <tr key={e.id}>
                  <td>{dmy(e.entryDate)}</td>
                  <td>{e.entryType}</td>
                  <td><code>{e.refNumber ?? ""}</code></td>
                  <td>{e.narration ?? ""}</td>
                  <td style={{ textAlign: "right" }}>{Number(e.debit) ? `₹${inr(e.debit)}` : ""}</td>
                  <td style={{ textAlign: "right" }}>{Number(e.credit) ? `₹${inr(e.credit)}` : ""}</td>
                  <td style={{ textAlign: "right" }}>{drcr(e.balance)}</td>
                </tr>
              ))}
              {d.entries.length === 0 && (
                <tr><td colSpan={7} style={{ color: "var(--muted)" }}>No transactions in this period.</td></tr>
              )}
              <tr style={{ fontWeight: 700, background: "var(--panel, #f7f9fb)", borderTop: "2px solid var(--border, #ccc)" }}>
                <td>{to ? dmy(to) : ""}</td><td /><td /><td>Closing Balance</td>
                <td style={{ textAlign: "right" }}>{totals ? `₹${inr(totals.debit)}` : ""}</td>
                <td style={{ textAlign: "right" }}>{totals ? `₹${inr(totals.credit)}` : ""}</td>
                <td style={{ textAlign: "right" }}>{drcr(d.closing)}</td>
              </tr>
            </tbody>
          </ListTable>
          <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
            {isCustomer
              ? "Dr balance = customer owes you · Cr balance = advance / credit with customer."
              : "Cr balance = you owe the supplier · Dr balance = advance paid to supplier."}
          </p>
        </>
      )}
    </>
  );
}

export const CustomerLedgerPage = () => <PartyLedgerView partyType="CUSTOMER" />;
export const SupplierLedgerPage = () => <PartyLedgerView partyType="SUPPLIER" />;
