import { IconButton } from "../../components/IconButton";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { EntitySelect, type ProductOption } from "../../components/EntitySelect";
import { ProductSelect } from "../../components/ProductSelect";

interface Line { productId: string; quantity: string; unitPrice: string; discount: string; gstRate: string }

const EMPTY: Line = { productId: "", quantity: "1", unitPrice: "", discount: "0", gstRate: "18" };
const inr = (v: number) => `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

export function NewPurchaseInvoicePage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const poId = params.get("po");
  const [error, setError] = useState("");
  const [poNumber, setPoNumber] = useState("");
  const [form, setForm] = useState({
    supplierId: "",
    billNumber: "",
    invoiceDate: new Date().toISOString().slice(0, 10),
    dueDate: "",
    items: [{ ...EMPTY }] as Line[],
  });

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
        supplierId: form.supplierId,
        purchaseOrderId: poId ?? undefined,
        billNumber: form.billNumber,
        invoiceDate: form.invoiceDate,
        dueDate: form.dueDate || undefined,
        items: form.items.map((it) => ({
          productId: it.productId, quantity: Number(it.quantity),
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
      unitPrice: p ? String(Number(p.purchasePrice) || "") : "",
      gstRate: p ? String(Number(p.gstRate)) : "18",
    });
  };

  let taxable = 0, gst = 0;
  for (const it of form.items) {
    const base = Number(it.quantity || 0) * Number(it.unitPrice || 0) - Number(it.discount || 0);
    taxable += base;
    gst += (base * Number(it.gstRate || 0)) / 100;
  }
  const valid = form.supplierId && form.billNumber &&
    form.items.every((it) => it.productId && Number(it.quantity) > 0 && Number(it.unitPrice) >= 0);

  return (
    <>
      <div className="toolbar">
        <h2 className="page-title" style={{ margin: 0 }}>New Purchase Bill</h2>
        {poNumber && <span className="badge ok">from PO {poNumber} — stock already received, won't be added again</span>}
        <div className="spacer" />
        <button onClick={() => navigate("/purchases")}>← Back to purchases</button>
      </div>

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
              <th style={{ width: 110 }}>Rate ₹</th><th style={{ width: 100 }}>Disc ₹</th>
              <th style={{ width: 90 }}>GST %</th><th style={{ width: 110, textAlign: "right" }}>Line total</th><th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {form.items.map((it, i) => {
              const base = Number(it.quantity || 0) * Number(it.unitPrice || 0) - Number(it.discount || 0);
              const lineTotal = base + (base * Number(it.gstRate || 0)) / 100;
              return (
                <tr key={i}>
                  <td>
                    <ProductSelect value={it.productId} onChange={(id, product) => pickProduct(i, id, product)} />
                  </td>
                  <td><input type="number" value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} /></td>
                  <td><input type="number" value={it.unitPrice} onChange={(e) => setItem(i, { unitPrice: e.target.value })} /></td>
                  <td><input type="number" value={it.discount} onChange={(e) => setItem(i, { discount: e.target.value })} /></td>
                  <td>
                    <select value={it.gstRate} onChange={(e) => setItem(i, { gstRate: e.target.value })}>
                      <option>0</option><option>5</option><option>12</option><option>18</option><option>28</option>
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
        Taxable {inr(taxable)} · Input GST ~{inr(gst)}<br />
        <strong style={{ fontSize: 18 }}>Total ~{inr(taxable + gst)}</strong>
        <div style={{ color: "var(--muted)", fontSize: 11 }}>final split computed by server (input tax credit tracked for GSTR-3B)</div>
      </div>

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
