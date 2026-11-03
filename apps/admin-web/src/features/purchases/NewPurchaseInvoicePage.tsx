import {useAuth} from "../../stores/auth";
import {PurchaseUpload,type PurchaseExtraction,type PurchaseSource} from "./PurchaseUpload";
import { computePurchaseGst } from "../../../../../packages/common/src/gst";
import { IconButton } from "../../components/IconButton";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { EntitySelect, type ProductOption } from "../../components/EntitySelect";
import { ProductSelect } from "../../components/ProductSelect";

interface Line {unit?:string;isService?:boolean;sourceLineTotal?:number; hsnSac?:string; description?:string; productId: string; quantity: string; unitPrice: string; discount: string; gstRate: string }

const EMPTY: Line = { productId: "", quantity: "1", unitPrice: "", discount: "0", gstRate: "18" };
const inr = (v: number) => `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function NewPurchaseInvoicePage() {
  const navigate = useNavigate();
  const canCreateProduct=useAuth(s=>s.hasPerm("product:create"));
  const [autoCreateMissing,setAutoCreateMissing]=useState(true);
  const [params] = useSearchParams();
  const poId = params.get("po");
  const [error, setError] = useState("");
  const [extraction,setExtraction]=useState<PurchaseExtraction|null>(null);
  const [extracting,setExtracting]=useState(false);
  const [source,setSource]=useState<PurchaseSource|null>(null);
  const [reviewed,setReviewed]=useState(false);
  const [poNumber, setPoNumber] = useState("");
  const [form, setForm] = useState({
    supplierId: "",
    billNumber: "",
    roundOff: "",
    pricesIncludeGst:false,
    taxRounding:"PAISE" as "PAISE"|"WHOLE_RUPEE",
    invoiceDate: new Date().toISOString().slice(0, 10),
    dueDate: "",
    items: [{ ...EMPTY }] as Line[],
  });

  useEffect(()=>setReviewed(false),[form]);
  function applyExtraction(draft:PurchaseExtraction,file:PurchaseSource){
    setExtraction(draft);setSource(file);setReviewed(false);
    setForm(current=>({...current,supplierId:draft.supplierId,pricesIncludeGst:!!draft.pricesIncludeGst,taxRounding:draft.taxRounding??"PAISE",billNumber:draft.billNumber,invoiceDate:draft.invoiceDate||current.invoiceDate,dueDate:draft.dueDate||"",roundOff:draft.roundOff===null?"":String(draft.roundOff),items:draft.items.length?draft.items.map(i=>({...i,isService:!!draft.inferredServiceQuantity,unit:i.unit??"NOS",quantity:String(i.quantity),unitPrice:String(i.unitPrice),discount:String(i.discount),gstRate:String(i.gstRate)})):[{...EMPTY}]}));
  }

  // convert-from-PO: prefill supplier + received items; stock will NOT be
  // added again (it came in via GRN)
  useEffect(() => {
    if (!poId) return;
    void (async () => {
      try {
        const { data } = await api.get(`/purchase-orders/${poId}`);
        setPoNumber(data.poNumber);
        setForm((f) => ({
          ...f,
          supplierId: data.supplier.id,
          items: data.items
            .filter((it: { receivedQty: string }) => Number(it.receivedQty) > 0)
            .map((it: { productId: string; receivedQty: string; unitPrice: string; gstRate: string }) => ({
              productId: it.productId,
              quantity: String(Number(it.receivedQty)),
              unitPrice: String(Number(it.unitPrice)),
              discount: "0",
              gstRate: String(Number(it.gstRate)),
            })),
        }));
      } catch (err) { setError(errMessage(err)); }
    })();
  }, [poId]);


  const create = useMutation({
    mutationFn: async () => {
      await api.post("/purchase-invoices", {
        sourceDocument:source?{...source,reviewed:true}:undefined,
        supplierId: form.supplierId,
        purchaseOrderId: poId ?? undefined,
        billNumber: form.billNumber,
        pricesIncludeGst:form.pricesIncludeGst,
        taxRounding:form.taxRounding,
        roundOff: form.roundOff === "" ? undefined : Number(form.roundOff),
        invoiceDate: form.invoiceDate,
        dueDate: form.dueDate || undefined,
        items: form.items.map((it) => ({
          productId: it.productId || undefined,
          newProduct: !it.productId && source && autoCreateMissing && canCreateProduct ? {name:it.description?.trim(),unit:it.unit||"NOS",isService:!!it.isService}:undefined, hsnSac: it.hsnSac || undefined, quantity: Number(it.quantity),
          unitPrice: Number(it.unitPrice), discount: Number(it.discount || 0),
          gstRate: Number(it.gstRate),
        })),
      });
    },
    onSuccess: () => navigate("/purchases"),
    onError: (err) => setError(errMessage(err)),
  });

  const setItem = (i: number, patch: Partial<Line>) => {
    const items = [...form.items];
    items[i] = { ...items[i], ...patch };
    setForm({ ...form, items });
  };

  const pickProduct = (i: number, productId: string, p?: ProductOption) => {
    setItem(i, {
      productId,
      unitPrice: source ? form.items[i].unitPrice : p ? String(Number(p.purchasePrice) * (form.pricesIncludeGst ? 1+Number(p.gstRate)/100 : 1) || "") : "",
      gstRate: source ? form.items[i].gstRate : p ? String(Number(p.gstRate)) : "18",
    });
  };

  let totals;
  try { if(form.items.some(i=>Number(i.gstRate)<0))throw new Error("Verify GST");totals = computePurchaseGst(form.items.map(it => ({quantity: it.quantity || 0, unitPrice: it.unitPrice || 0, discount: it.discount || 0, gstRate: it.gstRate || 0})), false, form.taxRounding, form.pricesIncludeGst); } catch { totals = undefined; }
  const taxable = Number(totals?.taxableValue ?? 0), gst = Number(totals?.cgst ?? 0) + Number(totals?.sgst ?? 0);
  const roundOff = form.roundOff === "" ? Number(totals?.roundOff ?? 0) : Number(form.roundOff);
  const totalMatches=!extraction?.requiresTotalMatch||(extraction.expectedTotal!==null&&Math.abs(extraction.expectedTotal-taxable-gst-roundOff)<0.011);
  const valid = totalMatches && !extracting && (!source || (reviewed && !extraction?.duplicate)) && totals && Number.isFinite(roundOff) && Math.abs(roundOff) <= 1 && taxable + gst + roundOff >= 0 && form.supplierId && form.billNumber &&
    form.items.every((it) => (it.productId || (source && autoCreateMissing && canCreateProduct && (it.description?.trim().length??0)>=2 && (it.description?.trim().length??0)<=150)) && Number(it.quantity) > 0 && Number(it.unitPrice) >= 0 && [0,5,12,18,28].includes(Number(it.gstRate)));

  return (
    <>
      <div className="toolbar">
        <h2 className="page-title" style={{ margin: 0 }}>New Purchase Bill</h2>
        {poNumber && <span className="badge ok">from PO {poNumber} — stock already received, won't be added again</span>}
        <div className="spacer" />
        <button onClick={() => navigate("/purchases")}>← Back to purchases</button>
      </div>

      {!poId && <PurchaseUpload onBusyChange={setExtracting} onExtract={applyExtraction} onClear={()=>{setSource(null);setExtraction(null);setReviewed(false);}}/>}
      {extraction && <section className="card" aria-label="Extraction review">
        <h3>Review extracted details</h3>
        <p>Supplier found in document: {extraction.supplierName||"Not detected"}</p>
        <label><input type="checkbox" checked={autoCreateMissing&&canCreateProduct} disabled={!canCreateProduct} onChange={e=>{setAutoCreateMissing(e.target.checked);setReviewed(false);}}/> Create unmatched products automatically when saving this reviewed bill</label>
        {!canCreateProduct&&<p className="document-help">Product-create permission is required to create missing products.</p>}
        {form.items.some(i=>Number(i.gstRate)<0)&&<div><label htmlFor="upload-gst-all">Confirm GST rate for extracted items</label><select id="upload-gst-all" value="-1" onChange={e=>setForm({...form,items:form.items.map(i=>({...i,gstRate:e.target.value}))})}><option value="-1" disabled>Select GST rate shown on supplier invoice</option>{[0,5,12,18,28].map(rate=><option key={rate} value={rate}>{rate}%</option>)}</select></div>}
        {extraction.warnings.map(w=><p className="document-help" key={w}>{w}</p>)}
        {extraction.duplicate && <div className="error">Possible duplicate of {extraction.duplicate}. This draft cannot be saved.</div>}
        <details><summary>View extracted text</summary><pre style={{whiteSpace:"pre-wrap",maxHeight:260,overflow:"auto"}}>{extraction.sourceText}</pre></details>
      </section>}

      <div className="card">
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr 1fr", gap: 12 }}>
          <div>
            <label>Supplier *</label>
            <EntitySelect kind="suppliers" value={form.supplierId} onChange={(id) => setForm({ ...form, supplierId: id })} />
          </div>
          <div><label>Supplier bill no *</label>
            <input value={form.billNumber} onChange={(e) => setForm({ ...form, billNumber: e.target.value })} /></div>
          <div><label>Bill date</label>
            <input type="date" value={form.invoiceDate} onChange={(e) => setForm({ ...form, invoiceDate: e.target.value })} /></div>
          <div><label>Due date</label>
            <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></div>
        </div>
      </div>

      <div className="card">
        <label style={{ marginTop: 0 }}>Items (stock increases on save)</label>
        <table style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ width: "34%" }}>Product *</th><th style={{ width: 90 }}>Qty</th>
              <th style={{ width: 110 }}>Rate ₹ {form.pricesIncludeGst?"(incl. GST)":"(excl. GST)"}</th><th style={{ width: 100 }}>Disc ₹</th>
              <th style={{ width: 90 }}>GST %</th><th style={{ width: 110, textAlign: "right" }}>Line total</th><th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {form.items.map((it, i) => {
              const base = Number(it.quantity || 0) * Number(it.unitPrice || 0) - Number(it.discount || 0);
              const lineTotal = Number(totals?.lines[i]?.lineTotal ?? 0);
              return (
                <tr key={i}>
                  <td>
                    {it.description && <small style={{display:"block",marginBottom:5}}>Extracted: {it.description}{it.hsnSac && ` · HSN/SAC ${it.hsnSac}`}</small>}
                    {!it.productId&&source&&autoCreateMissing&&canCreateProduct&&<div style={{marginBottom:8}}><label>New product name</label><input aria-label={`New product name ${i+1}`} maxLength={150} value={it.description??""} onChange={e=>setItem(i,{description:e.target.value})}/><select aria-label={`Product type ${i+1}`} value={it.isService?"SERVICE":"GOODS"} onChange={e=>setItem(i,{isService:e.target.value==="SERVICE"})}><option value="GOODS">Goods — track stock</option><option value="SERVICE">Service — no stock</option></select><small>Will be created with a PRD code on save, or select an existing product below.</small></div>}
                    {it.sourceLineTotal!==undefined&&<small style={{display:"block"}}>Printed line amount (OCR): {inr(it.sourceLineTotal)}{Math.abs(Number(it.quantity)*Number(it.unitPrice)-Number(it.discount||0)-it.sourceLineTotal)>0.02?" · Check quantity, price and amount against photo":""}</small>}
                    {it.sourceLineTotal!==undefined&&Number(it.unitPrice)>0&&Math.abs(it.sourceLineTotal/Number(it.unitPrice)-Math.round(it.sourceLineTotal/Number(it.unitPrice)))<0.0001&&Math.round(it.sourceLineTotal/Number(it.unitPrice))>0&&Number(it.quantity)!==Math.round(it.sourceLineTotal/Number(it.unitPrice))&&<button className="small" onClick={()=>setItem(i,{quantity:String(Math.round(it.sourceLineTotal!/Number(it.unitPrice)))})}>Use quantity {Math.round(it.sourceLineTotal/Number(it.unitPrice))} from rate/amount</button>}
                    <ProductSelect value={it.productId} onChange={(id, product) => pickProduct(i, id, product)} />
                  </td>
                  <td><input type="number" value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} /></td>
                  <td><input type="number" value={it.unitPrice} onChange={(e) => setItem(i, { unitPrice: e.target.value })} /></td>
                  <td><input type="number" value={it.discount} onChange={(e) => setItem(i, { discount: e.target.value })} /></td>
                  <td>
                    <select value={it.gstRate} onChange={(e) => setItem(i, { gstRate: e.target.value })}>
                      <option value="-1" disabled>Verify GST rate</option><option>0</option><option>5</option><option>12</option><option>18</option><option>28</option>
                    </select>
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{base > 0 ? inr(lineTotal) : "—"}</td>
                  <td>
                    {form.items.length > 1 && (
                      <IconButton className="small danger" onClick={() => setForm({ ...form, items: form.items.filter((_, x) => x !== i) })} icon="close" label="×">×</IconButton>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button className="small" style={{ marginTop: 8 }}
          onClick={() => setForm({ ...form, items: [...form.items, { ...EMPTY }] })}>+ Add item</button>
      </div>

      <div className="card" style={{ textAlign: "right", lineHeight: 1.9 }}>
        <label><input type="checkbox" checked={form.pricesIncludeGst} onChange={e=>setForm({...form,pricesIncludeGst:e.target.checked})}/> Rates include GST — extract tax from entered prices</label>
        <label htmlFor="purchase-gst-rounding">Supplier GST rounding</label>
        <select id="purchase-gst-rounding" style={{width:"min(100%,320px)",marginBottom:12}} value={form.taxRounding} onChange={e=>setForm({...form,taxRounding:e.target.value as "PAISE"|"WHOLE_RUPEE"})}><option value="PAISE">GST to 2 decimal places</option><option value="WHOLE_RUPEE">Each GST component to nearest rupee</option></select><br/>
        Taxable {inr(taxable)} · Input GST ~{inr(gst)}<br />
        <div style={{display:"flex",gap:12,alignItems:"center",justifyContent:"flex-end",flexWrap:"wrap"}}>
          <label htmlFor="purchase-roundoff">Round off ₹</label>
          <input id="purchase-roundoff" type="number" min="-1" max="1" step="0.01" style={{width:130}} placeholder={totals?.roundOff ?? "0.00"} value={form.roundOff} onChange={e=>setForm({...form,roundOff:e.target.value})}/>
          <span className="document-help">Blank: nearest rupee. Enter 0 for no rounding. Range −1 to +1.</span>
        </div>
        <strong style={{ fontSize: 18 }}>Total ~{inr(taxable + gst + roundOff)}</strong>
        <div style={{ color: "var(--muted)", fontSize: 11 }}>final split computed by server (input tax credit tracked for GSTR-3B)</div>
      </div>

      {source && <section className="card">
        {extraction?.requiresTotalMatch&&<div><label htmlFor="source-total">Document total ₹ (correct if OCR misread it)</label><input id="source-total" type="number" min="0" step="0.01" value={extraction.expectedTotal??""} onChange={e=>{setExtraction({...extraction,expectedTotal:e.target.value===""?null:Number(e.target.value)});setReviewed(false);}}/>{!totalMatches&&<p className="error">Correct the extracted quantities and rates until the draft total matches the document total before saving.</p>}</div>}
        <p>Original invoice: {source.fileName} — attached when saved.</p>
        {extraction?.expectedTotal!==null && extraction?.expectedTotal!==undefined && <p className={Math.abs(extraction.expectedTotal-taxable-gst-roundOff)>0.011?"error":"document-help"}>Document total {inr(extraction.expectedTotal)} · Draft total {inr(taxable+gst+roundOff)}. {Math.abs(extraction.expectedTotal-taxable-gst-roundOff)>0.011?"Amounts differ. Review all lines, GST and round-off.":"Totals match."}</p>}
        <label><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)}/> I checked the supplier, invoice number, dates, products, taxes and total against the original.</label>
      </section>}
      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={() => navigate("/purchases")}>Cancel</button>
        <button className="primary" disabled={create.isPending || !valid} onClick={() => create.mutate()}>
          {create.isPending ? "Saving…" : "Save purchase bill"}
        </button>
      </div>
    </>
  );
}
