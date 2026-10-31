import {EntitySelect} from "../../components/EntitySelect";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { ListTable } from "../../components/ListPagination";

interface Draft {
  supplierId?:string;confirmSupplierMapping?:boolean;allowLockedHistory?:boolean;writeOffAmount?:number; customerId: string; invoiceNumber: string; invoiceDate: string; dueDate: string; chargeGst: boolean; isInterState: boolean;
  expectedTotal: number; expectedBalance: number; note: string;
  items: Array<{ productId?:string;description: string; hsnSac: string; quantity: number; unitPrice: number; discount: number; gstRate: number }>;
  receipts: Array<{ sourceRecordId: string; receiptNumber: string; paymentDate: string; amount: number; tdsAmount: number; mode: string; reference: string; sourceType: string }>;
}
export function LegacyReconcile({ id, close }: { id: string; close: () => void }) {
  const query = useQuery({ queryKey: ["legacy-reconciliation-draft", id], queryFn: async () => (await api.get(`/settings/legacy-imports/records/${id}/reconciliation-draft`)).data as { kind:string;customerName: string; sourceTotal: string; document: Draft } });
  const [changed, setChanged] = useState<Draft | null>(null), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ token: string; total: string; settlement: string; balance: string; message: string } | null>(null);
  const [backup, setBackup] = useState(""), [confirm, setConfirm] = useState(false);
  const qc = useQueryClient(), draft = changed ?? query.data?.document;
  const purchase=query.data?.kind==="PURCHASE";
  const update = (value: Draft) => { setChanged(value); setPreview(null); setConfirm(false); };
  async function prepare() {
    setBusy(true); setError("");
    try { setPreview((await api.post(`/settings/legacy-imports/records/${id}/financial-preview`, draft)).data); }
    catch (e) { setError(errMessage(e)); } finally { setBusy(false); }
  }
  async function post() {
    setBusy(true); setError("");
    try { await api.post(`/settings/legacy-imports/records/${id}/financial-post`, { document: draft, token: preview!.token, backupReference: backup, confirm: true }); await qc.invalidateQueries(); close(); }
    catch (e) { setError(errMessage(e)); setPreview(null); setConfirm(false); } finally { setBusy(false); }
  }
  return <div className="modal-overlay entry-fullpage-overlay"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="legacy-reconcile-title">
    <h3 id="legacy-reconcile-title">Reconcile and post held invoice</h3>
    <p>This step changes outstanding and historical reports. Verify the corrected invoice and every linked receipt. Keep write-offs and unknown settlements on hold; do not enter them as cash or TDS. A recent backup reference is required.</p>
    {query.isError && <div className="error">{errMessage(query.error)}</div>}
    {draft && <><p>Party: {query.data?.customerName} · Original source total: ₹{query.data?.sourceTotal}</p>
      {purchase && <><label>Verified supplier<EntitySelect kind="suppliers" value={draft.supplierId??""} onChange={id=>update({...draft,supplierId:id})}/></label><label><input type="checkbox" checked={!!draft.confirmSupplierMapping} onChange={e=>update({...draft,confirmSupplierMapping:e.target.checked})}/>I verified this supplier against the original source bill.</label></>}
      <div className="toolbar"><label>Invoice number<input value={draft.invoiceNumber} onChange={e => update({ ...draft, invoiceNumber: e.target.value })} /></label><label>Invoice date<input type="date" value={draft.invoiceDate?.slice(0,10)} onChange={e => update({ ...draft, invoiceDate: e.target.value })} /></label><label>Due date<input type="date" value={draft.dueDate?.slice(0,10)} onChange={e => update({ ...draft, dueDate: e.target.value })} /></label><label>Tax register<select value={draft.chargeGst ? "GST" : "WITHOUT_GST"} onChange={e => update({ ...draft, chargeGst: e.target.value === "GST" })}><option value="GST">GST</option><option value="WITHOUT_GST">Without GST</option></select></label></div>
      <label><input type="checkbox" checked={!!draft.isInterState} onChange={e=>update({...draft,isInterState:e.target.checked})}/>Interstate supply (verify against company and party state codes)</label><h4>Corrected items</h4><ListTable><thead><tr><th>Description / HSN</th><th>Quantity</th><th>Rate</th><th>Discount</th><th>GST %</th></tr></thead><tbody>{draft.items.map((item,i) => <tr key={i}><td>{purchase && <EntitySelect kind="products" value={item.productId??""} onChange={id=>update({...draft,items:draft.items.map((v,index)=>i===index?{...v,productId:id}:v)})}/>}<input value={item.description} onChange={e => update({ ...draft, items: draft.items.map((v,index) => i === index ? { ...v, description: e.target.value } : v) })} /><input aria-label={`HSN item ${i+1}`} value={item.hsnSac} onChange={e => update({ ...draft, items: draft.items.map((v,index) => i === index ? { ...v, hsnSac: e.target.value } : v) })} /></td>{(["quantity","unitPrice","discount","gstRate"] as const).map(key => <td key={key}><input aria-label={`${key} item ${i+1}`} type="number" min="0" step={key === "quantity" ? "0.001" : "0.01"} value={item[key]} onChange={e => update({ ...draft, items: draft.items.map((v,index) => i === index ? { ...v, [key]: Number(e.target.value) } : v) })} /></td>)}</tr>)}</tbody></ListTable>
      <h4>Every linked receipt</h4><ListTable><thead><tr><th>Receipt / date</th><th>Source type</th><th>Actual cash/bank ₹</th><th>Confirmed TDS ₹</th><th>Mode / verified reference</th></tr></thead><tbody>{draft.receipts.map((r,i) => {
        const change = (value: Partial<typeof r>) => update({ ...draft, receipts: draft.receipts.map((v,index) => i === index ? { ...v, ...value } : v) });
        return <tr key={r.sourceRecordId}><td><input value={r.receiptNumber} onChange={e => change({ receiptNumber: e.target.value })} /><input type="date" value={r.paymentDate?.slice(0,10)} onChange={e => change({ paymentDate: e.target.value })} /></td><td>{r.sourceType}</td><td><input type="number" min="0" step="0.01" value={r.amount} onChange={e => change({ amount: Number(e.target.value) })} /></td><td><input type="number" min="0" step="0.01" value={r.tdsAmount} onChange={e => change({ tdsAmount: Number(e.target.value) })} /></td><td><select value={r.mode} onChange={e => change({ mode: e.target.value })}><option value="REVIEW_REQUIRED">Choose verified mode</option>{["CASH","CHEQUE","BANK_TRANSFER","UPI","CARD"].map(m => <option key={m}>{m}</option>)}</select><input value={r.reference} onChange={e => change({ reference: e.target.value })} /></td></tr>;
      })}</tbody></ListTable>
      {!purchase && <label>Verified receivable write-off ₹ (not cash or TDS)<input type="number" min="0" step="0.01" value={draft.writeOffAmount??0} onChange={e=>update({...draft,writeOffAmount:Number(e.target.value)})}/></label>}
      <label><input type="checkbox" checked={!!draft.allowLockedHistory} onChange={e=>update({...draft,allowLockedHistory:e.target.checked})}/>Append the verified historical correction even when its original financial year is locked. This requires financial-year administration, keeps original source evidence and does not unlock the year.</label>
      <label>Verified invoice total ₹<input type="number" min="0" step="0.01" value={draft.expectedTotal} onChange={e => update({ ...draft, expectedTotal: Number(e.target.value) })} /></label>
      <label>Verified remaining balance ₹<input type="number" min="0" step="0.01" value={draft.expectedBalance} onChange={e => update({ ...draft, expectedBalance: Number(e.target.value) })} /></label>
      <label>Correction evidence and classification note<textarea minLength={20} maxLength={1000} value={draft.note} onChange={e => update({ ...draft, note: e.target.value })} /></label>
      <button disabled={busy || draft.note.trim().length < 20} onClick={() => void prepare()}>Preview financial posting</button>
      {preview && <div className="card"><strong>Invoice ₹{preview.total} − settlements ₹{preview.settlement} − write-off ₹{draft.writeOffAmount??0} = balance ₹{preview.balance}</strong><p>{preview.message}</p><label>Recent backup filename / reference<input minLength={10} maxLength={200} value={backup} onChange={e => setBackup(e.target.value)} /></label><label><input type="checkbox" checked={confirm} onChange={e => setConfirm(e.target.checked)} />I verified these corrections, saved a recent backup, and approve the resulting balance.</label><button disabled={busy || !confirm || backup.trim().length < 10} onClick={() => void post()}>Post reconciled invoice and receipts</button></div>}
    </>}
    {error && <div className="error">{error}</div>}<div className="actions"><button disabled={busy} onClick={close}>Close</button></div>
  </div></div>;
}
