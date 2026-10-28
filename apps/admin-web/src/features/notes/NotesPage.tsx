import { formatDate } from "../../lib/date";
import { IconButton } from "../../components/IconButton";
import { RowsPerPage, usePageSize, ListTable } from "../../components/ListPagination";
import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";
import { TransactionFilters, useTransactionPeriod } from "../../components/TransactionFilters";

type Kind = "credit" | "debit";
interface NoteRow {
  id: string; noteNumber: string; noteDate: string; reason: string; total: string; status: string;
  invoice: { invoiceNumber: string; customer: { name: string } };
}
interface InvoiceLite { id: string; invoiceNumber: string; grandTotal: string; customer: { name: string } }
interface InvoiceItemFull { id: string; productId?: string; description: string; hsnSac?: string; quantity: string; unitPrice: string; discount: string; gstRate: string }
interface InvoiceFull { id: string; invoiceNumber: string; items: InvoiceItemFull[] }
interface Item { description: string; quantity: string; unitPrice: string; gstRate: string }
interface NoteDetailItem {
  description: string; hsnSac?: string | null; quantity: number; unitPrice: number;
  gstRate: number; taxableValue: number; cgst: number; sgst: number; igst: number; lineTotal: number;
}
interface NoteDetail {
  id: string; noteNumber: string; noteDate: string; reason: string; status: string;
  taxableValue: string; cgst: string; sgst: string; igst: string; total: string;
  items: NoteDetailItem[];
  invoice: {
    invoiceNumber: string; invoiceDate: string; placeOfSupply: string; grandTotal: string;
    customer: { name: string; phone: string; email?: string | null; gstin?: string | null };
  };
}

