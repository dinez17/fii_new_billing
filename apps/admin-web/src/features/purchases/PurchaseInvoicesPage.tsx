import { formatDate } from "../../lib/date";
import { IconButton } from "../../components/IconButton";
import { RowsPerPage, usePageSize, ListTable } from "../../components/ListPagination";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";
import { TransactionFilters, useTransactionPeriod } from "../../components/TransactionFilters";

interface PiRow {
  id: string; ourNumber: string; billNumber: string; invoiceDate: string;
  grandTotal: string; amountPaid: string; status: string;
  supplier: { id: string; name: string };
}
interface PiDetail extends PiRow {
  isInterState: boolean; taxableValue: string; cgst: string; sgst: string; igst: string;
  items: { id: string; quantity: string; unitPrice: string; gstRate: string; lineTotal: string; product: { name: string; sku: string; unit: string } }[];
}
interface PayForm {
  supplierId: string; supplierName: string; amount: string; mode: string;
  paymentDate: string; reference: string;
  allocations: Record<string, string>;
}

const inr = (v: unknown) => `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

export function PurchaseInvoicesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const hasPerm = useAuth((s) => s.hasPerm);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize(() => setPage(1));
  const period = useTransactionPeriod(() => setPage(1));
  const [status, setStatus] = useState("OUTSTANDING");
  const [search, setSearch] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [pay, setPay] = useState<PayForm | null>(null);
  const [error, setError] = useState("");

  const list = useQuery({
    queryKey: ["purchase-invoices", page, search, pageSize, period.params, status],
    enabled: period.ready,
    queryFn: async () => (await api.get("/purchase-invoices", { params: { page, limit: pageSize, search: search || undefined, ...period.params, status: status || undefined } })).data as
      { items: PiRow[]; total: number; limit: number },
  });

  const detail = useQuery({
    queryKey: ["purchase-invoice", detailId],
    queryFn: async () => (await api.get(`/purchase-invoices/${detailId}`)).data as PiDetail,
    enabled: !!detailId,
  });

  const openBills = useQuery({
    queryKey: ["open-bills", pay?.supplierId],
    queryFn: async () => {
      const { data } = await api.get("/purchase-invoices", { params: { page: 1, limit: 100, supplierId: pay!.supplierId } });
      return (data.items as PiRow[]).filter((i) => i.status === "UNPAID" || i.status === "PARTIAL");
    },
    enabled: !!pay,
  });

  const doPay = useMutation({
    mutationFn: async () => {
      await api.post("/supplier-payments", {
        supplierId: pay!.supplierId,
        amount: Number(pay!.amount),
        mode: pay!.mode,
        paymentDate: pay!.paymentDate,
        reference: pay!.reference || undefined,
        allocations: Object.entries(pay!.allocations)
          .filter(([, v]) => Number(v) > 0)
          .map(([purchaseInvoiceId, v]) => ({ purchaseInvoiceId, amount: Number(v) })),
      });
    },
    onSuccess: () => { setPay(null); setError(""); qc.invalidateQueries(); },
    onError: (err) => setError(errMessage(err)),
  });

  const allocated = pay ? Object.values(pay.allocations).reduce((s, v) => s + Number(v || 0), 0) : 0;
  const statusBadge = (s: string) =>
    <span className={`badge ${s === "PAID" ? "ok" : s === "CANCELLED" ? "warn" : ""}`}>{s}</span>;

  return (
    <>
      <h2 className="page-title">Purchase Invoices</h2>
      <div className="toolbar">
        <RowsPerPage value={pageSize} onChange={setPageSize} />
        <select aria-label="Purchase invoice status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="OUTSTANDING">Unpaid + partially paid</option><option value="">All statuses</option><option>UNPAID</option><option>PARTIAL</option><option>PAID</option><option>CANCELLED</option></select>
        <TransactionFilters period={period} />
        <input style={{ width: 260 }} placeholder="Search number / bill / supplier…" value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <div className="spacer" />
        {hasPerm("purchase_invoice:create") && (
          <button className="primary" onClick={() => navigate("/purchases/new")}>+ New Purchase Bill</button>
        )}
      </div>

      <table>
        <thead>
          <tr><th>Our No</th><th>Supplier Bill</th><th>Date</th><th>Supplier</th><th>Total</th><th>Paid</th><th>Status</th><th /></tr>
        </thead>
        <tbody>
          {list.data?.items.map((pi) => (
            <tr key={pi.id}>
              <td><code>{pi.ourNumber}</code></td>
              <td><code>{pi.billNumber}</code></td>
              <td>{formatDate(pi.invoiceDate)}</td>
              <td>{pi.supplier.name}</td>
              <td>{inr(pi.grandTotal)}</td>
              <td>{inr(pi.amountPaid)}</td>
              <td>{statusBadge(pi.status)}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                <IconButton className="small" onClick={() => setDetailId(pi.id)} icon="view" label="View">View</IconButton>{" "}
                {hasPerm("supplier_payment:create") && pi.status !== "PAID" && pi.status !== "CANCELLED" && (
                  <IconButton className="small" onClick={() => {
                    setPay({
                      supplierId: pi.supplier.id, supplierName: pi.supplier.name, amount: "",
                      mode: "BANK_TRANSFER", paymentDate: new Date().toISOString().slice(0, 10),
                      reference: "", allocations: {},
                    });
                    setError("");
                  }} icon="pay" label="Pay">Pay</IconButton>
                )}{" "}
                {hasPerm("purchase_return:create") && pi.status !== "CANCELLED" && (
                  <IconButton className="small" title="Purchase return / debit note"
                    onClick={() => navigate("/purchase-returns", { state: { purchaseInvoiceId: pi.id } })} icon="return" label="Return">Return</IconButton>
                )}
              </td>
            </tr>
          ))}
          {list.data?.items.length === 0 && (
            <tr><td colSpan={8} style={{ color: "var(--muted)" }}>No purchase bills yet.</td></tr>
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

      {detailId && detail.data && (
        <div className="modal-overlay" onClick={() => setDetailId(null)}>
          <div className="modal" style={{ width: 680 }} onClick={(e) => e.stopPropagation()}>
            <h3>{detail.data.ourNumber} {statusBadge(detail.data.status)}</h3>
            <p style={{ color: "var(--muted)" }}>
              {detail.data.supplier.name} · bill {detail.data.billNumber} · {formatDate(detail.data.invoiceDate)}
              {detail.data.isInterState ? " · IGST" : " · CGST+SGST"}
            </p>
            <ListTable style={{ fontSize: 13 }}>
              <thead><tr><th>Product</th><th>Qty</th><th>Rate</th><th>GST%</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
              <tbody>
                {detail.data.items.map((it) => (
                  <tr key={it.id}>
                    <td>{it.product.name} <code style={{ fontSize: 11 }}>{it.product.sku}</code></td>
                    <td>{Number(it.quantity)} {it.product.unit}</td>
                    <td>{Number(it.unitPrice).toFixed(2)}</td>
                    <td>{Number(it.gstRate)}%</td>
                    <td style={{ textAlign: "right" }}>{Number(it.lineTotal).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </ListTable>
            <div style={{ textAlign: "right", marginTop: 10, lineHeight: 1.8 }}>
              Taxable {inr(detail.data.taxableValue)}<br />
              {Number(detail.data.igst) > 0
                ? <>IGST (input) {inr(detail.data.igst)}<br /></>
                : <>CGST {inr(detail.data.cgst)} · SGST {inr(detail.data.sgst)}<br /></>}
              <strong>Total {inr(detail.data.grandTotal)}</strong> · Paid {inr(detail.data.amountPaid)}
            </div>
            <div className="actions"><button className="primary" onClick={() => setDetailId(null)}>Close</button></div>
          </div>
        </div>
      )}

      {pay && (
        <div className="modal-overlay" onClick={() => setPay(null)}>
          <div className="modal" style={{ width: 640 }} onClick={(e) => e.stopPropagation()}>
            <h3>Pay supplier — {pay.supplierName}</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div><label>Amount ₹ *</label>
                <input type="number" value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} /></div>
              <div>
                <label>Mode</label>
                <select value={pay.mode} onChange={(e) => setPay({ ...pay, mode: e.target.value })}>
                  <option>BANK_TRANSFER</option><option>CASH</option><option>UPI</option><option>CHEQUE</option><option>CARD</option>
                </select>
              </div>
              <div><label>Date</label>
                <input type="date" value={pay.paymentDate} onChange={(e) => setPay({ ...pay, paymentDate: e.target.value })} /></div>
            </div>
            <label>Reference (UTR / cheque no)</label>
            <input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} />

            <label style={{ marginTop: 12 }}>Allocate to bills</label>
            <table style={{ fontSize: 13 }}>
              <thead><tr><th>Bill</th><th>Total</th><th>Balance</th><th style={{ width: 120 }}>Allocate ₹</th></tr></thead>
              <tbody>
                {openBills.data?.map((b) => {
                  const balance = Number(b.grandTotal) - Number(b.amountPaid);
                  return (
                    <tr key={b.id}>
                      <td><code>{b.ourNumber}</code></td>
                      <td>{inr(b.grandTotal)}</td>
                      <td>{inr(balance)}</td>
                      <td><input type="number" value={pay.allocations[b.id] ?? ""}
                        onChange={(e) => setPay({ ...pay, allocations: { ...pay.allocations, [b.id]: e.target.value } })} /></td>
                    </tr>
                  );
                })}
                {openBills.data?.length === 0 && <tr><td colSpan={4} style={{ color: "var(--muted)" }}>No open bills — payment goes on account.</td></tr>}
              </tbody>
            </table>
            <div style={{ textAlign: "right", marginTop: 8, color: allocated > Number(pay.amount || 0) + 0.001 ? "var(--danger)" : "var(--ok)" }}>
              Allocated {inr(allocated)} of {inr(Number(pay.amount || 0))}
              {Number(pay.amount || 0) - allocated > 0.001 && (
                <span style={{ color: "var(--muted)" }}> · {inr(Number(pay.amount) - allocated)} on account</span>
              )}
            </div>
            {error && <div className="error">{error}</div>}
            <div className="actions">
              <button onClick={() => setPay(null)}>Cancel</button>
              <button className="primary"
                disabled={doPay.isPending || !Number(pay.amount) || allocated > Number(pay.amount) + 0.001}
                onClick={() => doPay.mutate()}>
                {doPay.isPending ? "Saving…" : "Record payment"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
