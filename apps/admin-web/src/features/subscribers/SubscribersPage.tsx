import { formatDate } from "../../lib/date";
import { IconButton } from "../../components/IconButton";
import { RowsPerPage, usePageSize } from "../../components/ListPagination";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";
import { EntitySelect } from "../../components/EntitySelect";

interface PlanLite { id: string; name: string; code: string; price: string; planType: string }
interface Mapping { id: string; priceOverride?: string; startDate: string; location?: string | null; plan: PlanLite }
interface ConnectionDraft { planId: string; location: string; price: string; startDate: string }
const connectionDraft = (mapping: Mapping): ConnectionDraft => ({ planId: mapping.plan.id, location: mapping.location ?? "", price: mapping.priceOverride == null ? "" : String(mapping.priceOverride), startDate: mapping.startDate.slice(0, 10) });
interface SubRow {
  id: string; code: string; subscriberType: "PREPAID" | "POSTPAID";
  billingCycleMonths: number;
  chargeGst: boolean;
  poNumber?: string | null;
  status: "ACTIVE" | "SUSPENDED" | "TERMINATED"; activationDate: string;
  customer: { id: string; name: string; phone: string };
  plans: Mapping[];
}

interface CreateForm {
  customerId: string; subscriberType: "PREPAID" | "POSTPAID";
  billingCycleMonths: string;
  chargeGst: boolean;
  planSel: { key: string; planId: string; override: string; location: string }[];
  activationDate: string; poNumber: string;
}
const EMPTY: CreateForm = {
  customerId: "", subscriberType: "PREPAID", billingCycleMonths: "1", chargeGst: true, planSel: [],
  activationDate: new Date().toISOString().slice(0, 10), poNumber: "",
};

const CYCLES: Array<[string, string]> = [
  ["1", "Monthly"], ["3", "Quarterly"], ["6", "Half-yearly"], ["12", "Annual"],
];
const cycleLabel = (n: number) => CYCLES.find(([v]) => Number(v) === n)?.[1] ?? `${n} mo`;
const connectionSince = (subscriber: SubRow) => subscriber.plans.length
  ? subscriber.plans.reduce((earliest, mapping) => mapping.startDate < earliest ? mapping.startDate : earliest, subscriber.plans[0].startDate)
  : subscriber.activationDate;

const inr = (v: unknown) => `₹${Number(v).toFixed(0)}`;

