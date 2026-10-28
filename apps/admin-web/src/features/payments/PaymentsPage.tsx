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
  id: string; amount: string; mode: string; paymentDate: string; reference?: string; status: string;
  customer: { name: string; phone: string };
  receipt?: { id: string; receiptNumber: string } | null;
  allocations: { amount: string; invoice: { invoiceNumber: string } }[];
}

const inr = (v: unknown) => `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

export function PaymentsPage() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPerm);
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
    mode: "CASH",
    paymentDate: new Date().toISOString().slice(0, 10),
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
    queryFn: async () => {
      const { data } = await api.get("/invoices", { params: { page: 1, limit: 100, customerId: form.customerId } });
      return (data.items as OpenInvoice[]).filter((i) => i.status === "UNPAID" || i.status === "PARTIAL");
    },
    enabled: creating && !!form.customerId,
  });

  const allocated = Object.values(form.allocations).reduce((s, v) => s + Number(v || 0), 0);
  const amount = Number(form.amount || 0);

  function autoAllocate() {
    let left = amount;
    const alloc: Record<string, string> = {};
    for (const inv of openInvoices.data ?? []) {
      if (left <= 0) break;
      const balance = invBalance(inv);
      const take = Math.min(left, balance);
      if (take > 0) { alloc[inv.id] = take.toFixed(2); left -= take; }
    }
    setForm({ ...form, allocations: alloc });
  }

  const create = useMutation({
    mutationFn: async () => {
      await api.post("/payments", {
        customerId: form.customerId,
        amount,
        mode: form.mode,
        paymentDate: form.paymentDate,
        reference: form.reference || undefined,
        allocations: Object.entries(form.allocations)
          .filter(([, v]) => Number(v) > 0)
          .map(([invoiceId, v]) => ({ invoiceId, amount: Number(v) })),
      });
    },
    onSuccess: () => {
      setCreating(false); setError("");
      setForm({ ...form, customerId: "", amount: "", reference: "", allocations: {} });
      qc.invalidateQueries({ queryKey: ["payments"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
    },
    onError: (err) => setError(errMessage(err)),
  });

  async function downloadReceipt(p: PaymentRow) {
    if (!p.receipt) return;
    try {
      const { data } = await api.get(`/receipts/${p.receipt.id}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) { alert(errMessage(err)); }
  }

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
        {hasPerm("payment:create") && (
          <button className="primary" onClick={() => { setCreating(true); setError(""); }}>+ Record Payment</button>
        )}
      </div>

      <table>
        <thead>
          <tr><th>Receipt</th><th>Date</th><th>Customer</th><th>Amount</th><th>Mode</th><th>Against</th><th /></tr>
        </thead>
        <tbody>
          {list.data?.items.map((p) => (
            <tr key={p.id}>
              <td><code>{p.receipt?.receiptNumber ?? "—"}</code></td>
              <td>{formatDate(p.paymentDate)}</td>
              <td>{p.customer.name}</td>
              <td>{inr(p.amount)}</td>
              <td><span className="badge">{p.mode}</span>{p.reference && <span style={{ color: "var(--muted)", marginLeft: 6, fontSize: 12 }}>{p.reference}</span>}</td>
              <td style={{ fontSize: 12 }}>{p.allocations.map((a) => a.invoice.invoiceNumber).join(", ")}</td>
              <td>{p.receipt && <IconButton className="small" onClick={() => void downloadReceipt(p)} icon="download" label="Receipt PDF">Receipt PDF</IconButton>}</td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr><td colSpan={7} style={{ color: "var(--muted)" }}>No payments recorded yet.</td></tr>
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

      {creating && (
        <div className="modal-overlay" onClick={() => setCreating(false)}>
          <div className="modal" style={{ width: 680 }} onClick={(e) => e.stopPropagation()}>
            <h3>Record payment</h3>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
              <div>
                <label>Customer *</label>
                <EntitySelect kind="customers" value={form.customerId} onChange={(id) => setForm({ ...form, customerId: id, allocations: {} })} />
              </div>
              <div><label>Amount ₹ *</label>
                <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div>
                <label>Mode</label>
                <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                  <option>CASH</option><option>UPI</option><option>CHEQUE</option><option>BANK_TRANSFER</option><option>CARD</option>
                </select>
              </div>
              <div><label>Date</label>
                <input type="date" value={form.paymentDate} onChange={(e) => setForm({ ...form, paymentDate: e.target.value })} /></div>
              <div><label>Reference {(form.mode === "CHEQUE" || form.mode === "BANK_TRANSFER") && "*"}</label>
                <input placeholder="Cheque no / UTR" value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></div>
            </div>

            {form.customerId && (
              <>
                <div className="toolbar" style={{ marginTop: 12, marginBottom: 4 }}>
                  <label style={{ margin: 0 }}>Allocate to invoices</label>
                  <div className="spacer" />
                  <button className="small" disabled={!amount} onClick={autoAllocate}>Auto-allocate (oldest first)</button>
                </div>
                <table style={{ fontSize: 13 }}>
                  <thead><tr><th>Invoice</th><th>Date</th><th>Total</th><th>Balance</th><th style={{ width: 130 }}>Allocate ₹</th></tr></thead>
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
                        </tr>
                      );
                    })}
                    {openInvoices.data?.length === 0 && (
                      <tr><td colSpan={5} style={{ color: "var(--muted)" }}>No open invoices for this customer.</td></tr>
                    )}
                  </tbody>
                </table>
                <div style={{ textAlign: "right", marginTop: 8, color: allocated > amount + 0.001 ? "var(--danger)" : "var(--ok)" }}>
                  Allocated {inr(allocated)} of {inr(amount)}
                  {amount - allocated > 0.001 && (
                    <span style={{ color: "var(--muted)" }}> · {inr(amount - allocated)} on account (reduces outstanding)</span>
                  )}
                </div>
              </>
            )}

            {error && <div className="error">{error}</div>}
            <div className="actions">
              <button onClick={() => setCreating(false)}>Cancel</button>
              <button className="primary"
                disabled={create.isPending || !form.customerId || !amount || allocated > amount + 0.001}
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
