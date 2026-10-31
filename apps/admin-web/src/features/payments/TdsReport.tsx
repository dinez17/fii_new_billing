import {TdsClearings} from "./TdsClearings";
import { useAuth } from "../../stores/auth";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, errMessage } from "../../lib/api";
import { useTransactionPeriod } from "../../components/TransactionFilters";
import { RowsPerPage, usePageSize } from "../../components/ListPagination";
import { formatDate } from "../../lib/date";
interface TdsRow { customer: { id: string; code: string; name: string; gstin: string | null; phone: string | null; email: string | null }; tdsAmount: string; moneyReceived: string; entries: number }
interface Report { financialYear: { code: string; startDate: string; endDate: string }; items: TdsRow[]; totalTds: string; entries: number }
const inr = (value: unknown) => `₹${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function TdsReport() {
  const qc = useQueryClient();
  const [clearingPayment,setClearingPayment]=useState("");
  const canReview = useAuth(state => state.hasPerm("payment:update"));
  const [customerId, setCustomerId] = useState("");
  const [editId, setEditId] = useState("");
  const [review, setReview] = useState({ verifiedAmount: "", certificateReference: "", confirmedDate: "", note: "", certificateBase64: "" });
  const [fileError, setFileError] = useState("");
  const save = useMutation({ mutationFn: async () => api.post(`/payments/${editId}/tds-review`, { ...review, certificateBase64: review.certificateBase64 || undefined }), onSuccess: () => { setEditId(""); void qc.invalidateQueries({ queryKey: ["tds-details"] }); } });
  const userId = useAuth(state => state.user?.id);
  const [page, setPage] = useState(1), [search, setSearch] = useState("");
  const [pageSize, setPageSize] = usePageSize(() => setPage(1));
  const period = useTransactionPeriod(() => setPage(1));
  const query = useQuery({ queryKey: ["tds-report", userId, period.fyCode], enabled: period.ready && !!userId, queryFn: async () => (await api.get("/payments/tds-report", { params: { fyCode: period.fyCode || undefined } })).data as Report });
  const details = useQuery({ queryKey: ["tds-details", userId, period.fyCode, customerId], enabled: !!customerId,
    queryFn: async () => (await api.get(`/payments/tds-details/${customerId}`, { params: { fyCode: period.fyCode || undefined } })).data as Array<{ id: string; paymentDate: string; tdsAmount: string; receipt: { receiptNumber: string } | null; review: { verifiedAmount: string; certificateReference: string; confirmedDate: string; note: string; certificateBase64?: string } | null }> });
  const rows = query.data?.items.filter(row => [row.customer.name, row.customer.code, row.customer.gstin, row.customer.phone].some(v => v?.toLowerCase().includes(search.toLowerCase()))) ?? [];
  return <><h2 className="page-title">Customer TDS report</h2><div className="toolbar">
    {period.canRead && <select aria-label="TDS financial year" value={period.fyCode} onChange={e => period.setYear(e.target.value)}>{period.years.data?.map(fy => <option key={fy.id} value={fy.code}>{fy.code}{fy.isActive ? " ●" : ""}</option>)}</select>}
    <RowsPerPage value={pageSize} onChange={setPageSize} /><input aria-label="Search TDS customers" placeholder="Search customer / code / GSTIN / phone" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
  </div>{query.isPending && <p>Loading TDS report…</p>}{query.isError && <div className="error">{errMessage(query.error)}</div>}{period.years.isError && <div className="error">{errMessage(period.years.error)}</div>}
  {query.data && <><div className="card"><strong>FY {query.data.financialYear.code} · Total TDS deducted: {inr(query.data.totalTds)}</strong><p>{formatDate(query.data.financialYear.startDate)} – {formatDate(query.data.financialYear.endDate)} · Payment entries: {query.data.entries} · Customers: {query.data.items.length}</p><p className="document-help">Full financial-year totals by payment date. Reconcile recorded deductions with your tax-credit statement.</p></div>
  <table><thead><tr><th>Code</th><th>Customer</th><th>GSTIN</th><th>Phone / email</th><th>Entries</th><th>TDS deducted</th><th /></tr></thead><tbody>{rows.slice((page-1)*pageSize,page*pageSize).map(row => <tr key={row.customer.id}><td>{row.customer.code}</td><td>{row.customer.name}</td><td>{row.customer.gstin ?? "—"}</td><td>{row.customer.phone ?? "—"}<br />{row.customer.email ?? ""}</td><td>{row.entries}</td><td>{inr(row.tdsAmount)}</td><td><button onClick={() => { setCustomerId(row.customer.id); setEditId(""); }}>Review credits</button></td></tr>)}{!rows.length && <tr><td colSpan={6}>No TDS entries found.</td></tr>}</tbody></table>
  <div className="pagination"><button disabled={page <= 1} onClick={() => setPage(page-1)}>Previous</button><span>Page {page} of {Math.max(1,Math.ceil(rows.length/pageSize))} · {rows.length} customers</span><button disabled={page*pageSize >= rows.length} onClick={() => setPage(page+1)}>Next</button></div></>}
  {clearingPayment && <TdsClearings paymentId={clearingPayment} close={()=>setClearingPayment("")} />}
  {customerId && <div className="modal-overlay entry-fullpage-overlay"><div className="modal" role="dialog" aria-modal="true"><h3>TDS credit reconciliation</h3><p>Record verified tax credits and certificate evidence. This does not change the original receipt, customer outstanding or clear TDS from the balance sheet.</p>
    {details.isError && <div className="error">{errMessage(details.error)}</div>}
    <table><thead><tr><th>Receipt / date</th><th>Deducted</th><th>Verified</th><th>Unverified</th><th>Certificate</th><th /></tr></thead><tbody>{details.data?.map(p => <tr key={p.id}><td>{p.receipt?.receiptNumber} · {formatDate(p.paymentDate)}</td><td>{inr(p.tdsAmount)}</td><td>{inr(p.review?.verifiedAmount ?? 0)}</td><td>{inr(Number(p.tdsAmount)-Number(p.review?.verifiedAmount ?? 0))}</td><td>{p.review?.certificateReference ?? "Not reviewed"}{p.review?.certificateBase64 && <a href={`data:application/pdf;base64,${p.review.certificateBase64}`} download="tds-certificate.pdf">Download certificate</a>}</td><td>{canReview && <button onClick={() => { setEditId(p.id); setFileError(""); save.reset(); setReview({ verifiedAmount: p.review?.verifiedAmount ?? p.tdsAmount, certificateReference: p.review?.certificateReference ?? "", confirmedDate: p.review?.confirmedDate.slice(0,10) ?? new Date().toISOString().slice(0,10), note: p.review?.note ?? "", certificateBase64: "" }); }}>Update review</button>}{canReview && <button onClick={()=>setClearingPayment(p.id)}>Apply / refund TDS</button>}</td></tr>)}</tbody></table>
    {editId && <form className="card" onSubmit={e => { e.preventDefault(); save.mutate(); }}><label>Verified credit ₹<input required type="number" min="0" step="0.01" value={review.verifiedAmount} onChange={e => setReview({ ...review, verifiedAmount: e.target.value })} /></label><label>Certificate / statement reference<input required maxLength={100} value={review.certificateReference} onChange={e => setReview({ ...review, certificateReference: e.target.value })} /></label><label>Confirmed date<input required type="date" value={review.confirmedDate} onChange={e => setReview({ ...review, confirmedDate: e.target.value })} /></label><label>Reconciliation note<textarea required minLength={10} value={review.note} onChange={e => setReview({ ...review, note: e.target.value })} /></label>
      <label>Certificate PDF (optional, up to 500 KB)<input type="file" accept="application/pdf" onChange={e => { const file = e.target.files?.[0]; if (!file) return; if (file.size > 500000) { setFileError("Choose a PDF up to 500 KB"); return; } const reader = new FileReader(); reader.onload = () => { setReview(r => ({ ...r, certificateBase64: String(reader.result).split(",")[1] ?? "" })); setFileError(""); }; reader.readAsDataURL(file); }} /></label>
      {fileError && <div className="error">{fileError}</div>}{save.isError && <div className="error">{errMessage(save.error)}</div>}<div className="actions"><button type="button" onClick={() => setEditId("")}>Cancel edit</button><button disabled={save.isPending || !!fileError}>Save review</button></div>
    </form>}
    <div className="actions"><button onClick={() => { setCustomerId(""); setEditId(""); }}>Close</button></div>
  </div></div>}
  </>;
}
