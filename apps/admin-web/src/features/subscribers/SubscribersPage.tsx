import { useNavigate, useLocation, useParams } from "react-router-dom";
import { subscriptionStartDefault } from "../../lib/date";
import {SubscriberSchedules} from "./SubscriberSchedules";
import { formatDate } from "../../lib/date";
import { IconButton } from "../../components/IconButton";
import { RowsPerPage, usePageSize } from "../../components/ListPagination";
import { useEffect, useState } from "react";
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
  nextBilling?: { invoiceDate: string; periodStart: string; periodEnd: string } | null;
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
  activationDate: subscriptionStartDefault(), poNumber: "",
};

const CYCLES: Array<[string, string]> = [
  ["1", "Monthly"], ["3", "Quarterly (Apr/Jul/Oct/Jan)"], ["6", "Half-yearly (Apr/Oct)"], ["12", "Annual (Apr–Mar)"],
];
const cycleLabel = (n: number) => CYCLES.find(([v]) => Number(v) === n)?.[1] ?? `${n} mo`;
const connectionSince = (subscriber: SubRow) => subscriber.plans.length
  ? subscriber.plans.reduce((earliest, mapping) => mapping.startDate < earliest ? mapping.startDate : earliest, subscriber.plans[0].startDate)
  : subscriber.activationDate;

const inr = (v: unknown) => `₹${Number(v).toFixed(0)}`;

