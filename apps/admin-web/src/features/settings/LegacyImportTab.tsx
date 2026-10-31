import { LegacyReconcile } from "./LegacyReconcile";
import { IconButton } from "../../components/IconButton";
import { RowsPerPage, usePageSize } from "../../components/ListPagination";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";

interface Approval { approved: boolean; note: string; reviewedAt: string }
interface LegacyRow { approval?: Approval | null; id: string; sourceTable: string; sourceId: string; status: string; reason: string | null; targetModel: string | null; targetId: string | null }
interface Manifest { name: string; financialYears: string[]; nativeCounts: Record<string, number>; heldDocuments: Record<string, string>; limitations: string[] }
export function LegacyImportTab() {
  const [reconcileId, setReconcileId] = useState("");
  const canPost = useAuth(state => state.hasPerm("backup:update") && ((state.hasPerm("invoice:create") && state.hasPerm("payment:create"))||(state.hasPerm("purchase_invoice:create")&&state.hasPerm("supplier_payment:create"))));
  const [bulk, setBulk] = useState(false);
  const canApprove = useAuth((state) => state.hasPerm("backup:update"));
  const [reviewRow, setReviewRow] = useState<LegacyRow | null>(null), [note, setNote] = useState(""), [busy, setBusy] = useState(false), [reviewError, setReviewError] = useState("");
  const user = useAuth((state) => state.user?.id);
  const [status, setStatus] = useState("REVIEW"), [sourceTable, setTable] = useState(""), [search, setSearch] = useState(""), [page, setPage] = useState(1), [detailId, setDetail] = useState<string | null>(null);
  const [pageSize, setPageSize] = usePageSize(() => setPage(1));
  const summary = useQuery({ queryKey: ["legacy-summary", user], queryFn: async () => (await api.get("/settings/legacy-imports/summary")).data as { manifest: Manifest | null; groups: { sourceTable: string; status: string; count: number }[] } });
  const records = useQuery({ queryKey: ["legacy-records", user, status, sourceTable, search, page, pageSize], queryFn: async () => (await api.get("/settings/legacy-imports/records", { params: { status: status || undefined, sourceTable: sourceTable || undefined, search: search || undefined, page, limit: pageSize } })).data as { items: LegacyRow[]; total: number; limit: number } });
  const detail = useQuery({ queryKey: ["legacy-detail", user, detailId], queryFn: async () => (await api.get(`/settings/legacy-imports/records/${detailId}`)).data as LegacyRow & { data: Record<string, unknown> }, enabled: !!detailId });
  async function saveApproval() {
    if (!reviewRow && !bulk) return;
    setBusy(true); setReviewError("");
    try {
      if (bulk) await api.post("/settings/legacy-imports/approve-all", { note, confirm: true });
      else if (reviewRow) await api.post(`/settings/legacy-imports/records/${reviewRow.id}/approval`, { approved: !reviewRow?.approval?.approved, note });
      await records.refetch(); setReviewRow(null); setBulk(false); setNote("");
    } catch (error) { setReviewError(errMessage(error)); } finally { setBusy(false); }
  }
  const manifest = summary.data?.manifest;
  return <>
    <div className="card"><h3>Legacy import</h3>
      {summary.isPending && <p>Loading import summary…</p>}{summary.isError && <div className="error">{errMessage(summary.error)}</div>}
      {manifest ? <><p>{manifest.name} · Financial years: {manifest.financialYears.join(", ")}</p>
        <div className="error" role="status">Historical financial reports include only imported documents. Held documents and their receipts are excluded until corrected. Do not use these reports as a complete historical closing balance yet.</div>
        <p>{manifest.nativeCounts.customer ?? 0} customers · {manifest.nativeCounts.supplier ?? 0} suppliers · {manifest.nativeCounts.product ?? 0} products · {manifest.nativeCounts.invoice ?? 0} invoices · {manifest.nativeCounts.payment ?? 0} payments</p>
        <p>To approve a document, select user_bills (sales) or user_purchase_bills (purchases), then use its check icon. Approval records your review; the invoice and receipts remain excluded until a reconciled import is completed.</p>
        <p>{Object.keys(manifest.heldDocuments).length} financial documents held for review. Original source records are preserved below.</p>
        <details><summary>Migration limitations</summary><ul>{manifest.limitations.map((item) => <li key={item}>{item}</li>)}</ul></details></> : !summary.isPending && <p>No legacy import has been recorded for this tenant.</p>}
    </div>
    <div className="toolbar" style={{ marginTop: 16 }}>
        <RowsPerPage value={pageSize} onChange={setPageSize} />
      <select aria-label="Legacy record status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="">All statuses</option><option>REVIEW</option><option>IMPORTED</option><option>ARCHIVED</option></select>
      <select aria-label="Legacy source table" value={sourceTable} onChange={(e) => { setTable(e.target.value); setPage(1); }}><option value="">All source tables</option>{[...new Set(summary.data?.groups.map((group) => group.sourceTable))].sort().map((table) => <option key={table}>{table}</option>)}</select>
      <input aria-label="Search legacy ID or reason" placeholder="Search old ID / review reason" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
      {canApprove && <IconButton icon="check" label="Approve all held invoices" onClick={() => { setBulk(true); setNote(""); setReviewError(""); }} />}
      <span>{records.data?.total ?? 0} records</span>
    </div>
    {records.isError && <div className="error">{errMessage(records.error)}</div>}
    <table><thead><tr><th>Source table</th><th>Old ID</th><th>Status</th><th>Mapping / reason</th><th /></tr></thead><tbody>{records.data?.items.map((row) => <tr key={row.id}><td>{row.sourceTable}</td><td>{row.sourceId}</td><td><span className={`badge ${row.status === "REVIEW" ? "warn" : "ok"}`}>{row.status}</span></td><td>{row.targetModel && <div>{row.targetModel}</div>}{row.reason}{row.approval?.approved && <div className="badge ok" title={row.approval.note}>Approved — pending import</div>}</td><td><IconButton onClick={() => setDetail(row.id)} icon="view" label="View original">View original</IconButton>{canApprove && row.status === "REVIEW" && ["user_bills", "user_purchase_bills"].includes(row.sourceTable) && <IconButton icon={row.approval?.approved ? "close" : "check"} label={row.approval?.approved ? "Withdraw approval" : "Approve review"} onClick={() => { setReviewRow(row); setNote(""); setReviewError(""); }} />}{canPost && row.status === "REVIEW" && ["user_bills","user_purchase_bills"].includes(row.sourceTable) && row.approval?.approved && <button onClick={() => setReconcileId(row.id)}>Reconcile and post</button>}</td></tr>)}</tbody></table>
    <div className="actions"><button disabled={page === 1} onClick={() => setPage(page - 1)}>Previous</button><span>Page {page}</span><button disabled={!records.data || page * records.data.limit >= records.data.total} onClick={() => setPage(page + 1)}>Next</button></div>
    {reconcileId && <LegacyReconcile id={reconcileId} close={() => setReconcileId("")} />}
    {(reviewRow || bulk) && <div className="modal-overlay"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="legacy-approval-title"><h3 id="legacy-approval-title">{reviewRow?.approval?.approved ? "Withdraw approval" : "Approve legacy review"}</h3><p>{bulk ? "Approve all held sales and purchase invoices for this tenant, across all pages and filters. Existing approvals are retained." : `${reviewRow?.sourceTable} · Old ID ${reviewRow?.sourceId}`}</p><p>{reviewRow?.reason}</p><p>This saves your review decision. It does not import the invoice, post receipts, or change balances.</p><label htmlFor="legacy-review-note">Reconciliation note (required)</label><textarea id="legacy-review-note" autoFocus rows={5} maxLength={2000} value={note} onChange={(event) => setNote(event.target.value)} placeholder="Record verified invoice total, receipts, balance, and the confirmed treatment of any TDS/write-off or discrepancy." />{reviewError && <div className="error" role="alert">{reviewError}</div>}<div className="actions"><button disabled={busy} onClick={() => { setReviewRow(null); setBulk(false); }}>Cancel</button><button className="primary" disabled={busy || note.trim().length < 10} onClick={() => void saveApproval()}>{busy ? "Saving…" : reviewRow?.approval?.approved ? "Withdraw approval" : bulk ? "Approve all held invoices" : "Approve review"}</button></div></div></div>}
    {detailId && <div className="modal-overlay"><div className="modal" role="dialog" aria-modal="true" aria-labelledby="legacy-detail-title" style={{ maxWidth: 900, width: "95%" }}><h3 id="legacy-detail-title">Original legacy record</h3>{detail.isPending && <p>Loading…</p>}{detail.isError && <div className="error">{errMessage(detail.error)}</div>}{detail.data && <><p>{detail.data.sourceTable} · ID {detail.data.sourceId} · {detail.data.status}</p><p>{detail.data.reason}</p><pre style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: "50vh", overflow: "auto", fontSize: 12 }}>{JSON.stringify(detail.data.data, null, 2)}</pre></>}<div className="actions"><button onClick={() => setDetail(null)}>Close</button></div></div></div>}
  </>;
}
