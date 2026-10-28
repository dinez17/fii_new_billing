import { RowsPerPage, usePageSize } from "../../components/ListPagination";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api";

interface AuditRow {
  id: string; action: string; entity?: string; entityId?: string;
  ip?: string; createdAt: string;
  user?: { name: string; email: string };
}

export function AuditPage() {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize(() => setPage(1));
  const [action, setAction] = useState("");
  const [entity, setEntity] = useState("");

  const logs = useQuery({
    queryKey: ["audit", page, action, entity, pageSize],
    queryFn: async () => (await api.get("/audit-logs", {
      params: { page, limit: pageSize, action: action || undefined, entity: entity || undefined },
    })).data as { items: AuditRow[]; total: number; limit: number },
  });

  return (
    <>
      <h2 className="page-title">Audit Logs</h2>
      <div className="toolbar">
        <RowsPerPage value={pageSize} onChange={setPageSize} />
        <input style={{ width: 200 }} placeholder="Filter action (e.g. LOGIN)" value={action}
          onChange={(e) => { setAction(e.target.value.toUpperCase()); setPage(1); }} />
        <input style={{ width: 200 }} placeholder="Filter entity (e.g. User)" value={entity}
          onChange={(e) => { setEntity(e.target.value); setPage(1); }} />
      </div>
      <table>
        <thead><tr><th>Time</th><th>User</th><th>Action</th><th>Entity</th><th>IP</th></tr></thead>
        <tbody>
          {logs.data?.items.map((l) => (
            <tr key={l.id}>
              <td>{new Date(l.createdAt).toLocaleString()}</td>
              <td>{l.user ? `${l.user.name} (${l.user.email})` : "—"}</td>
              <td><span className="badge">{l.action}</span></td>
              <td>{l.entity ? `${l.entity}${l.entityId ? ` · ${l.entityId.slice(0, 8)}…` : ""}` : "—"}</td>
              <td>{l.ip ?? "—"}</td>
            </tr>
          ))}
          {logs.data && logs.data.items.length === 0 && (
            <tr><td colSpan={5} style={{ color: "var(--muted)" }}>No audit entries.</td></tr>
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
