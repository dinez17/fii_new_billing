import { IconButton } from "../../components/IconButton";
import { RowsPerPage, usePageSize, ListTable } from "../../components/ListPagination";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";
import { BulkImport } from "../../components/BulkImport";

interface ProductRow {
  id: string; sku: string; name: string; hsnSac?: string; unit: string;
  purchasePrice: string; salePrice: string; gstRate: string;
  stockQty: string; reorderLevel: string; isService: boolean; isActive: boolean;
}
interface Movement {
  id: string; type: string; quantity: string; balanceAfter: string;
  refType?: string; reason?: string; createdAt: string;
}
interface FormState {
  id?: string; sku: string; name: string; hsnSac: string; unit: string;
  purchasePrice: string; salePrice: string; gstRate: string; reorderLevel: string;
  isService: boolean; openingStock: string;
}
const EMPTY: FormState = {
  sku: "", name: "", hsnSac: "", unit: "NOS", purchasePrice: "", salePrice: "",
  gstRate: "18", reorderLevel: "0", isService: false, openingStock: "",
};

export function ProductsPage() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPerm);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize(() => setPage(1));
  const [search, setSearch] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [form, setForm] = useState<FormState | null>(null);
  const [adjustFor, setAdjustFor] = useState<ProductRow | null>(null);
  const [adjust, setAdjust] = useState({ direction: "IN", quantity: "", reason: "" });
  const [movesFor, setMovesFor] = useState<ProductRow | null>(null);
  const [error, setError] = useState("");

  const products = useQuery({
    queryKey: ["products", page, search, lowOnly, pageSize],
    queryFn: async () => (await api.get("/products", {
      params: { page, limit: pageSize, search: search || undefined, lowStock: lowOnly || undefined },
    })).data as { items: ProductRow[]; total: number; limit: number },
  });

  const movements = useQuery({
    queryKey: ["movements", movesFor?.id],
    queryFn: async () => (await api.get("/stock-movements", { params: { productId: movesFor!.id } })).data as Movement[],
    enabled: !!movesFor,
  });

  const save = useMutation({
    mutationFn: async (f: FormState) => {
      const body = {
        sku: f.sku, name: f.name, hsnSac: f.hsnSac || undefined, unit: f.unit,
        purchasePrice: Number(f.purchasePrice || 0), salePrice: Number(f.salePrice || 0),
        gstRate: Number(f.gstRate), reorderLevel: Number(f.reorderLevel || 0),
        isService: f.isService,
        ...(f.id ? {} : { openingStock: f.openingStock ? Number(f.openingStock) : undefined }),
      };
      if (f.id) await api.put(`/products/${f.id}`, body);
      else await api.post("/products", body);
    },
    onSuccess: () => { setForm(null); setError(""); qc.invalidateQueries({ queryKey: ["products"] }); },
    onError: (err) => setError(errMessage(err)),
  });

  const doAdjust = useMutation({
    mutationFn: async () => {
      await api.post("/stock-adjustments", {
        productId: adjustFor!.id, direction: adjust.direction,
        quantity: Number(adjust.quantity), reason: adjust.reason,
      });
    },
    onSuccess: () => {
      setAdjustFor(null); setError(""); setAdjust({ direction: "IN", quantity: "", reason: "" });
      qc.invalidateQueries({ queryKey: ["products"] });
    },
    onError: (err) => setError(errMessage(err)),
  });

  const low = (p: ProductRow) =>
    !p.isService && Number(p.reorderLevel) > 0 && Number(p.stockQty) <= Number(p.reorderLevel);

  return (
    <>
      <h2 className="page-title">Products & Stock</h2>
      <div className="toolbar">
        <RowsPerPage value={pageSize} onChange={setPageSize} />
        <input style={{ width: 240 }} placeholder="Search name / SKU…" value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <label style={{ margin: 0, display: "flex", alignItems: "center", gap: 6 }}>
          <input type="checkbox" style={{ width: "auto" }} checked={lowOnly} onChange={(e) => { setLowOnly(e.target.checked); setPage(1); }} />
          Low stock only
        </label>
        <div className="spacer" />
        {hasPerm("product:create") && <BulkImport kind="products" />}
        {hasPerm("product:create") && (
          <button className="primary" onClick={() => { setForm(EMPTY); setError(""); }}>+ New Product</button>
        )}
      </div>

      <table>
        <thead>
          <tr><th>SKU</th><th>Name</th><th>Type</th><th>Purchase ₹</th><th>Sale ₹</th><th>GST%</th><th>Stock</th><th /></tr>
        </thead>
        <tbody>
          {products.data?.items.map((p) => (
            <tr key={p.id}>
              <td><code>{p.sku}</code></td>
              <td>{p.name}{!p.isActive && <span className="badge warn" style={{ marginLeft: 6 }}>inactive</span>}</td>
              <td><span className="badge">{p.isService ? "SERVICE" : "GOODS"}</span></td>
              <td>{Number(p.purchasePrice).toFixed(2)}</td>
              <td>{Number(p.salePrice).toFixed(2)}</td>
              <td>{Number(p.gstRate)}%</td>
              <td>
                {p.isService ? "—" : (
                  <span className={`badge ${low(p) ? "warn" : "ok"}`}>
                    {Number(p.stockQty)} {p.unit}{low(p) && " ⚠"}
                  </span>
                )}
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                {hasPerm("product:update") && (
                  <IconButton className="small" onClick={() => setForm({
                    id: p.id, sku: p.sku, name: p.name, hsnSac: p.hsnSac ?? "", unit: p.unit,
                    purchasePrice: String(p.purchasePrice), salePrice: String(p.salePrice),
                    gstRate: String(Number(p.gstRate)), reorderLevel: String(Number(p.reorderLevel)),
                    isService: p.isService, openingStock: "",
                  })} icon="edit" label="Edit">Edit</IconButton>
                )}{" "}
                {!p.isService && hasPerm("stock:update") && (
                  <IconButton className="small" onClick={() => { setAdjustFor(p); setError(""); }} icon="more" label="Adjust">Adjust</IconButton>
                )}{" "}
                {!p.isService && hasPerm("stock:read") && (
                  <IconButton className="small" onClick={() => setMovesFor(p)} icon="more" label="History">History</IconButton>
                )}
              </td>
            </tr>
          ))}
          {products.data?.items.length === 0 && (
            <tr><td colSpan={8} style={{ color: "var(--muted)" }}>{lowOnly ? "Nothing low on stock." : "No products yet."}</td></tr>
          )}
        </tbody>
      </table>

      {products.data && (
        <div className="pagination">
          <button className="small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <span>Page {page} of {Math.max(1, Math.ceil(products.data.total / products.data.limit))}</span>
          <button className="small" disabled={page * products.data.limit >= products.data.total} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}

      {form && (
        <div className="modal-overlay entry-fullpage-overlay" onClick={() => setForm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{form.id ? "Edit product" : "New product"}</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: 8 }}>
              <div><label>SKU *</label>
                <input value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value.toUpperCase() })} /></div>
              <div><label>Name *</label>
                <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div><label>HSN/SAC</label><input value={form.hsnSac} onChange={(e) => setForm({ ...form, hsnSac: e.target.value })} /></div>
              <div><label>Unit</label><input value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value.toUpperCase() })} /></div>
              <div>
                <label>GST %</label>
                <select value={form.gstRate} onChange={(e) => setForm({ ...form, gstRate: e.target.value })}>
                  <option>0</option><option>5</option><option>12</option><option>18</option><option>28</option>
                </select>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div><label>Purchase price ₹</label>
                <input type="number" value={form.purchasePrice} onChange={(e) => setForm({ ...form, purchasePrice: e.target.value })} /></div>
              <div><label>Sale price ₹</label>
                <input type="number" value={form.salePrice} onChange={(e) => setForm({ ...form, salePrice: e.target.value })} /></div>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" style={{ width: "auto" }} checked={form.isService}
                disabled={!!form.id}
                onChange={(e) => setForm({ ...form, isService: e.target.checked })} />
              Service item (no stock tracking)
            </label>
            {!form.isService && (
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                <div><label>Reorder level</label>
                  <input type="number" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} /></div>
                {!form.id && (
                  <div><label>Opening stock</label>
                    <input type="number" value={form.openingStock} onChange={(e) => setForm({ ...form, openingStock: e.target.value })} /></div>
                )}
              </div>
            )}
            {error && <div className="error">{error}</div>}
            <div className="actions">
              <button onClick={() => setForm(null)}>Cancel</button>
              <button className="primary" disabled={save.isPending || !form.sku || !form.name} onClick={() => save.mutate(form)}>
                {save.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {adjustFor && (
        <div className="modal-overlay entry-fullpage-overlay" onClick={() => setAdjustFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Adjust stock — {adjustFor.name}</h3>
            <p style={{ color: "var(--muted)" }}>Current: {Number(adjustFor.stockQty)} {adjustFor.unit}</p>
            <label>Direction</label>
            <select value={adjust.direction} onChange={(e) => setAdjust({ ...adjust, direction: e.target.value })}>
              <option value="IN">IN (add stock)</option>
              <option value="OUT">OUT (remove stock)</option>
            </select>
            <label>Quantity *</label>
            <input type="number" value={adjust.quantity} onChange={(e) => setAdjust({ ...adjust, quantity: e.target.value })} />
            <label>Reason * (audit trail)</label>
            <input placeholder="damaged / found in store / correction…" value={adjust.reason}
              onChange={(e) => setAdjust({ ...adjust, reason: e.target.value })} />
            {error && <div className="error">{error}</div>}
            <div className="actions">
              <button onClick={() => setAdjustFor(null)}>Cancel</button>
              <button className="primary" disabled={doAdjust.isPending || !Number(adjust.quantity) || adjust.reason.length < 3}
                onClick={() => doAdjust.mutate()}>
                {doAdjust.isPending ? "Saving…" : "Apply adjustment"}
              </button>
            </div>
          </div>
        </div>
      )}

      {movesFor && (
        <div className="modal-overlay entry-fullpage-overlay" onClick={() => setMovesFor(null)}>
          <div className="modal" style={{ width: 640 }} onClick={(e) => e.stopPropagation()}>
            <h3>Stock history — {movesFor.name}</h3>
            <ListTable style={{ fontSize: 13 }}>
              <thead><tr><th>Time</th><th>Type</th><th style={{ textAlign: "right" }}>Qty</th><th style={{ textAlign: "right" }}>Balance</th><th>Note</th></tr></thead>
              <tbody>
                {movements.data?.map((m) => (
                  <tr key={m.id}>
                    <td>{new Date(m.createdAt).toLocaleString()}</td>
                    <td><span className="badge">{m.type.replace(/_/g, " ")}</span></td>
                    <td style={{ textAlign: "right" }}>{Number(m.quantity)}</td>
                    <td style={{ textAlign: "right" }}>{Number(m.balanceAfter)}</td>
                    <td style={{ fontSize: 12 }}>{m.reason ?? m.refType ?? ""}</td>
                  </tr>
                ))}
                {movements.data?.length === 0 && <tr><td colSpan={5} style={{ color: "var(--muted)" }}>No movements.</td></tr>}
              </tbody>
            </ListTable>
            <div className="actions"><button className="primary" onClick={() => setMovesFor(null)}>Close</button></div>
          </div>
        </div>
      )}
    </>
  );
}
