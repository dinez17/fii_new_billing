import { useState } from "react";
import axios from "axios";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";
import { formatDate } from "../../lib/date";

interface Preview { tenantId: string; companyName: string; createdAt: string; counts: Record<string, number>; sha256: string }
async function readErr(e: unknown): Promise<string> {
  if (axios.isAxiosError(e) && e.response?.data instanceof Blob) {
    try { return JSON.parse(await e.response.data.text())?.error?.message ?? "Backup failed"; } catch { /* use standard error */ }
  }
  return errMessage(e);
}
export function BackupPage() {
  const hasPerm = useAuth((s) => s.hasPerm);
  const cache = useQueryClient();
  const [busy, setBusy] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  const status = useQuery({ queryKey: ["backup-status"], queryFn: async () => (await api.get("/backup")).data as { available: boolean; tenant: { id: string; name: string }; recoveries: { id: string; createdAt: string }[] }, enabled: hasPerm("backup:read") });
  async function download(path = "/backup/download") {
    setBusy("backup"); setErr(""); setMsg("");
    try {
      const res = await api.get(path, { responseType: "blob", timeout: 0 });
      const name = (res.headers["content-disposition"] as string | undefined)?.match(/filename="?([^";]+)"?/)?.[1] ?? "tenant-backup.fiibak";
      const url = URL.createObjectURL(res.data as Blob);
      const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMsg(`Backup downloaded: ${name}`);
    } catch (e) { setErr(await readErr(e)); } finally { setBusy(""); }
  }
  async function inspect() {
    if (!file) return;
    setBusy("inspect"); setErr(""); setMsg(""); setPreview(null); setConfirmText("");
    try {
      setPreview((await api.post("/backup/inspect", await file.arrayBuffer(), { headers: { "Content-Type": "application/octet-stream" }, timeout: 0 })).data as Preview);
    } catch (e) { setErr(errMessage(e)); } finally { setBusy(""); }
  }
  async function restore() {
    if (!file || !preview || confirmText !== "RESTORE") return;
    if (!confirm(`Replace the business data of ${status.data?.tenant.name} with this backup? A recovery copy will be saved automatically.`)) return;
    setBusy("restore"); setErr(""); setMsg("");
    try {
      await api.post("/backup/restore", await file.arrayBuffer(), { headers: { "Content-Type": "application/octet-stream", "X-Backup-Confirmation": preview.sha256, "X-Restore-Confirm": "RESTORE" }, timeout: 0 });
      setMsg("Tenant data restored. A copy of the data before this restore is available below.");
      setPreview(null); setConfirmText("");
      await cache.invalidateQueries();
    } catch (e) { setErr(errMessage(e)); } finally { setBusy(""); }
  }
  const disabled = busy !== "" || !status.data?.available;
  return <>
    <h2 className="page-title">Tenant Backup & Restore</h2>
    <p>{status.data?.tenant.name}</p>
    {status.isError && <div className="error">{errMessage(status.error)}</div>}
    {status.data && !status.data.available && <div className="error">Backup encryption is not configured on the server. Contact the platform administrator.</div>}
    <div className="card">
      <h3>Download your tenant backup</h3>
      <p>Includes your company profile, customers and KYC documents, subscribers, products, sales, receipts, purchases, accounts, HR, helpdesk and settings across all financial years. Other tenants’ records are excluded.</p>
      <p>Login accounts, passwords, roles, license, audit history and running jobs stay on the server. External file links are retained; files stored outside the database are not bundled. Keep this encrypted file safe; it can be restored only to this tenant on this installation with the original encryption key.</p>
      {hasPerm("backup:export") && <button className="primary" disabled={disabled} onClick={() => void download()}>{busy === "backup" ? "Preparing…" : "Download backup"}</button>}
    </div>
    {hasPerm("backup:update") && <div className="card">
      <h3>Restore your tenant data</h3>
      <p>Restoring replaces this tenant’s business records with the selected backup. Your current login accounts, license and audit history remain. An encrypted recovery copy is saved automatically before any changes. Finish billing, payments and reports before restoring.</p>
      <input type="file" accept=".fiibak,application/octet-stream" disabled={busy !== ""} onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); setConfirmText(""); setErr(""); }} />
      <button disabled={disabled || !file} onClick={() => void inspect()}>{busy === "inspect" ? "Checking…" : "Check backup"}</button>
      {preview && <div style={{ marginTop: 16 }}>
        <p><strong>{preview.companyName}</strong> · Backup date: {formatDate(preview.createdAt)}</p>
        <p>{Object.entries(preview.counts).filter(([, count]) => count > 0).map(([name, count]) => `${name}: ${count}`).join(" · ")}</p>
        <label>Type RESTORE to replace this tenant’s business data</label>
        <input style={{ maxWidth: 200 }} value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="RESTORE" autoComplete="off" />
        <button className="danger" disabled={disabled || confirmText !== "RESTORE"} onClick={() => void restore()}>{busy === "restore" ? "Restoring…" : "Restore tenant data"}</button>
      </div>}
    </div>}
    {hasPerm("backup:export") && !!status.data?.recoveries.length && <div className="card"><h3>Copies saved before restores</h3>{status.data.recoveries.map((r) => <p key={r.id}>{formatDate(r.createdAt)} <button disabled={disabled} onClick={() => void download(`/backup/recovery/${r.id}`)}>Download recovery backup</button></p>)}</div>}
    {msg && <div role="status" className="card">{msg}</div>}
    {err && <div role="alert" className="error">{err}</div>}
  </>;
}
