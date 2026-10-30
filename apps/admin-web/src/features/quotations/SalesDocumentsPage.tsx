import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { api, errMessage } from "../../lib/api";
import { formatDate } from "../../lib/date";
import { downloadPdf } from "../../lib/pdf-download";
import { useAuth } from "../../stores/auth";
import { IconButton } from "../../components/IconButton";
import { RowsPerPage, usePageSize, ListPager } from "../../components/ListPagination";
import { FinancialReportPeriod, useFinancialReportPeriod } from "../../components/FinancialReportPeriod";
import { DateInput } from "../../components/DateInput";

export type DocumentKind = "QUOTATION" | "PROFORMA";
export interface SalesDocument {
  id: string; kind: DocumentKind; documentNumber: string; customerId: string;
  customer: { id: string; name: string; phone?: string }; documentDate: string; validUntil: string;
  status: "OPEN" | "CONVERTED" | "CANCELLED"; version: number; chargeGst: boolean; grandTotal: string;
  poNumber?: string; subject?: string; notes?: string; terms?: string; cancelReason?: string;
  invoiceId?: string; invoice?: { invoiceNumber: string; status: string }; sourceDocumentId?: string; convertedDocumentId?: string;
  items: { productId?: string; description: string; hsnSac?: string; quantity: number; unitPrice: number; discount: number; gstRate: number }[];
}
export const documentPath = (kind: DocumentKind) => kind === "QUOTATION" ? "/quotations" : "/proformas";
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const inr = (value: unknown) => `₹${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

export function SalesDocumentsPage({ kind }: { kind: DocumentKind }) {
  const navigate = useNavigate(), qc = useQueryClient(), hasPerm = useAuth(s => s.hasPerm);
  const [search, setSearch] = useState(""), [status, setStatus] = useState("OPEN"), [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize(() => setPage(1));
  const period = useFinancialReportPeriod(() => setPage(1));
  const [error, setError] = useState(""), [notice, setNotice] = useState(""), [busy, setBusy] = useState("");
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null);
  const iframe = useRef<HTMLIFrameElement>(null);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview.url); }, [preview]);
  const [conversion, setConversion] = useState<{ row: SalesDocument; target: "PROFORMA" | "INVOICE"; chargeGst: boolean; documentDate: string; dueDate: string } | null>(null);
  const [cancelling, setCancelling] = useState<SalesDocument | null>(null), [reason, setReason] = useState("");
  const list = useQuery({ queryKey: ["sales-documents", kind, search, status, period.fyCode, period.from, period.to, page, pageSize], enabled: period.ready,
    queryFn: async () => (await api.get("/sales-documents", { params: { kind, search: search || undefined, status: status || undefined, ...period.params, page, limit: pageSize } })).data as { items: SalesDocument[]; total: number },
  });
  async function run(key: string, task: () => Promise<void>) { setBusy(key); setError(""); setNotice(""); try { await task(); } catch (error) { setError(errMessage(error)); } finally { setBusy(""); } }
  async function pdf(row: SalesDocument, print: boolean) {
    await run(row.id, async () => {
      const { data } = await api.get<Blob>(`/sales-documents/${row.id}/pdf`, { responseType: "blob" });
      if (!print) { await downloadPdf(data, row.documentNumber); return; }
      if (new TextDecoder().decode(await data.slice(0, 5).arrayBuffer()) !== "%PDF-") throw new Error("No valid PDF was received. Disable download-manager interception for this site and try again.");
      setPreview({ url: URL.createObjectURL(new Blob([data], { type: "application/pdf" })), name: row.documentNumber });
    });
  }
  function closePreview() { if (preview) URL.revokeObjectURL(preview.url); setPreview(null); }
  const title = kind === "QUOTATION" ? "Quotations" : "Proforma invoices";
  return <>
    <h2 className="page-title">{title}</h2>
    <div className="toolbar">
      <RowsPerPage value={pageSize} onChange={setPageSize} />
      <input aria-label="Search sales documents" placeholder="Number / customer / subject…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
      <select aria-label="Document status" value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}><option value="OPEN">Open</option><option value="">All statuses</option><option value="CONVERTED">Converted</option><option value="CANCELLED">Cancelled</option></select>
      <FinancialReportPeriod period={period} />
      <div className="spacer" />
      {hasPerm("invoice:create") && <button className="primary" onClick={() => navigate(documentPath(kind) + "/new")}>+ New {kind === "QUOTATION" ? "quotation" : "proforma"}</button>}
    </div>
    <p className="document-help">These documents do not affect stock, outstanding balances or GST reports until converted to an invoice.</p>
    {(error || list.isError) && <div className="error" role="alert">{error || errMessage(list.error)}</div>}
    {notice && <div className="card" role="status">{notice}</div>}
    {list.isLoading && <p>Loading…</p>}
    <table><thead><tr><th>Number</th><th>Date</th><th>Customer</th><th>Valid until</th><th>Total</th><th>Status / conversion</th><th aria-label="Actions" /></tr></thead><tbody>
      {list.data?.items.map(row => <tr key={row.id}>
        <td><code>{row.documentNumber}</code><div><span className="badge">{row.chargeGst ? "GST" : "Without GST"}</span></div></td>
        <td>{formatDate(row.documentDate)}</td><td>{row.customer.name}{row.subject && <div className="document-help">{row.subject}</div>}</td>
        <td>{formatDate(row.validUntil)}</td><td>{inr(row.grandTotal)}</td><td><span className={`badge ${row.status === "CANCELLED" ? "warn" : row.status === "CONVERTED" ? "info" : "ok"}`}>{row.status}</span>
          {row.invoiceId && <button className="small" onClick={() => navigate(`/invoices/${row.invoiceId}/edit`)}>{row.invoice?.invoiceNumber || "Open invoice"}</button>}
          {row.convertedDocumentId && <button className="small" onClick={() => navigate(`/proformas/${row.convertedDocumentId}/edit`)}>Open proforma</button>}
          {row.cancelReason && <div className="document-help">{row.cancelReason}</div>}
        </td>
        <td><div className="document-actions">
          {row.status === "OPEN" && hasPerm("invoice:update") && <IconButton label="Edit document" icon="edit" onClick={() => navigate(`${documentPath(kind)}/${row.id}/edit`)} />}
          <IconButton label="Print / preview PDF" icon="print" disabled={!!busy} onClick={() => void pdf(row, true)} />
          <IconButton label="Download PDF" icon="download" disabled={!!busy} onClick={() => void pdf(row, false)} />
          {row.status !== "CANCELLED" && <IconButton label="Email document" icon="mail" disabled={!!busy} onClick={() => void run(row.id, async () => { const { data } = await api.post(`/sales-documents/${row.id}/email`); setNotice(`Email sent to ${data.to}`); })} />}
          {row.status === "OPEN" && hasPerm("invoice:create") && hasPerm("invoice:update") && <IconButton label="Convert document" icon="convert" onClick={() => setConversion({ row, target: "INVOICE", chargeGst: row.chargeGst, documentDate: today(), dueDate: today() })} />}
          {row.status === "OPEN" && hasPerm("invoice:update") && <IconButton label="Cancel document" icon="close" className="danger" onClick={() => { setCancelling(row); setReason(""); }} />}
        </div></td>
      </tr>)}
      {list.data?.items.length === 0 && <tr><td colSpan={7}>No documents match these filters.</td></tr>}
    </tbody></table>
    <ListPager page={page} limit={pageSize} total={list.data?.total ?? 0} onChange={setPage} />
    {conversion && <div className="modal-overlay"><form className="modal" role="dialog" aria-modal="true" aria-label="Convert document" onSubmit={e => { e.preventDefault(); void run(conversion.row.id, async () => {
      const { data } = await api.post<{ id: string; kind: "PROFORMA" | "INVOICE"; number: string }>(`/sales-documents/${conversion.row.id}/convert`, { target: conversion.target, chargeGst: conversion.chargeGst, documentDate: conversion.documentDate, dueDate: conversion.dueDate, version: conversion.row.version });
      await qc.invalidateQueries({ queryKey: ["sales-documents"] }); await qc.invalidateQueries({ queryKey: ["invoices"] }); setConversion(null);
      navigate(data.kind === "INVOICE" ? `/invoices/${data.id}/edit` : `/proformas/${data.id}/edit`);
    }); }}>
      <h3>Convert {conversion.row.documentNumber}</h3>
      <label>Convert to<select value={conversion.target} onChange={e => setConversion({ ...conversion, target: e.target.value as "PROFORMA" | "INVOICE" })}><option value="INVOICE">Invoice</option>{conversion.row.kind === "QUOTATION" && <option value="PROFORMA">Proforma invoice</option>}</select></label>
      <label>Tax treatment<select value={conversion.chargeGst ? "GST" : "WITHOUT_GST"} onChange={e => setConversion({ ...conversion, chargeGst: e.target.value === "GST" })}><option value="GST">With GST</option><option value="WITHOUT_GST">Without GST</option></select></label>
      <div className="document-grid"><label>Document date<DateInput required aria-label="Conversion document date" value={conversion.documentDate} onChange={e => setConversion({ ...conversion, documentDate: e.target.value })} /></label><label>{conversion.target === "INVOICE" ? "Due date" : "Valid until"}<DateInput required aria-label="Conversion due date" value={conversion.dueDate} onChange={e => setConversion({ ...conversion, dueDate: e.target.value })} /></label></div>
      <p className="document-help">{conversion.target === "INVOICE" ? "Creates one invoice in the selected register and posts its stock and accounting entries. Invoice notifications follow your tenant settings." : "Creates a separate proforma number. No stock or accounting entry is posted."}</p>
      {error && <div className="error" role="alert">{error}</div>}
      <div className="actions"><button type="button" disabled={!!busy} onClick={() => setConversion(null)}>Close</button><button className="primary" disabled={!!busy}>{busy ? "Converting…" : "Convert"}</button></div>
    </form></div>}
    {cancelling && <div className="modal-overlay"><form className="modal" role="dialog" aria-modal="true" aria-label="Cancel document" onSubmit={e => { e.preventDefault(); void run(cancelling.id, async () => { await api.post(`/sales-documents/${cancelling.id}/cancel`, { version: cancelling.version, reason }); setCancelling(null); await qc.invalidateQueries({ queryKey: ["sales-documents"] }); }); }}>
      <h3>Cancel {cancelling.documentNumber}</h3><label>Reason<textarea required minLength={3} maxLength={300} value={reason} onChange={e => setReason(e.target.value)} /></label>
      {error && <div className="error">{error}</div>}<div className="actions"><button type="button" disabled={!!busy} onClick={() => setCancelling(null)}>Keep document</button><button className="danger" disabled={!!busy}>Cancel document</button></div>
    </form></div>}
    {preview && <div className="modal-overlay"><div className="modal document-preview" role="dialog" aria-modal="true" aria-label="Print document"><h3>{preview.name}</h3><iframe ref={iframe} title="Document PDF preview" src={preview.url} /><div className="actions"><button onClick={closePreview}>Close</button><button className="primary" onClick={() => { try { iframe.current?.contentWindow?.print(); } catch { setError("Use the PDF viewer's print button or download the PDF to print."); } }}>Print</button></div></div></div>}
  </>;
}