export function SubscribersPage() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPerm);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize(() => setPage(1));
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [planSearch, setPlanSearch] = useState("");
  const [type, setType] = useState("");
  const [form, setForm] = useState<CreateForm | null>(null);
  const [manageFor, setManageFor] = useState<SubRow | null>(null);
  const [poDraft, setPoDraft] = useState("");
  const [addPlan, setAddPlan] = useState({ planId: "", startDate: new Date().toISOString().slice(0, 10), override: "", location: "" });
  const [connectionDrafts, setConnectionDrafts] = useState<Record<string, ConnectionDraft>>({});
  const [savingConnection, setSavingConnection] = useState<string | null>(null);
  const [error, setError] = useState("");

  const subs = useQuery({
    queryKey: ["subscribers", page, search, status, type, pageSize],
    queryFn: async () => (await api.get("/subscribers", {
      params: {
        page, limit: pageSize, search: search || undefined,
        status: status || undefined, subscriberType: type || undefined,
      },
    })).data as { items: SubRow[]; total: number; limit: number },
  });

  const plans = useQuery({
    queryKey: ["plans-active"],
    queryFn: async () => (await api.get("/plans")).data as PlanLite[],
    enabled: !!form || !!manageFor,
  });

  const create = useMutation({
    mutationFn: async (f: CreateForm) => {
      await api.post("/subscribers", {
        customerId: f.customerId,
        subscriberType: f.subscriberType,
        billingCycleMonths: Number(f.billingCycleMonths),
        chargeGst: f.chargeGst,
        activationDate: f.activationDate,
        poNumber: f.poNumber,
        plans: f.planSel.map((v) => ({ planId: v.planId, location: v.location, priceOverride: v.override ? Number(v.override) : undefined })),
      });
    },
    onSuccess: () => { setForm(null); setError(""); qc.invalidateQueries({ queryKey: ["subscribers"] }); },
    onError: (err) => setError(errMessage(err)),
  });

  const savePo = useMutation({
    mutationFn: async () => (await api.put(`/subscribers/${manageFor!.id}`, { poNumber: poDraft })).data as SubRow,
    onSuccess: (data) => { setManageFor((current) => current ? { ...current, poNumber: data.poNumber } : current); setError(""); qc.invalidateQueries({ queryKey: ["subscribers"] }); },
    onError: (err) => setError(errMessage(err)),
  });
  const doAddPlan = useMutation({
    mutationFn: async () => {
      await api.post(`/subscribers/${manageFor!.id}/plans`, {
        planId: addPlan.planId,
        startDate: addPlan.startDate,
        location: addPlan.location,
        priceOverride: addPlan.override ? Number(addPlan.override) : undefined,
      });
    },
    onSuccess: async () => {
      setError(""); setAddPlan({ ...addPlan, planId: "", override: "", location: "" });
      await qc.invalidateQueries({ queryKey: ["subscribers"] });
      // refresh the open dialog with new data
      const { data } = await api.get(`/subscribers/${manageFor!.id}`);
      setManageFor((m) => (m ? { ...m, plans: data.plans.filter((p: { endDate?: string }) => !p.endDate) } : m));
    },
    onError: (err) => setError(errMessage(err)),
  });

  async function endPlan(mapping: Mapping) {
    if (manageFor!.plans.length === 1 &&
      !confirm("This is the subscriber's only plan — ending it means the next billing run will skip/fail them. Continue?")) return;
    else if (manageFor!.plans.length > 1 && !confirm(`End plan "${mapping.plan.name}" from today?`)) return;
    try {
      await api.post(`/subscribers/${manageFor!.id}/plans/${mapping.id}/end`, { endDate: new Date().toISOString().slice(0, 10) });
      await qc.invalidateQueries({ queryKey: ["subscribers"] });
      setManageFor((m) => (m ? { ...m, plans: m.plans.filter((p) => p.id !== mapping.id) } : m));
    } catch (err) { alert(errMessage(err)); }
  }

  function editConnection(mapping: Mapping, patch: Partial<ConnectionDraft>) {
    setConnectionDrafts((current) => ({ ...current, [mapping.id]: { ...(current[mapping.id] ?? connectionDraft(mapping)), ...patch } }));
  }
  async function saveConnection(mapping: Mapping) {
    const draft = connectionDrafts[mapping.id] ?? connectionDraft(mapping);
    setSavingConnection(mapping.id);
    try {
      const { data } = await api.put(`/subscribers/${manageFor!.id}/plans/${mapping.id}`, { planId: draft.planId, location: draft.location, priceOverride: draft.price ? Number(draft.price) : null, startDate: draft.startDate });
      setManageFor((current) => current ? { ...current, plans: current.plans.map((row) => row.id === mapping.id ? data as Mapping : row) } : current);
      setConnectionDrafts((current) => { const next = { ...current }; delete next[mapping.id]; return next; });
      setError("");
      qc.invalidateQueries({ queryKey: ["subscribers"] });
    } catch (err) { setError(errMessage(err)); }
    finally { setSavingConnection(null); }
  }

  async function action(sub: SubRow, act: "suspend" | "activate" | "terminate") {
    if (act === "terminate" && !confirm(`Terminate ${sub.code}? This cannot be undone.`)) return;
    try { await api.post(`/subscribers/${sub.id}/${act}`); qc.invalidateQueries({ queryKey: ["subscribers"] }); }
    catch (err) { alert(errMessage(err)); }
  }

  // plans serve both prepaid and postpaid
  const allPlans = () => plans.data ?? [];
  const selectedCount = form?.planSel.length ?? 0;

  return (
    <>
      <h2 className="page-title">Subscribers</h2>
      <div className="toolbar">
        <RowsPerPage value={pageSize} onChange={setPageSize} />
        <input style={{ width: 240 }} placeholder="Search code / name / phone…" value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select style={{ width: 140 }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All status</option><option>ACTIVE</option><option>SUSPENDED</option><option>TERMINATED</option>
        </select>
        <select style={{ width: 140 }} value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
          <option value="">All types</option><option>PREPAID</option><option>POSTPAID</option>
        </select>
        <div className="spacer" />
        {hasPerm("subscriber:create") && (
          <button className="primary" onClick={() => { setForm({ ...EMPTY, activationDate: new Date().toISOString().slice(0, 10) }); setPlanSearch(""); setError(""); }}>+ New Subscriber</button>
        )}
      </div>

      <table>
        <thead>
          <tr><th>Code</th><th>Customer</th><th>Type</th><th>Plans</th><th>Status</th><th>Since</th><th /></tr>
        </thead>
        <tbody>
          {subs.data?.items.map((s) => (
            <tr key={s.id}>
              <td><code>{s.code}</code>{s.poNumber && <div style={{ fontSize: 11, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.poNumber}>PO: {s.poNumber}</div>}</td>
              <td>{s.customer.name}<div style={{ color: "var(--muted)", fontSize: 12 }}>{s.customer.phone}</div></td>
              <td>
                <span className="badge">{s.subscriberType}</span>{" "}
                <span className="badge">{cycleLabel(s.billingCycleMonths)}</span>
                <div><span className="badge">{s.chargeGst ? "GST" : "Without GST"}</span></div>
              </td>
              <td style={{ fontSize: 13 }}>
                {s.plans.length
                  ? s.plans.map((m) => (
                      <div key={m.id}>{m.plan.name}{m.location && ` — ${m.location}`} <span style={{ color: "var(--muted)" }}>{inr(m.priceOverride ?? m.plan.price)}</span></div>
                    ))
                  : <span style={{ color: "var(--danger)" }}>no plan</span>}
              </td>
              <td><span className={`badge ${s.status === "ACTIVE" ? "ok" : s.status === "TERMINATED" ? "warn" : ""}`}>{s.status}</span></td>
              <td title={`Earliest active connection start. Subscriber activated ${formatDate(s.activationDate)}`}>{formatDate(connectionSince(s))}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                {hasPerm("subscriber:update") && s.status !== "TERMINATED" && (
                  <>
                    <IconButton className="small" onClick={() => { setManageFor(s); setPoDraft(s.poNumber ?? ""); setError(""); }} icon="edit" label="Manage subscriber / PO number">Manage</IconButton>{" "}
                    {s.status === "ACTIVE"
                      ? <IconButton className="small" onClick={() => void action(s, "suspend")} icon="more" label="Suspend">Suspend</IconButton>
                      : <IconButton className="small" onClick={() => void action(s, "activate")} icon="check" label="Activate">Activate</IconButton>}{" "}
                    <IconButton className="small danger" onClick={() => void action(s, "terminate")} icon="more" label="Terminate">Terminate</IconButton>
                  </>
                )}
              </td>
            </tr>
          ))}
          {subs.data?.items.length === 0 && (
            <tr><td colSpan={7} style={{ color: "var(--muted)" }}>No subscribers found.</td></tr>
          )}
        </tbody>
      </table>

      {subs.data && (
        <div className="pagination">
          <button className="small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <span>Page {page} of {Math.max(1, Math.ceil(subs.data.total / subs.data.limit))}</span>
          <button className="small" disabled={page * subs.data.limit >= subs.data.total} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}

      {form && (
        <div className="modal-overlay entry-fullpage-overlay" onClick={() => setForm(null)}>
          <div className="modal compact-modal" style={{ width: 640 }} onClick={(e) => e.stopPropagation()}>
            <h3>New subscriber</h3>
            <label>Customer * (active customers only)</label>
            <EntitySelect kind="customers" activeOnly placeholder="Search active customers…" value={form.customerId} onChange={(id) => setForm({ ...form, customerId: id })} />
            <label>PO number</label><input maxLength={100} value={form.poNumber} onChange={(e) => setForm({ ...form, poNumber: e.target.value })} />
            <label>GST billing</label>
            <select value={String(form.chargeGst)} onChange={(e) => setForm({ ...form, chargeGst: e.target.value === "true" })}>
              <option value="true">Charge GST — use plan tax rates</option><option value="false">Without GST — zero tax</option>
            </select>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label>Type</label>
                <select value={form.subscriberType}
                  onChange={(e) => setForm({ ...form, subscriberType: e.target.value as CreateForm["subscriberType"] })}>
                  <option>PREPAID</option><option>POSTPAID</option>
                </select>
              </div>
              <div>
                <label>Billing frequency</label>
                <select value={form.billingCycleMonths}
                  onChange={(e) => setForm({ ...form, billingCycleMonths: e.target.value })}>
                  {CYCLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </div>
            </div>

            <label>Plans / connections * (add the same plan for each location)</label>
            <input aria-label="Search plans to subscribe" placeholder="Search plan name / code…" value={planSearch} onChange={(e) => setPlanSearch(e.target.value)} />
            <div style={{ border: "1px solid var(--border)", borderRadius: 8, padding: 8, maxHeight: 150, overflowY: "auto" }}>
              {allPlans().filter((p) => `${p.name} ${p.code}`.toLowerCase().includes(planSearch.toLowerCase())).map((p) => (
                <div key={p.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 2px" }}>
                  <span style={{ flex: 1 }}>{p.name} <small>{inr(p.price)}/mo</small></span>
                  <button type="button" className="small" disabled={selectedCount >= 50} onClick={() => setForm({ ...form, planSel: [...form.planSel, { key: crypto.randomUUID(), planId: p.id, override: "", location: "" }] })}>+ Add</button>
                </div>
              ))}
              {allPlans().length === 0 && <small>No plans yet — create one under Plans.</small>}
            </div>
            <div style={{ maxHeight: 230, overflowY: "auto" }}>
              {form.planSel.map((sel, index) => (
                <div key={sel.key} style={{ borderBottom: "1px solid var(--border)", padding: "6px 0" }}>
                  <small>{index + 1}. {allPlans().find((p) => p.id === sel.planId)?.name}</small>
                  <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr auto", gap: 6 }}>
                    <input aria-label={`Connection ${index + 1} location (optional)`} maxLength={100} placeholder="Location / connection (optional)" value={sel.location} onChange={(e) => setForm({ ...form, planSel: form.planSel.map((row) => row.key === sel.key ? { ...row, location: e.target.value } : row) })} />
                    <input aria-label={`Connection ${index + 1} price`} type="number" min="0.01" step="0.01" placeholder="Override ₹/mo" value={sel.override} onChange={(e) => setForm({ ...form, planSel: form.planSel.map((row) => row.key === sel.key ? { ...row, override: e.target.value } : row) })} />
                    <IconButton icon="close" label={`Remove connection ${index + 1}`} onClick={() => setForm({ ...form, planSel: form.planSel.filter((row) => row.key !== sel.key) })} />
                  </div>
                </div>
              ))}
            </div>
            <small>{selectedCount} of 50 connections added</small>
            <div>
              <div><label>Activation date</label>
                <input type="date" value={form.activationDate} onChange={(e) => setForm({ ...form, activationDate: e.target.value })} /></div>
            </div>
            {error && <div className="error">{error}</div>}
            <div className="actions">
              <button onClick={() => setForm(null)}>Cancel</button>
              <button className="primary" disabled={create.isPending || !form.customerId || selectedCount === 0}
                onClick={() => create.mutate(form)}>
                {create.isPending ? "Creating…" : `Create (${selectedCount} plan${selectedCount === 1 ? "" : "s"})`}
              </button>
            </div>
          </div>
        </div>
      )}

      {manageFor && (
        <div className="modal-overlay entry-fullpage-overlay" onClick={() => setManageFor(null)}>
          <div className="modal compact-modal" style={{ width: 820 }} onClick={(e) => e.stopPropagation()}>
            <h3>Subscriber — {manageFor.code} <span style={{ fontWeight: 400, fontSize: 14 }}>({manageFor.customer.name})</span></h3>
            <label>Subscriber type</label>
            <select aria-label="Edit subscriber type" value={manageFor.subscriberType} onChange={async (e) => {
              const subscriberType = e.target.value as SubRow["subscriberType"];
              try { await api.put(`/subscribers/${manageFor.id}`, { subscriberType }); setManageFor({ ...manageFor, subscriberType }); void qc.invalidateQueries({ queryKey: ["subscribers"] }); } catch (err) { setError(errMessage(err)); }
            }}><option>PREPAID</option><option>POSTPAID</option></select>
            <label>PO number</label>
            <div style={{ display: "flex", gap: 8, marginBottom: 6 }}><input aria-label="Subscriber PO number" maxLength={100} value={poDraft} onChange={(e) => setPoDraft(e.target.value)} /><button style={{ whiteSpace: "nowrap" }} disabled={savePo.isPending || poDraft.trim() === (manageFor.poNumber ?? "")} onClick={() => savePo.mutate()}>{savePo.isPending ? "Saving…" : "Save PO"}</button></div>
            <p style={{ fontSize: 12, color: "var(--muted)" }}>Used on new invoices for this subscriber. Issued invoices retain their saved PO.</p>
            <label>GST billing (future invoices only)</label>
            <select value={String(manageFor.chargeGst)} disabled={!hasPerm("subscriber:update")}
              onChange={async (e) => {
                const chargeGst = e.target.value === "true";
                try {
                  await api.put(`/subscribers/${manageFor.id}`, { chargeGst });
                  setManageFor({ ...manageFor, chargeGst });
                  qc.invalidateQueries({ queryKey: ["subscribers"] });
                } catch (err) { setError(errMessage(err)); }
              }}>
              <option value="true">Charge GST — use plan tax rates</option><option value="false">Without GST — zero tax</option>
            </select>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <span style={{ color: "var(--muted)", fontSize: 13 }}>Billing frequency:</span>
              <select style={{ width: 160 }} value={String(manageFor.billingCycleMonths)}
                onChange={async (e) => {
                  const v = Number(e.target.value);
                  try {
                    await api.put(`/subscribers/${manageFor.id}`, { billingCycleMonths: v });
                    setManageFor({ ...manageFor, billingCycleMonths: v });
                    qc.invalidateQueries({ queryKey: ["subscribers"] });
                  } catch (err) { alert(errMessage(err)); }
                }}>
                {CYCLES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
              <span style={{ color: "var(--muted)", fontSize: 12 }}>applies from the next billing cycle</span>
            </div>
            <table style={{ fontSize: 13 }}>
              <thead><tr><th>Plan</th><th>Price</th><th>Since</th><th /></tr></thead>
              <tbody>
                {manageFor.plans.map((m) => {
                  const draft = connectionDrafts[m.id] ?? connectionDraft(m);
                  const changed = JSON.stringify(draft) !== JSON.stringify(connectionDraft(m));
                  return (
                  <tr key={m.id}>
                    <td>
                      <EntitySelect kind="plans" value={draft.planId} placeholder={m.plan.name} onChange={(planId) => editConnection(m, { planId })} />
                      <div style={{ display: "flex", gap: 4 }}>
                        <input aria-label={`Location for ${m.plan.name} (optional)`} maxLength={100} placeholder="Location / connection (optional)" disabled={!hasPerm("subscriber:update")} value={draft.location} onChange={(e) => editConnection(m, { location: e.target.value })} />
                      </div>
                    </td>
                    <td><input aria-label={`Price override for ${m.plan.name}`} type="number" min="0.01" step="0.01" style={{ width: 115 }} placeholder={inr(m.plan.price)} value={draft.price} disabled={!hasPerm("subscriber:update")} onChange={(e) => editConnection(m, { price: e.target.value })} /><small>Blank = plan price</small></td>
                    <td><input aria-label={`Start date for ${m.plan.name}`} type="date" style={{ width: 135 }} value={draft.startDate} disabled={!hasPerm("subscriber:update")} onChange={(e) => editConnection(m, { startDate: e.target.value })} /></td>
                    <td style={{ whiteSpace: "nowrap" }}><IconButton icon="check" label="Save connection changes" disabled={!hasPerm("subscriber:update") || !changed || !draft.planId || !draft.startDate || savingConnection !== null} onClick={() => void saveConnection(m)} />{" "}<IconButton className="small danger" onClick={() => void endPlan(m)} icon="more" label="End">End</IconButton></td>
                  </tr>
                ); })}
                {manageFor.plans.length === 0 && (
                  <tr><td colSpan={4} style={{ color: "var(--danger)" }}>No active plans — billing will skip this subscriber.</td></tr>
                )}
              </tbody>
            </table>
            <small>Edit a connection and click its check icon to save. Existing invoices retain their saved details.</small>

            <label style={{ marginTop: 14 }}>Add a plan / another connection</label>
            <input aria-label="New connection location (optional)" maxLength={100} placeholder="Location / connection (optional)" value={addPlan.location} onChange={(e) => setAddPlan({ ...addPlan, location: e.target.value })} />
            <small>Location is optional. Select a plan below to enable Add plan.</small>
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 8 }}>
              <EntitySelect kind="plans" value={addPlan.planId} placeholder="Search plan name / code…" onChange={(planId) => setAddPlan({ ...addPlan, planId })} />
              <input type="date" value={addPlan.startDate} onChange={(e) => setAddPlan({ ...addPlan, startDate: e.target.value })} />
              <input type="number" placeholder="override ₹" value={addPlan.override}
                onChange={(e) => setAddPlan({ ...addPlan, override: e.target.value })} />
            </div>
            {error && <div className="error">{error}</div>}
            <div className="actions">
              <button className="primary" disabled={doAddPlan.isPending || !addPlan.planId} onClick={() => doAddPlan.mutate()}>
                {doAddPlan.isPending ? "Adding…" : "Add plan"}
              </button>
              <button onClick={() => setManageFor(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
