import { IconButton } from "../../components/IconButton";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { EntitySelect, type ProductOption } from "../../components/EntitySelect";
import { ProductSelect } from "../../components/ProductSelect";

interface Line { productId: string; quantity: string; unitPrice: string; gstRate: string }

const EMPTY: Line = { productId: "", quantity: "1", unitPrice: "", gstRate: "18" };
const inr = (v: number) => `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

export function NewPurchaseOrderPage() {
  const navigate = useNavigate();
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    supplierId: "",
    orderDate: new Date().toISOString().slice(0, 10),
    expectedDate: "",
    notes: "",
    items: [{ ...EMPTY }] as Line[],
  });


  const create = useMutation({
    mutationFn: async () => {
      await api.post("/purchase-orders", {
        supplierId: form.supplierId,
        orderDate: form.orderDate,
        expectedDate: form.expectedDate || undefined,
        notes: form.notes || undefined,
        items: form.items.map((it) => ({
          productId: it.productId, quantity: Number(it.quantity),
          unitPrice: Number(it.unitPrice), gstRate: Number(it.gstRate),
        })),
      });
    },
    onSuccess: () => navigate("/purchase-orders"),
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
      unitPrice: p && Number(p.purchasePrice) ? String(Number(p.purchasePrice)) : "",
      gstRate: p ? String(Number(p.gstRate)) : "18",
    });
  };

  const total = form.items.reduce((s, it) => {
    const base = Number(it.quantity || 0) * Number(it.unitPrice || 0);
    return s + base + (base * Number(it.gstRate || 0)) / 100;
  }, 0);
  const valid = form.supplierId && form.items.every((it) => it.productId && Number(it.quantity) > 0);

  return (
    <>
      <div className="toolbar">
        <h2 className="page-title" style={{ margin: 0 }}>New Purchase Order</h2>
        <div className="spacer" />
        <button onClick={() => navigate("/purchase-orders")}>← Back to POs</button>
      </div>

      <div className="card">
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
          <div>
            <label>Supplier *</label>
            <EntitySelect kind="suppliers" value={form.supplierId} onChange={(id) => setForm({ ...form, supplierId: id })} />
          </div>
          <div><label>Order date</label>
            <input type="date" value={form.orderDate} onChange={(e) => setForm({ ...form, orderDate: e.target.value })} /></div>
          <div><label>Expected delivery</label>
            <input type="date" value={form.expectedDate} onChange={(e) => setForm({ ...form, expectedDate: e.target.value })} /></div>
        </div>
        <label>Notes (printed / internal)</label>
        <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
      </div>

      <div className="card">
        <label style={{ marginTop: 0 }}>Items (stock is added only when goods arrive — via GRN)</label>
        <table style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ width: "40%" }}>Product *</th><th style={{ width: 90 }}>Qty</th>
              <th style={{ width: 110 }}>Rate ₹</th><th style={{ width: 90 }}>GST %</th>
              <th style={{ width: 110, textAlign: "right" }}>Line total</th><th style={{ width: 40 }} />
            </tr>
          </thead>
          <tbody>
            {form.items.map((it, i) => {
              const base = Number(it.quantity || 0) * Number(it.unitPrice || 0);
              const lineTotal = base + (base * Number(it.gstRate || 0)) / 100;
              return (
                <tr key={i}>
                  <td>
                    <ProductSelect value={it.productId} onChange={(id, product) => pickProduct(i, id, product)} />
                  </td>
                  <td><input type="number" value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} /></td>
                  <td><input type="number" value={it.unitPrice} onChange={(e) => setItem(i, { unitPrice: e.target.value })} /></td>
                  <td>
                    <select value={it.gstRate} onChange={(e) => setItem(i, { gstRate: e.target.value })}>
                      <option>0</option><option>5</option><option>12</option><option>18</option><option>28</option>
                    </select>
                  </td>
                  <td style={{ textAlign: "right" }}>{base > 0 ? inr(lineTotal) : "—"}</td>
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
        <div style={{ textAlign: "right", marginTop: 10 }}>
          <strong style={{ fontSize: 17 }}>PO total ~{inr(total)}</strong>
        </div>
      </div>

      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={() => navigate("/purchase-orders")}>Cancel</button>
        <button className="primary" disabled={create.isPending || !valid} onClick={() => create.mutate()}>
          {create.isPending ? "Creating…" : "Create PO (draft)"}
        </button>
      </div>
    </>
  );
}
