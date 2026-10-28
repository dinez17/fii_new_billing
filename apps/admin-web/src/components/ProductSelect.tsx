import { useState } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../lib/api";
import { useAuth } from "../stores/auth";
import { EntitySelect, type ProductOption } from "./EntitySelect";

export function ProductSelect({ value, onChange, placeholder = "Search product name / SKU…" }: {
  value: string; onChange: (id: string, product?: ProductOption) => void; placeholder?: string;
}) {
  const qc = useQueryClient();
  const canCreate = useAuth((s) => s.hasPerm("product:create"));
  const [form, setForm] = useState<{ name: string; sku: string; unit: string; hsnSac: string; purchasePrice: string; salePrice: string; gstRate: string; openingStock: string; isService: boolean } | null>(null);
  const save = useMutation({
    mutationFn: async () => {
      if (!form) throw new Error("Enter product details");
      return (await api.post<ProductOption>("/products", { ...form, name: form.name.trim(), sku: form.sku.trim(), hsnSac: form.hsnSac || undefined,
        purchasePrice: Number(form.purchasePrice), salePrice: Number(form.salePrice), gstRate: Number(form.gstRate), openingStock: form.isService ? undefined : Number(form.openingStock),
      })).data;
    },
    onSuccess: (product) => { qc.setQueryData(["entity-search", "products", "selected", product.id], product); void qc.invalidateQueries({ queryKey: ["entity-search", "products"] }); void qc.invalidateQueries({ queryKey: ["products"] }); onChange(product.id, product); setForm(null); },
  });
  return <>
    <EntitySelect<ProductOption> kind="products" value={value} onChange={onChange} placeholder={placeholder} onCreate={canCreate ? (name) => {
      save.reset(); setForm({ name, sku: `${name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").slice(0, 28)}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`, unit: "NOS", hsnSac: "", purchasePrice: "0", salePrice: "0", gstRate: "18", openingStock: "0", isService: false });
    } : undefined} />
    {form && createPortal(<div className="modal-overlay" style={{ zIndex: 400 }}><form className="modal" role="dialog" aria-modal="true" aria-label="Create product" onSubmit={(e) => { e.preventDefault(); save.mutate(); }}>
      <h3>Create product</h3><p>The product will be added to your catalogue and selected on this document.</p>
      <label>Name<input required minLength={2} maxLength={150} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
      <label>SKU<input required maxLength={40} value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value.toUpperCase() })} /></label>
      <div className="quick-product-grid">
        <label>Unit<input required maxLength={10} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></label>
        <label>HSN/SAC<input maxLength={10} value={form.hsnSac} onChange={(e) => setForm({ ...form, hsnSac: e.target.value })} /></label>
        <label>Purchase price<input type="number" min="0" step="0.01" required value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })} /></label>
        <label>Sale price<input type="number" min="0" step="0.01" required value={form.salePrice} onChange={(e) => setForm({ ...form, salePrice: e.target.value })} /></label>
        <label>GST %<input type="number" min="0" max="28" step="0.01" required value={form.gstRate} onChange={(e) => setForm({ ...form, gstRate: e.target.value })} /></label>
        {!form.isService && <label>Opening stock<input type="number" min="0" step="0.001" required value={form.openingStock} onChange={(e) => setForm({ ...form, openingStock: e.target.value })} /></label>}
      </div>
      <label><input type="checkbox" style={{ width: "auto" }} checked={form.isService} onChange={(e) => setForm({ ...form, isService: e.target.checked })} /> Service item (no stock tracking)</label>
      {save.isError && <div className="error" role="alert">{errMessage(save.error)}</div>}
      <div className="actions"><button type="button" disabled={save.isPending} onClick={() => setForm(null)}>Cancel</button><button type="submit" className="primary" disabled={save.isPending}>{save.isPending ? "Creating…" : "Create & select"}</button></div>
    </form></div>, document.body)}
  </>;
}
