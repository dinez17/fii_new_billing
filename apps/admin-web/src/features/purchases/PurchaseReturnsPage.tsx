import { formatDate } from "../../lib/date";
import { RowsPerPage, usePageSize } from "../../components/ListPagination";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";
import { TransactionFilters, useTransactionPeriod } from "../../components/TransactionFilters";

interface ReturnRow {
  id: string; returnNumber: string; returnDate: string; taxableValue: string; totalGst: string; total: string;
  supplier: { name: string }; purchaseInvoice: { ourNumber: string; billNumber: string };
}
interface PiLite { id: string; ourNumber: string; billNumber: string; supplier: { name: string } }
interface PiItem { id: string; productId: string; quantity: string; unitPrice: string; discount: string; gstRate: string; product: { name: string; sku: string } }
interface PiDetail { id: string; ourNumber: string; supplier: { name: string }; items: PiItem[] }

const inr = (v: unknown) => `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function PurchaseReturnsPage() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPerm);
  const location = useLocation() as { state?: { purchaseInvoiceId?: string } };
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize(() => setPage(1));
  const period = useTransactionPeriod(() => setPage(1));
  const [search, setSearch] = useState("");
  const [piId, setPiId] = useState<string | null>(null); // selected PI in the create modal
  const [creating, setCreating] = useState(false);
  const [returnDate, setReturnDate] = useState(new Date().toISOString().slice(0, 10));
  const [reason, setReason] = useState("");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  // launched from the Purchase Invoices page with a preselected invoice
  useEffect(() => {
    if (location.state?.purchaseInvoiceId) {
      setPiId(location.state.purchaseInvoiceId);
      setCreating(true);
    }
  }, [location.state]);

  const list = useQuery({
    queryKey: ["purchase-returns", page, search, pageSize, period.params],
    enabled: period.ready,
    queryFn: async () => (await api.get("/purchase-returns", { params: { page, limit: pageSize, search: search || undefined, ...period.params } })).data as
      { items: ReturnRow[]; total: number; limit: number },
  });

  const invoices = useQuery({
    queryKey: ["purchase-invoices-forreturn"],
    queryFn: async () => (await api.get("/purchase-invoices", { params: { limit: 100 } })).data.items as PiLite[],
    enabled: creating,
  });

  const pi = useQuery({
    queryKey: ["purchase-invoice", piId],
    queryFn: async () => (await api.get(`/purchase-invoices/${piId}`)).data as PiDetail,
    enabled: !!piId && creating,
  });

  const save = useMutation({
    mutationFn: async () => {
      const items = (pi.data?.items ?? [])
        .map((it) => ({ productId: it.productId, quantity: Number(qty[it.id] || 0), unitPrice: Number(it.unitPrice), discount: Number(it.discount || 0), gstRate: Number(it.gstRate) }))
        .filter((it) => it.quantity > 0);
      if (items.length === 0) throw new Error("Enter a return quantity for at least one line");
      await api.post("/purchase-returns", { purchaseInvoiceId: piId, returnDate, reason: reason || undefined, items });
    },
    onSuccess: () => { closeModal(); qc.invalidateQueries({ queryKey: ["purchase-returns"] }); },
    onError: (err) => setError(errMessage(err)),
  });

  function closeModal() {
    setCreating(false); setPiId(null); setQty({}); setReason(""); setError("");
  }

  return (
    <>
      <h2 className="page-title">Purchase Returns <span style={{ color: "var(--muted)", fontWeight: 400, fontSize: 14 }}>(Debit Notes to suppliers)</span></h2>
      <div className="toolbar">
        <RowsPerPage value={pageSize} onChange={setPageSize} />
        <TransactionFilters period={period} />
        <input style={{ width: 220 }} placeholder="Search return / supplier…" value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <div className="spacer" />
        {hasPerm("purchase_return:create") && (
          <button className="primary" onClick={() => { setCreating(true); setError(""); }}>+ New Return</button>
        )}
      </div>

      <table>
        <thead>
          <tr><th>Return No</th><th>Date</th><th>Supplier</th><th>Against Bill</th><th style={{ textAlign: "right" }}>Taxable</th><th style={{ textAlign: "right" }}>GST</th><th style={{ textAlign: "right" }}>Total</th></tr>
        </thead>
        <tbody>
          {list.data?.items.map((r) => (
            <tr key={r.id}>
              <td><code>{r.returnNumber}</code></td>
              <td>{formatDate(r.returnDate)}</td>
              <td>{r.supplier.name}</td>
              <td>{r.purchaseInvoice.ourNumber}</td>
              <td style={{ textAlign: "right" }}>{inr(r.taxableValue)}</td>
              <td style={{ textAlign: "right" }}>{inr(r.totalGst)}</td>
              <td style={{ textAlign: "right", fontWeight: 600 }}>{inr(r.total)}</td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr><td colSpan={7} style={{ color: "var(--muted)" }}>No purchase returns yet.</td></tr>
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
        <div className="modal-overlay entry-fullpage-overlay" onClick={closeModal}>
          <div className="modal" style={{ width: 720 }} onClick={(e) => e.stopPropagation()}>
            <h3>New purchase return</h3>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
              <div>
                <label>Purchase invoice *</label>
                <select value={piId ?? ""} onChange={(e) => { setPiId(e.target.value || null); setQty({}); }}>
                  <option value="">— select bill —</option>
                  {invoices.data?.map((i) => <option key={i.id} value={i.id}>{i.ourNumber} · {i.supplier.name} (bill {i.billNumber})</option>)}
                </select>
              </div>
              <div><label>Return date</label>
                <input type="date" value={returnDate} onChange={(e) => setReturnDate(e.target.value)} /></div>
            </div>

            {pi.data && (
              <table style={{ fontSize: 13, marginTop: 12 }}>
                <thead><tr><th>Product</th><th style={{ textAlign: "right" }}>Purchased</th><th style={{ textAlign: "right" }}>Rate</th><th style={{ textAlign: "right" }}>GST%</th><th style={{ width: 110 }}>Return qty</th></tr></thead>
                <tbody>
                  {pi.data.items.map((it) => (
                    <tr key={it.id}>
                      <td>{it.product.name} <code style={{ fontSize: 11 }}>{it.product.sku}</code></td>
                      <td style={{ textAlign: "right" }}>{Number(it.quantity)}</td>
                      <td style={{ textAlign: "right" }}>{inr(it.unitPrice)}</td>
                      <td style={{ textAlign: "right" }}>{Number(it.gstRate)}%</td>
                      <td>
                        <input type="number" min={0} max={Number(it.quantity)} value={qty[it.id] ?? ""}
                          onChange={(e) => setQty({ ...qty, [it.id]: e.target.value })} placeholder="0" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}

            <label>Reason</label>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Damaged / wrong item…" />
            {error && <div className="error">{error}</div>}
            <div className="actions">
              <button onClick={closeModal}>Cancel</button>
              <button className="primary" disabled={save.isPending || !piId} onClick={() => save.mutate()}>
                {save.isPending ? "Saving…" : "Create return"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
