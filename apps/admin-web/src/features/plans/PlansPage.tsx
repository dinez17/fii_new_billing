import { IconButton } from "../../components/IconButton";
import { ListTable } from "../../components/ListPagination";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";
import { BulkImport } from "../../components/BulkImport";

interface PlanRow {
  id: string; code: string; name: string; description?: string;
  price: string; gstRate: string; hsnSac?: string; billingCycleMonths: number;
  planType: "PREPAID" | "POSTPAID"; isActive: boolean;
  _count: { subscriberPlans: number };
}

interface FormState {
  id?: string; name: string; code: string; description: string; price: string;
  gstRate: string; hsnSac: string; billingCycleMonths: string; planType: "PREPAID" | "POSTPAID";
}

const EMPTY: FormState = {
  name: "", code: "", description: "", price: "", gstRate: "18",
  hsnSac: "998422", billingCycleMonths: "1", planType: "PREPAID",
};

export function PlansPage() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPerm);
  const [form, setForm] = useState<FormState | null>(null);
  const [error, setError] = useState("");

  const plans = useQuery({
    queryKey: ["plans"],
    queryFn: async () => (await api.get("/plans", { params: { all: true } })).data as PlanRow[],
  });

  const save = useMutation({
    mutationFn: async (f: FormState) => {
      const body = {
        name: f.name, code: f.code, description: f.description || undefined,
        price: Number(f.price), gstRate: Number(f.gstRate), hsnSac: f.hsnSac || undefined,
        billingCycleMonths: Number(f.billingCycleMonths), planType: f.planType,
      };
      if (f.id) await api.put(`/plans/${f.id}`, body);
      else await api.post("/plans", body);
    },
    onSuccess: () => { setForm(null); setError(""); qc.invalidateQueries({ queryKey: ["plans"] }); },
    onError: (err) => setError(errMessage(err)),
  });

  async function deactivate(p: PlanRow) {
    if (!confirm(`Deactivate plan ${p.name}?`)) return;
    try { await api.delete(`/plans/${p.id}`); qc.invalidateQueries({ queryKey: ["plans"] }); }
    catch (err) { alert(errMessage(err)); }
  }

  const inr = (v: string) => `₹ ${Number(v).toFixed(2)}`;

  return (
    <>
      <h2 className="page-title">Plans</h2>
      <div className="toolbar">
        <div className="spacer" />
        {hasPerm("plan:create") && <BulkImport kind="plans" />}
        {hasPerm("plan:create") && (
          <button className="primary" onClick={() => { setForm(EMPTY); setError(""); }}>+ New Plan</button>
        )}
      </div>

      <ListTable>
        <thead>
          <tr><th>Code</th><th>Name</th><th>Price / month (excl. GST)</th><th>GST %</th><th>Active subs</th><th>Status</th><th /></tr>
        </thead>
        <tbody>
          {plans.data?.map((p) => (
            <tr key={p.id}>
              <td><code>{p.code}</code></td>
              <td>{p.name}</td>
              <td>{inr(p.price)}</td>
              <td>{Number(p.gstRate)}%</td>
              <td>{p._count.subscriberPlans}</td>
              <td><span className={`badge ${p.isActive ? "ok" : "warn"}`}>{p.isActive ? "active" : "inactive"}</span></td>
              <td style={{ whiteSpace: "nowrap" }}>
                {hasPerm("plan:update") && (
                  <IconButton className="small" onClick={() => setForm({
                    id: p.id, name: p.name, code: p.code, description: p.description ?? "",
                    price: String(p.price), gstRate: String(p.gstRate), hsnSac: p.hsnSac ?? "",
                    billingCycleMonths: "1", planType: p.planType,
                  })} icon="edit" label="Edit">Edit</IconButton>
                )}{" "}
                {hasPerm("plan:delete") && p.isActive && (
                  <IconButton className="small danger" onClick={() => void deactivate(p)} icon="delete" label="Deactivate">Deactivate</IconButton>
                )}
              </td>
            </tr>
          ))}
          {plans.data?.length === 0 && <tr><td colSpan={9} style={{ color: "var(--muted)" }}>No plans yet.</td></tr>}
        </tbody>
      </ListTable>

      {form && (
        <div className="modal-overlay" onClick={() => setForm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{form.id ? "Edit plan" : "New plan"}</h3>
            <label>Name *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Fiber 100 Mbps Unlimited" />
            <label>Code *</label>
            <input value={form.code} disabled={!!form.id} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="FIB100" />
            <label>Description</label>
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div><label>Price ₹ per MONTH (excl. GST) *</label><input type="number" value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })} /></div>
              <div>
                <label>GST rate %</label>
                <select value={form.gstRate} onChange={(e) => setForm({ ...form, gstRate: e.target.value })}>
                  <option>0</option><option>5</option><option>12</option><option>18</option><option>28</option>
                </select>
              </div>
              <div><label>HSN/SAC</label><input value={form.hsnSac} onChange={(e) => setForm({ ...form, hsnSac: e.target.value })} /></div>
            </div>
            <p style={{ color: "var(--muted)", fontSize: 12, marginTop: 8 }}>
              Plans work for both prepaid and postpaid subscribers. Billing frequency
              (monthly/quarterly/half-yearly/annual) is chosen per subscriber — the
              monthly price is multiplied accordingly.
            </p>
            {error && <div className="error">{error}</div>}
            <div className="actions">
              <button onClick={() => setForm(null)}>Cancel</button>
              <button className="primary" disabled={save.isPending || !form.name || !form.code || !form.price}
                onClick={() => save.mutate(form)}>{save.isPending ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
