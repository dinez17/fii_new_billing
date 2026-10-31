import { MoneyAccountSelect } from "../../components/MoneyAccountSelect";
import { TdsReport } from "./TdsReport";
import { downloadPdf } from "../../lib/pdf-download";
import { formatDate } from "../../lib/date";
import { IconButton } from "../../components/IconButton";
import { RowsPerPage, usePageSize } from "../../components/ListPagination";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";
import { EntitySelect } from "../../components/EntitySelect";
import { TransactionFilters, useTransactionPeriod } from "../../components/TransactionFilters";

interface OpenInvoice { id: string; invoiceNumber: string; invoiceDate: string; grandTotal: string; amountPaid: string; creditedAmount?: string; status: string }
const invBalance = (i: OpenInvoice) => Number(i.grandTotal) - Number(i.amountPaid) - Number(i.creditedAmount ?? 0);
interface PaymentRow {
  id: string; amount: string; tdsAmount: string; mode: string; paymentDate: string; reference?: string; status: string;
  customer: { name: string; phone: string };
  receipt?: { id: string; receiptNumber: string } | null;
  allocations: { amount: string; invoice: { invoiceNumber: string } }[];
}

const inr = (v: unknown) => `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

export function PaymentsPage() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPerm);
  const [showTds, setShowTds] = useState(false);
  const [reversing, setReversing] = useState<PaymentRow | null>(null);
  const [reverseReason, setReverseReason] = useState("");
  const reverse = useMutation({
    mutationFn: async () => api.post(`/payments/${reversing!.id}/reverse`, { reason: reverseReason }),
    onSuccess: () => { setReversing(null); setReverseReason(""); void qc.invalidateQueries(); },
  });
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize(() => setPage(1));
  const period = useTransactionPeriod(() => setPage(1));
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    customerId: "",
    amount: "",
    tdsAmount: "",
    tdsSection: "",
    tdsAllocations: {} as Record<string, string>,
    mode: "CASH", financialAccountId: "",
    paymentDate: new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date()),
    reference: "",
    allocations: {} as Record<string, string>, // invoiceId → amount
  });

  const list = useQuery({
    queryKey: ["payments", page, search, pageSize, period.params, status],
    enabled: period.ready,
    queryFn: async () => (await api.get("/payments", { params: { page, limit: pageSize, search: search || undefined, ...period.params, status: status || undefined } })).data as
      { items: PaymentRow[]; total: number; limit: number; totalCollected: string },
  });


  const openInvoices = useQuery({
    queryKey: ["open-invoices", form.customerId],
    queryFn: async ({ signal }) => {
      const rows: OpenInvoice[] = [];
      for (let page = 1; ; page++) {
        const { data } = await api.get("/invoices", { params: { page, limit: 100, customerId: form.customerId, status: "OUTSTANDING" }, signal });
        rows.push(...data.items);
        if (data.items.length < 100 || rows.length >= data.total) break;
      }
      return rows.filter((i) => i.status === "UNPAID" || i.status === "PARTIAL");
    },
    enabled: creating && !!form.customerId,
  });

  const allocated = Object.values(form.allocations).reduce((s, v) => s + Number(v || 0), 0);
  const amount = Number(form.amount || 0);
  const tds = Number(form.tdsAmount || 0);
  const allocatedTds = Object.values(form.tdsAllocations).reduce((sum, value) => sum + Number(value || 0), 0);

  function autoAllocate() {
    let left = amount, tdsLeft = tds;
    const tdsAlloc: Record<string, string> = {};
    const alloc: Record<string, string> = {};
    for (const inv of [...(openInvoices.data ?? [])].sort((a,b) => a.invoiceDate.localeCompare(b.invoiceDate) || a.invoiceNumber.localeCompare(b.invoiceNumber))) {
      if (left <= 0 && tdsLeft <= 0) break;
      const balance = invBalance(inv);
      const take = Math.min(left, balance);
      if (take > 0) { alloc[inv.id] = take.toFixed(2); left -= take; }
      const withheld = Math.min(tdsLeft, balance - take);
      if (withheld > 0) { tdsAlloc[inv.id] = withheld.toFixed(2); tdsLeft -= withheld; }
    }
    setForm({ ...form, allocations: alloc, tdsAllocations: tdsAlloc });
  }

  const create = useMutation({
    mutationFn: async () => {
      await api.post("/payments", {
        customerId: form.customerId,
        amount,
        tdsAmount: tds,
        tdsSection: tds > 0 ? form.tdsSection || undefined : undefined,
        financialAccountId: form.financialAccountId || null,
        mode: form.mode,
        paymentDate: form.paymentDate,
        reference: form.reference || undefined,
        allocations: [...new Set([...Object.keys(form.allocations), ...Object.keys(form.tdsAllocations)])]
          .map(invoiceId => ({ invoiceId, amount: Number(form.allocations[invoiceId] || 0), tdsAmount: Number(form.tdsAllocations[invoiceId] || 0) }))
          .filter(a => a.amount + a.tdsAmount > 0),
      });
    },
    onSuccess: () => {
      setCreating(false); setError("");
      setForm({ ...form, customerId: "", amount: "", tdsAmount: "", tdsSection: "", reference: "", allocations: {}, tdsAllocations: {} });
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      qc.invalidateQueries({ queryKey: ["tds-report"] });
      qc.invalidateQueries({ queryKey: ["customers"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
    },
    onError: (err) => setError(errMessage(err)),
  });

  async function downloadReceipt(p: PaymentRow) {
    if (!p.receipt) return;
    try {
      const { data } = await api.get(`/receipts/${p.receipt.id}/pdf`, { responseType: "blob" });
      await downloadPdf(data, p.receipt.receiptNumber);
    } catch (err) { alert(errMessage(err)); }
  }

  if (showTds) return <><button onClick={() => setShowTds(false)}>← Payments</button><TdsReport /></>;

  return (
    <>
      <h2 className="page-title">Payments</h2>
      <div className="toolbar">
        <RowsPerPage value={pageSize} onChange={setPageSize} />
        <input style={{ width: 260 }} placeholder="Search customer / receipt / reference…" value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select aria-label="Payment status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option><option>SUCCESS</option><option>INITIATED</option><option>FAILED</option><option>REFUNDED</option></select>
        <TransactionFilters period={period} />
        <div className="spacer" />
        <button onClick={() => setShowTds(true)}>TDS report</button>
        {hasPerm("payment:create") && (
          <button className="primary" onClick={() => { setCreating(true); setError(""); }}>+ Record Payment</button>
        )}
      </div>

      <table>
        <thead>
          <tr><th>Receipt</th><th>Date</th><th>Customer</th><th>Money received</th><th>TDS deducted</th><th>Mode</th><th>Against</th><th /></tr>
        </thead>
        <tbody>
          {list.data?.items.map((p) => (
            <tr key={p.id}>
              <td><code>{p.receipt?.receiptNumber ?? "—"}</code></td>
              <td>{formatDate(p.paymentDate)}</td>
              <td>{p.customer.name}</td>
              <td>{inr(p.amount)}</td><td>{inr(p.tdsAmount ?? 0)}</td>
              <td><span className="badge">{p.mode}</span>{p.reference && <span style={{ color: "var(--muted)", marginLeft: 6, fontSize: 12 }}>{p.reference}</span>}</td>
              <td style={{ fontSize: 12 }}>{p.allocations.map((a) => a.invoice.invoiceNumber).join(", ")}</td>
              <td><span className={`badge ${p.status === "SUCCESS" ? "ok" : "warn"}`}>{p.status === "REFUNDED" ? "Reversed / refunded" : p.status}</span>{p.receipt && <IconButton className="small" onClick={() => void downloadReceipt(p)} icon="download" label="Receipt PDF">Receipt PDF</IconButton>}{p.status === "SUCCESS" && hasPerm("payment:update") && <button className="small" onClick={() => { setReversing(p); setReverseReason(""); reverse.reset(); }}>Reverse</button>}</td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr><td colSpan={8} style={{ color: "var(--muted)" }}>No payments recorded yet.</td></tr>
          )}
        </tbody>
      </table>

      {list.data && (
        <div className="pagination">
          <button className="small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <span>Page {page} of {Math.max(1, Math.ceil(list.data.total / list.data.limit))}</span>
          <button className="small" disabled={page * list.data.limit >= list.data.total} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}

      {reversing && <div className="modal-overlay"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="reverse-payment-title">
        <h3 id="reverse-payment-title">Reverse receipt {reversing.receipt?.receiptNumber}</h3>
        <p>This corrects the original entry: cash {inr(reversing.amount)}, TDS {inr(reversing.tdsAmount)}. Invoice balances will reopen, and ledger/daybook reversals use the original payment date. Saved daybook closings may need review. This does not send money to the customer.</p>
        <label>Reason (required)</label><textarea value={reverseReason} maxLength={500} onChange={e => setReverseReason(e.target.value)} />
        {reverse.isError && <div className="error">{errMessage(reverse.error)}</div>}
        <div className="actions"><button disabled={reverse.isPending} onClick={() => setReversing(null)}>Keep receipt</button><button disabled={reverse.isPending || reverseReason.trim().length < 10} onClick={() => reverse.mutate()}>Confirm reversal</button></div>
      </div></div>}
      {creating && (
        <div className="modal-overlay entry-fullpage-overlay" onClick={() => setCreating(false)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="payment-entry-title" style={{ width: 680 }} onClick={(e) => e.stopPropagation()}>
            <h3 id="payment-entry-title">Record payment</h3>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
              <div>
                <label>Customer *</label>
                <EntitySelect kind="customers" value={form.customerId} onChange={(id) => setForm({ ...form, customerId: id, allocations: {}, tdsAllocations: {} })} />
              </div>
              <div><label htmlFor="payment-cash">Money received ₹ *</label>
                <input id="payment-cash" type="number" min="0" step="0.01" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div><label htmlFor="payment-tds">TDS deducted ₹</label><input id="payment-tds" type="number" min="0" step="0.01" value={form.tdsAmount} onChange={(e) => setForm({ ...form, tdsAmount: e.target.value, tdsAllocations: {} })} /></div>
              <div><label htmlFor="payment-tds-section">TDS section / reference (optional)</label><input id="payment-tds-section" maxLength={30} value={form.tdsSection} onChange={(e) => setForm({ ...form, tdsSection: e.target.value })} /></div>
            </div>
            <p className="document-help">Enter actual money received separately. TDS is a non-cash settlement and must be allocated to invoices. Enter 0 received for a TDS-only entry. Settlement: {inr(amount + tds)}.</p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div>
                <label>Mode</label>
                <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                  <option>CASH</option><option>UPI</option><option>CHEQUE</option><option>BANK_TRANSFER</option><option>CARD</option>
                </select>
              </div>
              <div><label>Date</label>
                <input type="date" value={form.paymentDate} onChange={(e) => setForm({ ...form, paymentDate: e.target.value })} /></div>
              <MoneyAccountSelect value={form.financialAccountId} onChange={id=>setForm({...form,financialAccountId:id})} />
              <div><label>Reference {amount > 0 && (form.mode === "CHEQUE" || form.mode === "BANK_TRANSFER") && "*"}</label>
                <input placeholder="Cheque no / UTR" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></div>
            </div>

            {form.customerId && (
              <>
                <div className="toolbar" style={{ marginTop: 12, marginBottom: 4 }}>
                  <label style={{ margin: 0 }}>Allocate to invoices</label>
                  <div className="spacer" />
                  <button className="small" disabled={amount + tds <= 0} onClick={autoAllocate}>Auto-allocate (oldest first)</button>
                </div>
                <table style={{ fontSize: 13 }}>
                  <thead><tr><th>Invoice</th><th>Date</th><th>Total</th><th>Balance</th><th style={{ width: 130 }}>Cash ₹</th><th style={{ width: 110 }}>TDS ₹</th></tr></thead>
                  <tbody>
                    {openInvoices.data?.map((inv) => {
                      const balance = invBalance(inv);
                      return (
                        <tr key={inv.id}>
                          <td><code>{inv.invoiceNumber}</code></td>
                          <td>{formatDate(inv.invoiceDate)}</td>
                          <td>{inr(inv.grandTotal)}</td>
                          <td>{inr(balance)}</td>
                          <td>
                            <input type="number" value={form.allocations[inv.id] ?? ""}
                              onChange={(e) => setForm({ ...form, allocations: { ...form.allocations, [inv.id]: e.target.value } })} />
                          </td>
                          <td><input type="number" min="0" step="0.01" aria-label={`TDS for ${inv.invoiceNumber}`} value={form.tdsAllocations[inv.id] ?? ""} onChange={(e) => setForm({ ...form, tdsAllocations: { ...form.tdsAllocations, [inv.id]: e.target.value } })} /></td>
                        </tr>
                      );
                    })}
                    {openInvoices.data?.length === 0 && (
                      <tr><td colSpan={6} style={{ color: "var(--muted)" }}>No open invoices for this customer.</td></tr>
                    )}
                  </tbody>
                </table>
                <div style={{ textAlign: "right", marginTop: 8, color: allocated > amount + 0.001 || Math.abs(allocatedTds - tds) > 0.001 ? "var(--danger)" : "var(--ok)" }}>
                  Cash allocated {inr(allocated)} of {inr(amount)} · TDS allocated {inr(allocatedTds)} of {inr(tds)}
                  {amount - allocated > 0.001 && (
                    <span style={{ color: "var(--muted)" }}> · {inr(amount - allocated)} on account (reduces outstanding)</span>
                  )}
                </div>
              </>
            )}

            {openInvoices.isError && <div className="error">{errMessage(openInvoices.error)}</div>}
            {error && <div className="error">{error}</div>}
            <div className="actions">
              <button onClick={() => setCreating(false)}>Cancel</button>
              <button className="primary"
                disabled={create.isPending || !form.customerId || amount + tds <= 0 || amount < 0 || tds < 0 || Math.abs(allocatedTds - tds) > 0.001 || allocated > amount + 0.001}
                onClick={() => create.mutate()}>
                {create.isPending ? "Saving…" : "Record payment"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
