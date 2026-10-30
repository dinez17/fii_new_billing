import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useParams } from "react-router-dom";
import { api, errMessage } from "../../lib/api";
import { EntitySelect, type ProductOption } from "../../components/EntitySelect";
import { ProductSelect } from "../../components/ProductSelect";
import { DateInput } from "../../components/DateInput";
import { IconButton } from "../../components/IconButton";
import { documentPath, type DocumentKind, type SalesDocument } from "./SalesDocumentsPage";
import { useAuth } from "../../stores/auth";

interface Line { productId: string; description: string; hsnSac: string; quantity: string; unitPrice: string; discount: string; gstRate: string }
const blank = (): Line => ({ productId: "", description: "", hsnSac: "", quantity: "1", unitPrice: "", discount: "0", gstRate: "18" });
const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
const amount = (value: number) => `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function SalesDocumentForm({ kind }: { kind: DocumentKind }) {
  const { id } = useParams();
  const record = useQuery({ queryKey: ["sales-document", id], enabled: !!id, queryFn: async () => (await api.get<SalesDocument>(`/sales-documents/${id}`)).data });
  if (id && record.isLoading) return <p>Loading document…</p>;
  if (record.isError) return <div className="error">{errMessage(record.error)}</div>;
  if (record.data && record.data.kind !== kind) return <div className="error">Open this document from its correct register.</div>;
  return <Editor key={id || kind} kind={kind} record={record.data} />;
}
function Editor({ kind, record }: { kind: DocumentKind; record?: SalesDocument }) {
  const navigate = useNavigate(), qc = useQueryClient();
  const canUpdate = useAuth(s => s.hasPerm("invoice:update"));
  const [form, setForm] = useState(() => ({
    customerId: record?.customerId || "", documentDate: record?.documentDate.slice(0, 10) || today(), validUntil: record?.validUntil.slice(0, 10) || today(),
    chargeGst: record?.chargeGst ?? true, poNumber: record?.poNumber || "", subject: record?.subject || "", notes: record?.notes || "", terms: record?.terms || "",
    items: record?.items.map(item => ({ productId: item.productId || "", description: item.description, hsnSac: item.hsnSac || "", quantity: String(item.quantity), unitPrice: String(item.unitPrice), discount: String(item.discount), gstRate: String(item.gstRate) })) || [blank()],
  }));
  const readOnly = !!record && (record.status !== "OPEN" || !canUpdate);
  const setItem = (index: number, patch: Partial<Line>) => setForm(previous => ({ ...previous, items: previous.items.map((item, i) => i === index ? { ...item, ...patch } : item) }));
  const pick = (index: number, id: string, product?: ProductOption) => setItem(index, product ? { productId: id, description: product.name, hsnSac: product.hsnSac || "", unitPrice: String(Number(product.salePrice)), gstRate: String(Number(product.gstRate)) } : { productId: id });
  const subtotal = form.items.reduce((sum, item) => sum + Number(item.quantity || 0) * Number(item.unitPrice || 0), 0);
  const discount = form.items.reduce((sum, item) => sum + Number(item.discount || 0), 0);
  const tax = form.chargeGst ? form.items.reduce((sum, item) => sum + Math.max(Number(item.quantity || 0) * Number(item.unitPrice || 0) - Number(item.discount || 0), 0) * Number(item.gstRate || 0) / 100, 0) : 0;
  const save = useMutation({ mutationFn: async () => {
    const body = { ...form, kind, version: record?.version, terms: !record && !form.terms ? undefined : form.terms,
      items: form.items.map(item => ({ productId: item.productId || undefined, description: item.description, hsnSac: item.hsnSac || undefined, quantity: Number(item.quantity), unitPrice: Number(item.unitPrice), discount: Number(item.discount || 0), gstRate: Number(item.gstRate || 0) })),
    };
    return record ? (await api.put(`/sales-documents/${record.id}`, body)).data : (await api.post("/sales-documents", body)).data;
  }, onSuccess: async () => { await qc.invalidateQueries({ queryKey: ["sales-documents"] }); await qc.invalidateQueries({ queryKey: ["sales-document", record?.id] }); navigate(documentPath(kind)); } });
  const valid = form.customerId && form.items.length && form.items.every(item => item.description.trim() && Number(item.quantity) > 0 && Number(item.unitPrice) >= 0 && item.unitPrice !== "" && Number(item.discount || 0) <= Number(item.quantity) * Number(item.unitPrice));
  return <>
    <div className="toolbar"><h2 className="page-title" style={{ margin: 0 }}>{record ? `${readOnly ? "View" : "Edit"} ${record.documentNumber}` : `New ${kind === "QUOTATION" ? "quotation" : "proforma invoice"}`}</h2><div className="spacer" /><button onClick={() => navigate(documentPath(kind))}>← Back to list</button></div>
    {record?.sourceDocumentId && <p><button className="small" onClick={() => navigate(`/quotations/${record.sourceDocumentId}/edit`)}>View source quotation</button></p>}
    {readOnly && <div className="card" role="status">{record.status === "OPEN" ? "Read-only access to this document." : `This document is ${record.status.toLowerCase()} and cannot be edited.`}
      {record.invoiceId && <button onClick={() => navigate(`/invoices/${record.invoiceId}/edit`)}>Open invoice</button>}
      {record.convertedDocumentId && <button onClick={() => navigate(`/proformas/${record.convertedDocumentId}/edit`)}>Open proforma</button>}
      {record.cancelReason && <p>{record.cancelReason}</p>}
    </div>}
    <form onSubmit={e => { e.preventDefault(); if (valid && !readOnly) save.mutate(); }}>
      <fieldset className="document-fieldset" disabled={readOnly || save.isPending}>
        <div className="card">
          <div className="document-grid">
            <label>Customer *<EntitySelect kind="customers" value={form.customerId} activeOnly onChange={customerId => setForm({ ...form, customerId })} /></label>
            <label>Tax treatment<select aria-label="Document tax treatment" value={form.chargeGst ? "GST" : "WITHOUT_GST"} onChange={e => setForm({ ...form, chargeGst: e.target.value === "GST" })}><option value="GST">With GST</option><option value="WITHOUT_GST">Without GST</option></select></label>
            <label>Document date<DateInput required aria-label="Document date" value={form.documentDate} onChange={e => setForm({ ...form, documentDate: e.target.value })} /></label>
            <label>Valid until<DateInput required aria-label="Valid until" value={form.validUntil} onChange={e => setForm({ ...form, validUntil: e.target.value })} /></label>
            <label>Subject<input maxLength={200} value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} /></label>
            <label>PO reference<input maxLength={100} value={form.poNumber} onChange={e => setForm({ ...form, poNumber: e.target.value })} /></label>
          </div>
        </div>
        <div className="card"><h3>Items</h3><table><thead><tr><th>Product</th><th>Description</th><th>HSN/SAC</th><th>Qty</th><th>Rate</th><th>Discount</th><th>GST %</th><th aria-label="Actions" /></tr></thead><tbody>
          {form.items.map((item, index) => <tr key={index}>
            <td style={{ minWidth: 180 }}><ProductSelect value={item.productId} onChange={(id, product) => pick(index, id, product)} /></td>
            <td><input aria-label={`Item ${index + 1} description`} required maxLength={300} value={item.description} onChange={e => setItem(index, { description: e.target.value })} /></td>
            <td><input aria-label={`Item ${index + 1} HSN`} maxLength={10} value={item.hsnSac} onChange={e => setItem(index, { hsnSac: e.target.value })} /></td>
            <td><input aria-label={`Item ${index + 1} quantity`} type="number" min="0.001" step="0.001" required value={item.quantity} onChange={e => setItem(index, { quantity: e.target.value })} /></td>
            <td><input aria-label={`Item ${index + 1} rate`} type="number" min="0" step="0.01" required value={item.unitPrice} onChange={e => setItem(index, { unitPrice: e.target.value })} /></td>
            <td><input aria-label={`Item ${index + 1} discount`} type="number" min="0" step="0.01" value={item.discount} onChange={e => setItem(index, { discount: e.target.value })} /></td>
            <td><select aria-label={`Item ${index + 1} GST rate`} disabled={!form.chargeGst} value={item.gstRate} onChange={e => setItem(index, { gstRate: e.target.value })}>{[...new Set([0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, Number(item.gstRate)])].sort((a, b) => a - b).map(rate => <option key={rate} value={rate}>{rate}</option>)}</select></td>
            <td><IconButton type="button" label={`Remove item ${index + 1}`} icon="close" disabled={form.items.length <= 1} onClick={() => setForm({ ...form, items: form.items.filter((_, i) => i !== index) })} /></td>
          </tr>)}
        </tbody></table>
          <button type="button" style={{ marginTop: 12 }} disabled={form.items.length >= 50} onClick={() => setForm({ ...form, items: [...form.items, blank()] })}>+ Add item</button>
        </div>
        <div className="card document-grid">
          <div><label>Notes<textarea maxLength={1000} rows={3} value={form.notes} onChange={e => setForm({ ...form, notes: e.target.value })} /></label><label>Terms & conditions<textarea maxLength={2000} rows={4} placeholder="Uses saved quotation/proforma terms when creating a document if left blank." value={form.terms} onChange={e => setForm({ ...form, terms: e.target.value })} /></label></div>
          <div className="document-totals"><p>Subtotal {amount(subtotal)}</p><p>Discount {amount(discount)}</p><p>Estimated GST {amount(tax)}</p><strong>Total {amount(Math.round(subtotal - discount + tax))}</strong><p className="document-help">Preview only. Final rounding and GST split are calculated by the server. No stock is deducted on quotation or proforma creation.</p></div>
        </div>
      </fieldset>
      {save.isError && <div className="error" role="alert">{errMessage(save.error)}</div>}
      {!readOnly && <div className="toolbar"><div className="spacer" /><button type="button" onClick={() => navigate(documentPath(kind))}>Cancel</button><button className="primary" disabled={!valid || save.isPending}>{save.isPending ? "Saving…" : record ? "Save changes" : "Create document"}</button></div>}
    </form>
  </>;
}