const EMPTY_ITEM: Item = { description: "", quantity: "1", unitPrice: "", gstRate: "18" };
const inr = (v: unknown) => `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

export function NotesPage() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPerm);
  const [kind, setKind] = useState<Kind>("credit");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize(() => setPage(1));
  const period = useTransactionPeriod(() => setPage(1));
  const [status, setStatus] = useState("");
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [retQty, setRetQty] = useState<Record<string, string>>({}); // invoiceItemId → qty to return
  const [form, setForm] = useState({
    invoiceId: "",
    invoiceSearch: "",
    noteDate: new Date().toISOString().slice(0, 10),
    reason: "",
    items: [{ ...EMPTY_ITEM }],
  });

  const endpoint = kind === "credit" ? "/credit-notes" : "/debit-notes";
  const module = kind === "credit" ? "credit_note" : "debit_note";

  // launched from the Invoices page "Return" button with a preselected invoice
  const location = useLocation() as { state?: { invoiceId?: string; invoiceNumber?: string; kind?: Kind } };
  useEffect(() => {
    const s = location.state;
    if (s?.invoiceId) {
      setKind(s.kind ?? "credit");
      setCreating(true);
      setForm((f) => ({ ...f, invoiceId: s.invoiceId!, invoiceSearch: s.invoiceNumber ?? "" }));
    }
  }, [location.state]);

  const list = useQuery({
    queryKey: ["notes", kind, page, pageSize, period.params, status, search],
    enabled: period.ready,
    queryFn: async () => (await api.get(endpoint, { params: { page, limit: pageSize, ...period.params, status: status || undefined, search: search || undefined } })).data as
      { items: NoteRow[]; total: number; limit: number },
  });

  const invoices = useQuery({
    queryKey: ["invoices-lite", form.invoiceSearch],
    queryFn: async () => (await api.get("/invoices", {
      params: { page: 1, limit: 20, search: form.invoiceSearch || undefined },
    })).data.items as InvoiceLite[],
    enabled: creating,
  });

  // for a sales return (credit note) we return specific invoiced lines
  const invoiceDetail = useQuery({
    queryKey: ["invoice-detail-note", form.invoiceId],
    queryFn: async () => (await api.get(`/invoices/${form.invoiceId}`)).data as InvoiceFull,
    enabled: creating && kind === "credit" && !!form.invoiceId,
  });

  const create = useMutation({
    mutationFn: async () => {
      const items = kind === "credit"
        ? (invoiceDetail.data?.items ?? [])
            .map((it) => {
              const q = Number(retQty[it.id] || 0);
              return {
                productId: it.productId ?? undefined,
                description: it.description,
                hsnSac: it.hsnSac ?? undefined,
                quantity: q,
                unitPrice: Number(it.unitPrice),
                // prorate the line's discount to the returned quantity
                discount: Number(it.discount || 0) * (Number(it.quantity) ? q / Number(it.quantity) : 0),
                gstRate: Number(it.gstRate),
              };
            })
            .filter((it) => it.quantity > 0)
        : form.items.map((it) => ({
            description: it.description, quantity: Number(it.quantity),
            unitPrice: Number(it.unitPrice), gstRate: Number(it.gstRate),
          }));
      if (items.length === 0) throw new Error(kind === "credit" ? "Enter a return quantity for at least one item" : "Add at least one item");
      await api.post(endpoint, { invoiceId: form.invoiceId, noteDate: form.noteDate, reason: form.reason, items });
    },
    onSuccess: () => {
      setCreating(false); setError(""); setRetQty({});
      setForm({ ...form, invoiceId: "", reason: "", items: [{ ...EMPTY_ITEM }] });
      qc.invalidateQueries({ queryKey: ["notes"] });
    },
    onError: (err) => setError(errMessage(err)),
  });

  async function cancel(n: NoteRow) {
    if (!confirm(`Cancel ${n.noteNumber}?`)) return;
    try { await api.post(`${endpoint}/${n.id}/cancel`); qc.invalidateQueries({ queryKey: ["notes"] }); }
    catch (err) { alert(errMessage(err)); }
  }

  const [viewId, setViewId] = useState<string | null>(null);
  const detail = useQuery({
    queryKey: ["note-detail", kind, viewId],
    queryFn: async () => (await api.get(`${endpoint}/${viewId}`)).data as NoteDetail,
    enabled: !!viewId,
  });

  async function openPdf(n: NoteRow) {
    try {
      const { data } = await api.get(`${endpoint}/${n.id}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) { alert(errMessage(err)); }
  }

  const setItem = (i: number, patch: Partial<Item>) => {
    const items = [...form.items];
    items[i] = { ...items[i], ...patch };
    setForm({ ...form, items });
  };

  return (
    <>
      <h2 className="page-title">Sales Returns / Debit Notes</h2>
      <div className="toolbar">
        <RowsPerPage value={pageSize} onChange={setPageSize} />
        <input aria-label="Search note number" placeholder="Search note number…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select aria-label="Note status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option><option>ISSUED</option><option>ADJUSTED</option><option>CANCELLED</option></select>
        <TransactionFilters period={period} />
        <button className={kind === "credit" ? "primary" : ""} onClick={() => { setKind("credit"); setPage(1); }}>Sales Returns (Credit)</button>
        <button className={kind === "debit" ? "primary" : ""} onClick={() => { setKind("debit"); setPage(1); }}>Debit Notes</button>
        <div className="spacer" />
        {hasPerm(`${module}:create`) && (
          <button className="primary" onClick={() => { setCreating(true); setError(""); }}>
            + New {kind === "credit" ? "Sales Return" : "Debit Note"}
          </button>
        )}
      </div>

      <table>
        <thead><tr><th>Number</th><th>Date</th><th>Invoice</th><th>Customer</th><th>Reason</th><th>Total</th><th>Status</th><th /></tr></thead>
        <tbody>
          {list.data?.items.map((n) => (
            <tr key={n.id}>
              <td><code>{n.noteNumber}</code></td>
              <td>{formatDate(n.noteDate)}</td>
              <td><code>{n.invoice.invoiceNumber}</code></td>
              <td>{n.invoice.customer.name}</td>
              <td>{n.reason}</td>
              <td>{inr(n.total)}</td>
              <td><span className={`badge ${n.status === "ISSUED" ? "ok" : "warn"}`}>{n.status}</span></td>
              <td style={{ whiteSpace: "nowrap" }}>
                <IconButton className="small" onClick={() => setViewId(n.id)} icon="view" label="View">View</IconButton>{" "}
                <IconButton className="small" onClick={() => void openPdf(n)} icon="download" label="PDF">PDF</IconButton>{" "}
                {hasPerm(`${module}:update`) && n.status !== "CANCELLED" && (
                  <IconButton className="small danger" onClick={() => void cancel(n)} icon="close" label="Cancel">Cancel</IconButton>
                )}
              </td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr><td colSpan={8} style={{ color: "var(--muted)" }}>No {kind === "credit" ? "sales returns" : "debit notes"} yet.</td></tr>
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

      {viewId && (
        <div className="modal-overlay" onClick={() => setViewId(null)}>
          <div className="modal" style={{ width: 680 }} onClick={(e) => e.stopPropagation()}>
            {detail.isLoading && <p style={{ color: "var(--muted)" }}>Loading…</p>}
            {detail.data && (
              <>
                <h3 style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span>{kind === "credit" ? "Sales Return" : "Debit Note"} <code>{detail.data.noteNumber}</code></span>
                  <span className={`badge ${detail.data.status === "ISSUED" ? "ok" : "warn"}`}>{detail.data.status}</span>
                </h3>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4, fontSize: 13, marginBottom: 10 }}>
                  <div><span style={{ color: "var(--muted)" }}>Date : </span>{formatDate(detail.data.noteDate)}</div>
                  <div><span style={{ color: "var(--muted)" }}>Against invoice : </span><code>{detail.data.invoice.invoiceNumber}</code></div>
                  <div><span style={{ color: "var(--muted)" }}>Customer : </span>{detail.data.invoice.customer.name}</div>
                  <div><span style={{ color: "var(--muted)" }}>Mobile : </span>{detail.data.invoice.customer.phone}</div>
                  <div style={{ gridColumn: "1 / -1" }}><span style={{ color: "var(--muted)" }}>Reason : </span>{detail.data.reason}</div>
                </div>
                <ListTable style={{ fontSize: 13 }}>
                  <thead>
                    <tr>
                      <th>Item</th><th>HSN</th>
                      <th style={{ textAlign: "right" }}>Qty</th>
                      <th style={{ textAlign: "right" }}>Rate</th>
                      <th style={{ textAlign: "right" }}>GST%</th>
                      <th style={{ textAlign: "right" }}>Tax</th>
                      <th style={{ textAlign: "right" }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.data.items.map((it, i) => (
                      <tr key={i}>
                        <td>{it.description}</td>
                        <td>{it.hsnSac ?? "-"}</td>
                        <td style={{ textAlign: "right" }}>{Number(it.quantity)}</td>
                        <td style={{ textAlign: "right" }}>{inr(it.unitPrice)}</td>
                        <td style={{ textAlign: "right" }}>{Number(it.gstRate)}%</td>
                        <td style={{ textAlign: "right" }}>{inr(Number(it.cgst) + Number(it.sgst) + Number(it.igst))}</td>
                        <td style={{ textAlign: "right" }}>{inr(it.lineTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </ListTable>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 18, marginTop: 8, fontSize: 13 }}>
                  <span><span style={{ color: "var(--muted)" }}>Taxable </span><strong>{inr(detail.data.taxableValue)}</strong></span>
                  {Number(detail.data.igst) > 0
                    ? <span><span style={{ color: "var(--muted)" }}>IGST </span><strong>{inr(detail.data.igst)}</strong></span>
                    : <>
                        <span><span style={{ color: "var(--muted)" }}>CGST </span><strong>{inr(detail.data.cgst)}</strong></span>
                        <span><span style={{ color: "var(--muted)" }}>SGST </span><strong>{inr(detail.data.sgst)}</strong></span>
                      </>}
                  <span><span style={{ color: "var(--muted)" }}>Total </span><strong>{inr(detail.data.total)}</strong></span>
                </div>
                <div className="actions">
                  <button onClick={() => setViewId(null)}>Close</button>
                  <button className="primary" onClick={() => void openPdf({ id: detail.data!.id, noteNumber: detail.data!.noteNumber } as NoteRow)}>Open PDF</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {creating && (
        <div className="modal-overlay" onClick={() => setCreating(false)}>
          <div className="modal" style={{ width: 640 }} onClick={(e) => e.stopPropagation()}>
            <h3>New {kind === "credit" ? "Sales Return (Credit Note)" : "Debit Note"}</h3>
            <label>Find invoice</label>
            <input placeholder="Type invoice number or customer name…" value={form.invoiceSearch}
              onChange={(e) => setForm({ ...form, invoiceSearch: e.target.value })} />
            <label>Against invoice *</label>
            <select value={form.invoiceId} onChange={(e) => { setForm({ ...form, invoiceId: e.target.value }); setRetQty({}); }}>
              <option value="">— select —</option>
              {invoices.data?.map((i) => (
                <option key={i.id} value={i.id}>{i.invoiceNumber} · {i.customer.name} · {inr(i.grandTotal)}</option>
              ))}
            </select>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
              <div><label>Note date</label>
                <input type="date" value={form.noteDate} onChange={(e) => setForm({ ...form, noteDate: e.target.value })} /></div>
              <div><label>Reason * <span style={{ color: "var(--muted)", fontWeight: 400 }}>(min 3 characters)</span></label>
                <input value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })}
                  placeholder={kind === "credit" ? "Service downtime adjustment" : "Undercharged amount"} /></div>
            </div>
            {kind === "credit" ? (
              !form.invoiceId ? (
                <p style={{ color: "var(--muted)", marginTop: 10 }}>Select an invoice to choose which items to return.</p>
              ) : invoiceDetail.isLoading ? (
                <p style={{ color: "var(--muted)", marginTop: 10 }}>Loading invoiced items…</p>
              ) : (
                <>
                  <label>Items to return</label>
                  <table style={{ fontSize: 13 }}>
                    <thead><tr><th>Item</th><th style={{ textAlign: "right" }}>Invoiced</th><th style={{ textAlign: "right" }}>Rate</th><th style={{ textAlign: "right" }}>GST%</th><th style={{ width: 110 }}>Return qty</th></tr></thead>
                    <tbody>
                      {invoiceDetail.data?.items.map((it) => (
                        <tr key={it.id}>
                          <td>{it.description}</td>
                          <td style={{ textAlign: "right" }}>{Number(it.quantity)}</td>
                          <td style={{ textAlign: "right" }}>{inr(it.unitPrice)}</td>
                          <td style={{ textAlign: "right" }}>{Number(it.gstRate)}%</td>
                          <td><input type="number" min={0} max={Number(it.quantity)} value={retQty[it.id] ?? ""}
                            onChange={(e) => setRetQty({ ...retQty, [it.id]: e.target.value })} placeholder="0" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )
            ) : (
              <>
                <label>Items</label>
                <table style={{ fontSize: 13 }}>
                  <thead><tr><th style={{ width: "45%" }}>Description</th><th>Qty</th><th>Rate ₹</th><th>GST %</th><th /></tr></thead>
                  <tbody>
                    {form.items.map((it, i) => (
                      <tr key={i}>
                        <td><input value={it.description} onChange={(e) => setItem(i, { description: e.target.value })} /></td>
                        <td><input type="number" value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} /></td>
                        <td><input type="number" value={it.unitPrice} onChange={(e) => setItem(i, { unitPrice: e.target.value })} /></td>
                        <td>
                          <select value={it.gstRate} onChange={(e) => setItem(i, { gstRate: e.target.value })}>
                            <option>0</option><option>5</option><option>12</option><option>18</option><option>28</option>
                          </select>
                        </td>
                        <td>
                          {form.items.length > 1 && (
                            <IconButton className="small danger" onClick={() => setForm({ ...form, items: form.items.filter((_, x) => x !== i) })} icon="close" label="×">×</IconButton>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <button className="small" style={{ marginTop: 6 }}
                  onClick={() => setForm({ ...form, items: [...form.items, { ...EMPTY_ITEM }] })}>+ Add item</button>
              </>
            )}
            {error && <div className="error">{error}</div>}
            <div className="actions">
              <button onClick={() => setCreating(false)}>Cancel</button>
              <button className="primary"
                disabled={
                  create.isPending || !form.invoiceId || form.reason.trim().length < 3 ||
                  (kind === "credit"
                    ? (invoiceDetail.data?.items ?? []).every((it) => !(Number(retQty[it.id] || 0) > 0))
                    : form.items.some((it) => !it.description || !it.unitPrice))
                }
                onClick={() => create.mutate()}>
                {create.isPending ? "Creating…" : kind === "credit" ? "Create sales return" : "Create debit note"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