export function SubscribersPage() {
  const navigate=useNavigate(), location=useLocation(), {id:editId}=useParams();
  const newPage=location.pathname.endsWith("/new"), editorPage=newPage||!!editId;
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPerm);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize(() => setPage(1));
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("ACTIVE");
  const [type, setType] = useState("");
  const [form, setForm] = useState<CreateForm | null>(()=>newPage?{...EMPTY,activationDate:subscriptionStartDefault()}:null);
  const [manageFor, setManageFor] = useState<SubRow | null>(null);
  const [serviceFor, setServiceFor] = useState<SubRow | null>(null);
  const [poDraft, setPoDraft] = useState("");
  const [addPlan, setAddPlan] = useState({ planId: "", startDate: subscriptionStartDefault(), override: "", location: "" });
  const [impact,setImpact]=useState<{mapping:Mapping;body:object;data:{oldCycle:number;newCycle:number;message:string}}|null>(null);
  const [connectionDrafts, setConnectionDrafts] = useState<Record<string, ConnectionDraft>>({});
  const [savingConnection, setSavingConnection] = useState<string | null>(null);
  const [error, setError] = useState("");
  const editor=useQuery({queryKey:["subscriber-editor",editId],enabled:!!editId,queryFn:async()=>(await api.get(`/subscribers/${editId}`)).data as SubRow});
  useEffect(()=>{if(newPage){setForm({...EMPTY,activationDate:subscriptionStartDefault()});setManageFor(null);}else if(editId){setForm(null);}else{setForm(null);setManageFor(null);}setError("");},[newPage,editId]);
  useEffect(()=>{if(editId&&editor.data){setManageFor({...editor.data,plans:editor.data.plans.filter(p=>!(p as Mapping & {endDate?:string}).endDate)});setPoDraft(editor.data.poNumber??"");}},[editId,editor.data]);
  const closeEditor=()=>{setForm(null);setManageFor(null);navigate("/subscribers");};

  const subs = useQuery({
    queryKey: ["subscribers", page, search, status, type, pageSize],
    enabled: !editorPage,
    queryFn: async () => (await api.get("/subscribers", {
      params: {
        page, limit: pageSize, search: search || undefined,
        status: status || undefined, subscriberType: type || undefined,
      },
    })).data as { items: SubRow[]; total: number; limit: number },
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
    onSuccess: () => { closeEditor(); setError(""); qc.invalidateQueries({ queryKey: ["subscribers"] }); },
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
      const body={ planId: draft.planId, location: draft.location, priceOverride: draft.price ? Number(draft.price) : null, startDate: draft.startDate };
      const response=await api.post(`/subscribers/${manageFor!.id}/plans/${mapping.id}/preview`,body);
      setImpact({mapping,body,data:response.data});


      setError("");
      qc.invalidateQueries({ queryKey: ["subscribers"] });
    } catch (err) { setError(errMessage(err)); }
    finally { setSavingConnection(null); }
  }

  async function confirmConnectionChange(){if(!impact||!manageFor)return;setSavingConnection(impact.mapping.id);try{const {data}=await api.put(`/subscribers/${manageFor.id}/plans/${impact.mapping.id}`,impact.body);setManageFor(current=>current?{...current,plans:current.plans.map(row=>row.id===impact.mapping.id?data as Mapping:row)}:current);setConnectionDrafts(current=>{const next={...current};delete next[impact.mapping.id];return next;});setImpact(null);void qc.invalidateQueries({queryKey:["subscribers"]});}catch(e){setError(errMessage(e));}finally{setSavingConnection(null);}}
  async function action(sub: SubRow, act: "suspend" | "activate" | "terminate") {
    if (act === "terminate" && !confirm(`Terminate ${sub.code}? This cannot be undone.`)) return;
    try { await api.post(`/subscribers/${sub.id}/${act}`); qc.invalidateQueries({ queryKey: ["subscribers"] }); }
    catch (err) { alert(errMessage(err)); }
  }

  // plans serve both prepaid and postpaid
  const selectedCount = form?.planSel.length ?? 0;

  return (
    <>
      {!editorPage && <>
      <div className="page-heading"><h2 className="page-title">Subscribers</h2><div className="page-heading-actions">{hasPerm("subscriber:create") && (
          <button className="primary" onClick={() => { navigate("/subscribers/new"); setError(""); }}>+ New Subscriber</button>
        )}</div></div>
      <div className="toolbar">
        <RowsPerPage value={pageSize} onChange={setPageSize} />
        <div className="filter-search-row"><input style={{ width: 240 }} placeholder="Search code / name / phone…" value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }} /></div>
        <select style={{ width: 140 }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All status</option><option>ACTIVE</option><option>SUSPENDED</option><option>TERMINATED</option>
        </select>
        <select style={{ width: 140 }} value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
          <option value="">All types</option><option>PREPAID</option><option>POSTPAID</option>
        </select>
        <div className="spacer" />

      </div>

      <table>
        <thead>
          <tr><th>Code</th><th>Customer</th><th>Type</th><th>Plans</th><th>Status</th><th>Since</th><th>Next billing / unbilled period</th><th /></tr>
        </thead>
        <tbody>
          {subs.data?.items.map((s) => (
            <tr key={s.id}>
              <td><code>{s.code}</code>{s.poNumber && <div style={{ fontSize: 11, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={s.poNumber}>PO: {s.poNumber}</div>}</td>
              <td>{s.customer.name}<div style={{ color: "var(--muted)", fontSize: 12 }}>{s.customer.phone}</div></td>
              <td>
                <div className="subscriber-type-line"><span className="badge">{s.subscriberType}</span></div>
                <div className="subscriber-type-line"><span className="badge">{cycleLabel(s.billingCycleMonths)}</span></div>
                <div><span className="badge">{s.chargeGst ? "GST" : "Without GST"}</span></div>
              </td>
              <td style={{ fontSize: 13 }}>
                {s.plans.length
                  ? s.plans.map((m) => (
                      <div key={m.id} className="subscriber-plan-line"><div>{m.plan.name}</div>{m.location && <div className="document-help">{m.location}</div>}<div className="document-help">{inr(m.priceOverride ?? m.plan.price)}</div></div>
                    ))
                  : <span style={{ color: "var(--danger)" }}>no plan</span>}
              </td>
              <td><span className={`badge ${s.status === "ACTIVE" ? "ok" : s.status === "TERMINATED" ? "warn" : ""}`}>{s.status}</span></td>
              <td style={{whiteSpace:"nowrap"}} title={`Earliest active connection start. Subscriber activated ${formatDate(s.activationDate)}`}>{formatDate(connectionSince(s))}</td>
              <td>{s.nextBilling ? <div className="subscriber-billing-lines"><div>Bill date: {formatDate(s.nextBilling.invoiceDate)}</div><div>From: {formatDate(s.nextBilling.periodStart)}</div><div>To: {formatDate(s.nextBilling.periodEnd)}</div></div> : "—"}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                {hasPerm("subscriber:update") && s.status !== "TERMINATED" && (
                  <>
                    <IconButton className="small" onClick={() => { navigate(`/subscribers/${s.id}/edit`); }} icon="edit" label="Manage subscriber / PO number">Manage</IconButton>{" "}
                    <IconButton className="small" icon="calendar" label="Service changes" onClick={() => setServiceFor(s)} />{" "}
                    {s.status === "ACTIVE"
                      ? <IconButton className="small" onClick={() => void action(s, "suspend")} icon="pause" label="Suspend">Suspend</IconButton>
                      : <IconButton className="small" onClick={() => void action(s, "activate")} icon="check" label="Activate">Activate</IconButton>}{" "}
                    <IconButton className="small danger" onClick={() => void action(s, "terminate")} icon="terminate" label="Terminate">Terminate</IconButton>
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

      </>}
      {editorPage && <div className="page-heading"><h2 className="page-title">{newPage?"New subscriber":"Edit subscriber"}</h2><button onClick={closeEditor}>← Back to subscribers</button></div>}
      {editor.isError && <div className="error">{errMessage(editor.error)}</div>}
      {editId && editor.isPending && <p>Loading subscriber…</p>}
      {form && (
        <div className="subscriber-editor-page">
          <section className="card subscriber-editor" aria-label="Create subscriber">
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
            <label>Location / connection (optional)<input aria-label="New subscription connection location" maxLength={100} placeholder="Location / connection (optional)" value={addPlan.location} onChange={e=>setAddPlan({...addPlan,location:e.target.value})}/></label>
            <div className="subscriber-connection-grid">
              <EntitySelect kind="plans" value={addPlan.planId} placeholder="Search plan name / code…" onChange={planId=>setAddPlan({...addPlan,planId})}/>
              <input aria-label="New subscription connection price" type="number" min="0.01" step="0.01" placeholder="Override ₹/mo (optional)" value={addPlan.override} onChange={e=>setAddPlan({...addPlan,override:e.target.value})}/>
              <button type="button" disabled={!addPlan.planId || selectedCount>=50 || (!!addPlan.override && (!Number.isFinite(Number(addPlan.override)) || Number(addPlan.override)<=0))} onClick={()=>{setForm({...form,planSel:[...form.planSel,{key:crypto.randomUUID(),planId:addPlan.planId,override:addPlan.override,location:addPlan.location}]});setAddPlan({...addPlan,planId:"",override:"",location:""});}}>Add plan</button>
            </div>
            <small>Select a plan and add a connection. The same plan can be added for multiple locations; blank override uses the plan price.</small>
            <div style={{ maxHeight: 230, overflowY: "auto" }}>
              {form.planSel.map((sel, index) => (
                <div key={sel.key} style={{ borderBottom: "1px solid var(--border)", padding: "6px 0" }}>
                  <label>Connection {index + 1}<EntitySelect kind="plans" value={sel.planId} placeholder={`Plan for connection ${index + 1}`} onChange={planId=>setForm({...form,planSel:form.planSel.map(row=>row.key===sel.key?{...row,planId}:row)})}/></label>
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
              <button onClick={closeEditor}>Cancel</button>
              <button className="primary" disabled={create.isPending || !form.customerId || selectedCount === 0 || form.planSel.some(row=>!row.planId || (!!row.override && (!Number.isFinite(Number(row.override)) || Number(row.override)<=0)))}
                onClick={() => create.mutate(form)}>
                {create.isPending ? "Creating…" : `Create (${selectedCount} plan${selectedCount === 1 ? "" : "s"})`}
              </button>
            </div>
          </section>
        </div>
      )}

      {impact && <div className="modal-overlay" style={{zIndex:1500}}><div className="modal" role="dialog" aria-modal="true"><h3>Review plan billing impact</h3><p>Current cycle price ₹{impact.data.oldCycle.toLocaleString("en-IN")} → new cycle price ₹{impact.data.newCycle.toLocaleString("en-IN")} before GST.</p><p>{impact.data.message}</p><div className="actions"><button onClick={()=>setImpact(null)}>Keep current connection</button><button disabled={savingConnection!==null} onClick={()=>void confirmConnectionChange()}>Confirm connection change</button></div></div></div>}
      {serviceFor && hasPerm("subscriber:update") && (
        <div className="modal-overlay entry-fullpage-overlay" onClick={() => setServiceFor(null)}>
          <div className="modal" role="dialog" aria-modal="true" aria-labelledby="service-changes-title" style={{ width: 600 }} onClick={e => e.stopPropagation()} onKeyDown={e => { if (e.key === "Escape") setServiceFor(null); }}>
            <h3 id="service-changes-title">Service changes — {serviceFor.code}</h3>
            <p>{serviceFor.customer.name}</p>
            <SubscriberSchedules key={serviceFor.id} id={serviceFor.id} />
            <div className="actions"><button onClick={() => setServiceFor(null)}>Close</button></div>
          </div>
        </div>
      )}

      {manageFor && (
        <div className="subscriber-editor-page">
          <section className="card subscriber-editor" aria-label="Edit subscriber details">
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
              <thead><tr><th>Plan</th><th>Price</th><th>Since</th><th>Next billing / unbilled period</th><th /></tr></thead>
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
              <button onClick={closeEditor}>Back to subscribers</button>
            </div>
          </section>
        </div>
      )}
    </>
  );
}
