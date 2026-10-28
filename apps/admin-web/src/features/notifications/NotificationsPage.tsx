import { IconButton } from "../../components/IconButton";
import { RowsPerPage, usePageSize, ListTable } from "../../components/ListPagination";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";

interface Template {
  id: string; code: string; channel: string; subject?: string; body: string; isActive: boolean;
}
interface LogRow {
  id: string; channel: string; to: string; templateCode?: string; subject?: string;
  status: string; attempts: number; error?: string; sentAt?: string; createdAt: string;
}

export function NotificationsPage() {
  const [tab, setTab] = useState<"templates" | "logs">("templates");
  return (
    <>
      <h2 className="page-title">Notifications</h2>
      <div className="toolbar">
        <button className={tab === "templates" ? "primary" : ""} onClick={() => setTab("templates")}>Templates</button>
        <button className={tab === "logs" ? "primary" : ""} onClick={() => setTab("logs")}>Send log</button>
      </div>
      {tab === "templates" ? <TemplatesTab /> : <LogsTab />}
    </>
  );
}

function TemplatesTab() {
  const qc = useQueryClient();
  const canEdit = useAuth((s) => s.hasPerm("notification_template:update"));
  const [edit, setEdit] = useState<Template | null>(null);
  const [error, setError] = useState("");

  const templates = useQuery({
    queryKey: ["ntemplates"],
    queryFn: async () => (await api.get("/notification-templates")).data as Template[],
  });

  const save = useMutation({
    mutationFn: async () => {
      await api.put(`/notification-templates/${edit!.id}`, {
        subject: edit!.subject || undefined, body: edit!.body, isActive: edit!.isActive,
      });
    },
    onSuccess: () => { setEdit(null); setError(""); qc.invalidateQueries({ queryKey: ["ntemplates"] }); },
    onError: (err) => setError(errMessage(err)),
  });

  return (
    <>
      <p style={{ color: "var(--muted)", marginBottom: 12 }}>
        Variables like <code>{"{{customerName}}"}</code>, <code>{"{{invoiceNumber}}"}</code>, <code>{"{{amount}}"}</code>,{" "}
        <code>{"{{dueDate}}"}</code>, <code>{"{{receiptNumber}}"}</code> are replaced at send time.
      </p>
      <ListTable>
        <thead><tr><th>Event</th><th>Channel</th><th>Subject</th><th>Active</th><th /></tr></thead>
        <tbody>
          {templates.data?.map((t) => (
            <tr key={t.id}>
              <td><code>{t.code}</code></td>
              <td><span className="badge">{t.channel}</span></td>
              <td style={{ maxWidth: 320, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.subject ?? "—"}</td>
              <td><span className={`badge ${t.isActive ? "ok" : "warn"}`}>{t.isActive ? "yes" : "no"}</span></td>
              <td>{canEdit && <IconButton className="small" onClick={() => { setEdit({ ...t }); setError(""); }} icon="edit" label="Edit">Edit</IconButton>}</td>
            </tr>
          ))}
        </tbody>
      </ListTable>

      {edit && (
        <div className="modal-overlay" onClick={() => setEdit(null)}>
          <div className="modal" style={{ width: 640 }} onClick={(e) => e.stopPropagation()}>
            <h3>{edit.code} · {edit.channel}</h3>
            {edit.channel === "EMAIL" && (
              <>
                <label>Subject</label>
                <input value={edit.subject ?? ""} onChange={(e) => setEdit({ ...edit, subject: e.target.value })} />
              </>
            )}
            <label>Body</label>
            <textarea rows={10} style={{ width: "100%", font: "inherit", padding: 8, border: "1px solid var(--border)", borderRadius: 8 }}
              value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} />
            <label>Active</label>
            <select value={edit.isActive ? "yes" : "no"} onChange={(e) => setEdit({ ...edit, isActive: e.target.value === "yes" })}>
              <option>yes</option><option>no</option>
            </select>
            {error && <div className="error">{error}</div>}
            <div className="actions">
              <button onClick={() => setEdit(null)}>Cancel</button>
              <button className="primary" disabled={save.isPending || !edit.body} onClick={() => save.mutate()}>
                {save.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function LogsTab() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize(() => setPage(1));
  const [status, setStatus] = useState("");

  const logs = useQuery({
    queryKey: ["nlogs", page, status, pageSize],
    queryFn: async () => (await api.get("/notification-logs", {
      params: { page, limit: pageSize, status: status || undefined },
    })).data as { items: LogRow[]; total: number; limit: number },
    refetchInterval: 10_000,
  });

  return (
    <>
      <div className="toolbar">
        <RowsPerPage value={pageSize} onChange={setPageSize} />
        <select style={{ width: 140 }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All status</option><option>SENT</option><option>FAILED</option><option>QUEUED</option>
        </select>
      </div>
      <table>
        <thead><tr><th>Time</th><th>Channel</th><th>To</th><th>Template</th><th>Status</th><th>Error</th></tr></thead>
        <tbody>
          {logs.data?.items.map((l) => (
            <tr key={l.id}>
              <td>{new Date(l.createdAt).toLocaleString()}</td>
              <td><span className="badge">{l.channel}</span></td>
              <td>{l.to}</td>
              <td><code>{l.templateCode ?? "—"}</code></td>
              <td><span className={`badge ${l.status === "SENT" ? "ok" : l.status === "FAILED" ? "warn" : ""}`}>{l.status}</span></td>
              <td style={{ maxWidth: 280, fontSize: 12, color: "var(--danger)" }}>{l.error ?? ""}</td>
            </tr>
          ))}
          {logs.data && logs.data.items.length === 0 && (
            <tr><td colSpan={6} style={{ color: "var(--muted)" }}>No notifications yet — create an invoice or record a payment.</td></tr>
          )}
        </tbody>
      </table>
      {logs.data && (
        <div className="pagination">
          <button className="small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <span>Page {page} of {Math.max(1, Math.ceil(logs.data.total / logs.data.limit))}</span>
          <button className="small" disabled={page * logs.data.limit >= logs.data.total} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}
    </>
  );
}
