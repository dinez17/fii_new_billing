import { formatDate } from "../../lib/date";
import { IconButton } from "../../components/IconButton";
import { RowsPerPage, usePageSize, ListTable } from "../../components/ListPagination";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";

interface InvoiceRow {
  id: string; invoiceNumber: string; invoiceDate: string; dueDate: string;
  grandTotal: string; amountPaid: string; balance: string; status: string; isInterState: boolean;
  poNumber?: string | null;
  customer: { id: string; name: string; phone: string };
}
interface InvoiceDetail extends InvoiceRow {
  subTotal: string; discountTotal: string; taxableValue: string;
  cgst: string; sgst: string; igst: string; roundOff: string;
  notes?: string; terms?: string; cancelReason?: string;
  items: { id: string; description: string; hsnSac?: string; quantity: string; unitPrice: string; discount: string; gstRate: string; lineTotal: string }[];
  creditNotes: { id: string; noteNumber: string; total: string }[];
}

const inr = (v: unknown) => `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

export function InvoicesPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const hasPerm = useAuth((s) => s.hasPerm);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize(() => setPage(1));
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("OUTSTANDING");
  const [fySelection, setFyCode] = useState<string | null>(null);
  const [fromSelection, setFrom] = useState<string | null>(null);
  const [to, setTo] = useState(() => {
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
    const part = (type: string) => parts.find((item) => item.type === type)!.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  });
  const [detailId, setDetailId] = useState<string | null>(null);

  const fys = useQuery({
    queryKey: ["financial-years"],
    queryFn: async () => (await api.get("/financial-years")).data as { id: string; code: string; isActive: boolean; startDate: string; endDate: string }[],
    enabled: hasPerm("financial_year:read"),
  });
  const fyCode = fySelection ?? fys.data?.find((fy) => fy.isActive)?.code ?? "";
  const selectedFy = fys.data?.find((fy) => fy.code === fyCode);
  const from = fromSelection ?? selectedFy?.startDate.slice(0, 10) ?? "";

  const list = useQuery({
    queryKey: ["invoices", page, search, status, fyCode, from, to, pageSize],
    enabled: !hasPerm("financial_year:read") || fys.isSuccess,
    queryFn: async () => (await api.get("/invoices", {
      params: {
        page, limit: pageSize,
        search: search || undefined,
        status: status || undefined,
        fyCode: fyCode || undefined,
        from: from || undefined,
        to: to || undefined,
      },
    })).data as { items: InvoiceRow[]; total: number; limit: number; totals: { billed: string; collected: string } },
  });

  const detail = useQuery({
    queryKey: ["invoice", detailId],
    queryFn: async () => (await api.get(`/invoices/${detailId}`)).data as InvoiceDetail,
    enabled: !!detailId,
  });

  async function downloadPdf(inv: { id: string; invoiceNumber: string }) {
    try {
      const { data } = await api.get(`/invoices/${inv.id}/pdf`, { responseType: "blob" });
      const url = URL.createObjectURL(data);
      window.open(url, "_blank");
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (err) { alert(errMessage(err)); }
  }

  const [mailing, setMailing] = useState<string | null>(null);

  async function mailInvoice(inv: { id: string; invoiceNumber: string }) {
    setMailing(inv.id);
    try {
      const { data } = await api.post(`/invoices/${inv.id}/email`);
      alert(`Invoice ${inv.invoiceNumber} emailed to ${data.to}`);
    } catch (err) {
      alert(errMessage(err));
    } finally {
      setMailing(null);
    }
  }

  async function cancelInvoice(inv: InvoiceRow) {
    const reason = prompt(`Cancel ${inv.invoiceNumber}? Enter a reason:`);
    if (!reason) return;
    try {
      await api.post(`/invoices/${inv.id}/cancel`, { reason });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      setDetailId(null);
    } catch (err) { alert(errMessage(err)); }
  }

  const statusBadge = (s: string) => {
    const cls = s === "PAID" ? "ok" : s === "CANCELLED" ? "warn" : s === "PARTIAL" ? "info" : s === "UNPAID" ? "pending" : "";
    return <span className={`badge ${cls}`}>{s}</span>;
  };

  return (
    <>
      <h2 className="page-title">Invoices</h2>
      <div className="toolbar">
        <RowsPerPage value={pageSize} onChange={setPageSize} />
        <input style={{ width: 200 }} placeholder="Search number / customer…" value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select aria-label="Invoice status" style={{ width: 180 }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="OUTSTANDING">Unpaid + partially paid</option>
          <option value="">All statuses</option>
          <option>UNPAID</option><option>PARTIAL</option><option>PAID</option><option>CANCELLED</option>
        </select>
        {hasPerm("financial_year:read") && (
          <select aria-label="Financial year" style={{ width: 130 }} value={fyCode} onChange={(e) => { setFyCode(e.target.value); setFrom(fys.data?.find((fy) => fy.code === e.target.value)?.startDate.slice(0, 10) ?? ""); setPage(1); }}>
            <option value="">All FY</option>
            {fys.data?.map((fy) => <option key={fy.id} value={fy.code}>{fy.code}{fy.isActive ? " ●" : ""}</option>)}
          </select>
        )}
        <input type="date" title="From date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
        <span style={{ color: "var(--muted)" }}>–</span>
        <input type="date" title="To date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
        <div className="spacer" />
        {hasPerm("invoice:create") && (
          <button className="primary" onClick={() => navigate("/invoices/new")}>+ New Invoice</button>
        )}
      </div>
      {fys.isError && <div className="error">{errMessage(fys.error)}</div>}
      {list.isError && <div className="error">{errMessage(list.error)}</div>}

      <table>
        <thead>
          <tr><th>Number</th><th>Date</th><th>Customer</th><th style={{ textAlign: "right" }}>Total</th><th style={{ textAlign: "right" }}>Balance</th><th>Due date</th><th>Status</th><th /></tr>
        </thead>
        <tbody>
          {list.data?.items.map((inv) => (
            <tr key={inv.id}>
              <td><code>{inv.invoiceNumber}</code>{inv.poNumber && <div title={inv.poNumber} style={{ maxWidth: 190, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>PO: {inv.poNumber}</div>}</td>
              <td>{formatDate(inv.invoiceDate)}</td>
              <td>{inv.customer.name}</td>
              <td style={{ textAlign: "right", fontWeight: 600 }}>{inr(inv.grandTotal)}</td>
              <td style={{ textAlign: "right", color: Number(inv.balance) > 0 ? "var(--danger)" : "var(--muted)" }}>{inr(inv.balance)}</td>
              <td>{formatDate(inv.dueDate)}</td>
              <td>{statusBadge(inv.status)}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                <IconButton className="small" onClick={() => setDetailId(inv.id)} icon="view" label="View">View</IconButton>{" "}
                <IconButton className="small" onClick={() => void downloadPdf(inv)} icon="download" label="PDF">PDF</IconButton>{" "}
                <IconButton className="small" disabled={mailing === inv.id} onClick={() => void mailInvoice(inv)} icon="mail" label={mailing === inv.id ? "Sending…" : "Mail"}>
                  {mailing === inv.id ? "Sending…" : "Mail"}
                </IconButton>{" "}
                {hasPerm("credit_note:create") && inv.status !== "CANCELLED" && (
                  <IconButton className="small" title="Sales return / credit note"
                    onClick={() => navigate("/notes", { state: { invoiceId: inv.id, invoiceNumber: inv.invoiceNumber, kind: "credit" } })} icon="return" label="Return">Return</IconButton>
                )}
                {hasPerm("invoice:update") && inv.status === "UNPAID" && <>
                  {" "}<IconButton className="small danger" icon="close" label="Cancel invoice" onClick={() => void cancelInvoice(inv)} />
                  {" "}<IconButton className="small" icon="edit" label="Edit invoice" onClick={() => navigate(`/invoices/${inv.id}/edit`)} />
                </>}
              </td>
            </tr>
          ))}
          {list.data && list.data.items.length === 0 && (
            <tr><td colSpan={8} style={{ color: "var(--muted)" }}>No invoices found.</td></tr>
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
            <h3>{detail.data.invoiceNumber} {statusBadge(detail.data.status)}</h3>
            {detail.data.poNumber && <p><strong>PO number:</strong> {detail.data.poNumber}</p>}
            <p style={{ color: "var(--muted)" }}>
              {detail.data.customer.name} · {formatDate(detail.data.invoiceDate)} · due {formatDate(detail.data.dueDate)}
              {detail.data.isInterState ? " · Inter-state (IGST)" : " · Intra-state (CGST+SGST)"}
            </p>
            {detail.data.cancelReason && <p className="error">Cancelled: {detail.data.cancelReason}</p>}
            <ListTable style={{ fontSize: 13 }}>
              <thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Disc</th><th>GST%</th><th style={{ textAlign: "right" }}>Amount</th></tr></thead>
              <tbody>
                {detail.data.items.map((it) => (
                  <tr key={it.id}>
                    <td>{it.description}</td>
                    <td>{Number(it.quantity)}</td>
                    <td>{Number(it.unitPrice).toFixed(2)}</td>
                    <td>{Number(it.discount).toFixed(2)}</td>
                    <td>{Number(it.gstRate)}%</td>
                    <td style={{ textAlign: "right" }}>{Number(it.lineTotal).toFixed(2)}</td>
                  </tr>
                ))}
              </tbody>
            </ListTable>
            <div style={{ textAlign: "right", marginTop: 10, lineHeight: 1.8 }}>
              Taxable {inr(detail.data.taxableValue)}<br />
              {Number(detail.data.igst) > 0
                ? <>IGST {inr(detail.data.igst)}<br /></>
                : <>CGST {inr(detail.data.cgst)} · SGST {inr(detail.data.sgst)}<br /></>}
              {Number(detail.data.roundOff) !== 0 && <>Round off {inr(detail.data.roundOff)}<br /></>}
              <strong>Total {inr(detail.data.grandTotal)}</strong>
              {Number(detail.data.amountPaid) > 0 && <> · Paid {inr(detail.data.amountPaid)}</>}
            </div>
            {detail.data.creditNotes.length > 0 && (
              <p style={{ color: "var(--muted)", marginTop: 8 }}>
                Credit notes: {detail.data.creditNotes.map((n) => `${n.noteNumber} (${inr(n.total)})`).join(", ")}
              </p>
            )}
            <div className="actions">
              {hasPerm("invoice:update") && detail.data.status === "UNPAID" && (
                <button className="danger" onClick={() => void cancelInvoice(detail.data)}>Cancel invoice</button>
              )}
              <button onClick={() => void downloadPdf(detail.data)}>Download PDF</button>
              <button disabled={mailing === detail.data.id} onClick={() => void mailInvoice(detail.data)}>
                {mailing === detail.data.id ? "Sending…" : "Email to customer"}
              </button>
              <button className="primary" onClick={() => setDetailId(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
