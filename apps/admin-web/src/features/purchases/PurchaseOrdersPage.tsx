import { formatDate } from "../../lib/date";
import { IconButton } from "../../components/IconButton";
import { RowsPerPage, usePageSize } from "../../components/ListPagination";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";
import { TransactionFilters, useTransactionPeriod } from "../../components/TransactionFilters";

interface PoRow {
  id: string; poNumber: string; orderDate: string; expectedDate?: string;
  status: string; total: string;
  supplier: { id: string; name: string };
}
interface PoDetail extends PoRow {
  notes?: string;
  items: {
    id: string; quantity: string; receivedQty: string; unitPrice: string; gstRate: string;
    productId: string; product: { name: string; sku: string; unit: string };
  }[];
  grns: { id: string; grnNumber: string; receivedDate: string }[];
}

const inr = (v: unknown) => `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

export function PurchaseOrdersPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const hasPerm = useAuth((s) => s.hasPerm);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize(() => setPage(1));
  const period = useTransactionPeriod(() => setPage(1));
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [detailId, setDetailId] = useState<string | null>(null);
  const [receiving, setReceiving] = useState(false);
  const [recQty, setRecQty] = useState<Record<string, string>>({});
  const [error, setError] = useState("");

  const list = useQuery({
    queryKey: ["pos", page, search, pageSize, period.params, status],
    enabled: period.ready,
    queryFn: async () => (await api.get("/purchase-orders", { params: { page, limit: pageSize, search: search || undefined, ...period.params, status: status || undefined } })).data as
      { items: PoRow[]; total: number; limit: number },
  });

  const detail = useQuery({
    queryKey: ["po", detailId],
    queryFn: async () => (await api.get(`/purchase-orders/${detailId}`)).data as PoDetail,
    enabled: !!detailId,
  });

  const receive = useMutation({
    mutationFn: async () => {
      await api.post("/grns", {
        purchaseOrderId: detailId,
        receivedDate: new Date().toISOString().slice(0, 10),
        items: Object.entries(recQty)
          .filter(([, v]) => Number(v) > 0)
          .map(([productId, v]) => ({ productId, quantity: Number(v) })),
      });
    },
    onSuccess: () => {
      setReceiving(false); setRecQty({}); setError("");
      qc.invalidateQueries({ queryKey: ["pos"] });
      qc.invalidateQueries({ queryKey: ["po", detailId] });
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (err) => setError(errMessage(err)),
  });

  async function act(id: string, action: "send" | "cancel" | "close") {
    if (action === "cancel" && !confirm("Cancel this PO?")) return;
    try {
      await api.post(`/purchase-orders/${id}/${action}`);
      qc.invalidateQueries({ queryKey: ["pos"] });
      qc.invalidateQueries({ queryKey: ["po", id] });
    } catch (err) { alert(errMessage(err)); }
  }

  const statusBadge = (s: string) => (
    <span className={`badge ${s === "RECEIVED" || s === "CLOSED" ? "ok" : s === "CANCELLED" ? "warn" : ""}`}>
      {s.replace(/_/g, " ")}
    </span>
  );

  return (
    <>
      <h2 className="page-title">Purchase Orders</h2>
      <div className="toolbar">
        <RowsPerPage value={pageSize} onChange={setPageSize} />
        <select aria-label="Purchase order status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option>{["DRAFT", "SENT", "PARTIAL_RECEIVED", "RECEIVED", "CLOSED", "CANCELLED"].map((value) => <option key={value}>{value}</option>)}</select>
        <TransactionFilters period={period} />
        <input style={{ width: 260 }} placeholder="Search PO / supplier…" value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <div className="spacer" />
        {hasPerm("purchase_order:create") && (
          <button className="primary" onClick={() => navigate("/purchase-orders/new")}>+ New PO</button>
        )}
      </div>

      <table>
        <thead><tr><th>PO No</th><th>Date</th><th>Supplier</th><th>Expected</th><th>Total</th><th>Status</th><th /></tr></thead>
        <tbody>
          {list.data?.items.map((p) => (
            <tr key={p.id}>
              <td><code>{p.poNumber}</code></td>
              <td>{formatDate(p.orderDate)}</td>
              <td>{p.supplier.name}</td>
              <td>{p.expectedDate ? formatDate(p.expectedDate) : "—"}</td>
              <td>{inr(p.total)}</td>
              <td>{statusBadge(p.status)}</td>
              <td><IconButton className="small" onClick={() => { setDetailId(p.id); setReceiving(false); setError(""); }} icon="view" label="View">View</IconButton></td>
            </tr>
          ))}
          {list.data?.items.length === 0 && (
            <tr><td colSpan={7} style={{ color: "var(--muted)" }}>No purchase orders yet.</td></tr>
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
          <div className="modal" style={{ width: 720 }} onClick={(e) => e.stopPropagation()}>
            <h3>{detail.data.poNumber} {statusBadge(detail.data.status)}</h3>
            <p style={{ color: "var(--muted)" }}>
              {detail.data.supplier.name} · ordered {formatDate(detail.data.orderDate)}
              {detail.data.grns.length > 0 && <> · GRNs: {detail.data.grns.map((g) => g.grnNumber).join(", ")}</>}
            </p>
            <table style={{ fontSize: 13 }}>
              <thead>
                <tr><th>Product</th><th>Ordered</th><th>Received</th><th>Rate</th><th>GST%</th>
                  {receiving && <th style={{ width: 110 }}>Receive now</th>}</tr>
              </thead>
              <tbody>
                {detail.data.items.map((it) => {
                  const outstanding = Number(it.quantity) - Number(it.receivedQty);
                  return (
                    <tr key={it.id}>
                      <td>{it.product.name} <code style={{ fontSize: 11 }}>{it.product.sku}</code></td>
                      <td>{Number(it.quantity)} {it.product.unit}</td>
                      <td style={{ color: outstanding > 0 ? "var(--danger)" : "var(--ok)" }}>{Number(it.receivedQty)}</td>
                      <td>{Number(it.unitPrice).toFixed(2)}</td>
                      <td>{Number(it.gstRate)}%</td>
                      {receiving && (
                        <td>
                          <input type="number" placeholder={`max ${outstanding}`} value={recQty[it.productId] ?? ""}
                            onChange={(e) => setRecQty({ ...recQty, [it.productId]: e.target.value })} />
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {error && <div className="error">{error}</div>}
            <div className="actions">
              {detail.data.status === "DRAFT" && hasPerm("purchase_order:update") && (
                <>
                  <button onClick={() => void act(detail.data.id, "send")}>Mark as Sent</button>
                  <button className="danger" onClick={() => void act(detail.data.id, "cancel")}>Cancel PO</button>
                </>
              )}
              {["SENT", "PARTIAL_RECEIVED"].includes(detail.data.status) && hasPerm("grn:create") && !receiving && (
                <button onClick={() => {
                  setReceiving(true);
                  const pre: Record<string, string> = {};
                  for (const it of detail.data.items) {
                    const out = Number(it.quantity) - Number(it.receivedQty);
                    if (out > 0) pre[it.productId] = String(out);
                  }
                  setRecQty(pre);
                }}>Receive goods (GRN)</button>
              )}
              {receiving && (
                <button className="primary" disabled={receive.isPending || !Object.values(recQty).some((v) => Number(v) > 0)}
                  onClick={() => receive.mutate()}>
                  {receive.isPending ? "Receiving…" : "Confirm receipt"}
                </button>
              )}
              {["RECEIVED", "PARTIAL_RECEIVED"].includes(detail.data.status) && hasPerm("purchase_invoice:create") && (
                <button onClick={() => navigate(`/purchases/new?po=${detail.data.id}`)}>Convert to bill</button>
              )}
              <button className="primary" onClick={() => setDetailId(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
