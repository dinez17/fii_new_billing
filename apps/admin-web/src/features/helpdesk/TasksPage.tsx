import { formatDate } from "../../lib/date";
import { IconButton } from "../../components/IconButton";
import { RowsPerPage, usePageSize } from "../../components/ListPagination";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";

interface EmployeeLite { id: string; name: string }
interface TaskRow {
  id: string; title: string; description?: string; priority: string; status: string;
  dueDate?: string; completedAt?: string;
  assignedTo?: { id: string; name: string } | null;
  complaint?: { complaintNumber: string } | null;
  _count: { comments: number };
}
interface Comment { id: string; comment: string; createdAt: string }

export function TasksPage() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPerm);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize(() => setPage(1));
  const [status, setStatus] = useState("");
  const [assignee, setAssignee] = useState("");
  const [creating, setCreating] = useState(false);
  const [commentsFor, setCommentsFor] = useState<TaskRow | null>(null);
  const [newComment, setNewComment] = useState("");
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    title: "", description: "", priority: "MEDIUM", assignedToId: "", dueDate: "",
  });

  const employees = useQuery({
    queryKey: ["employees-active"],
    queryFn: async () => (await api.get("/employees", { params: { active: true, limit: 200 } })).data.items as EmployeeLite[],
  });

  const list = useQuery({
    queryKey: ["tasks", page, status, assignee, pageSize],
    queryFn: async () => (await api.get("/tasks", {
      params: { page, limit: pageSize, status: status || undefined, assignedToId: assignee || undefined },
    })).data as { items: TaskRow[]; total: number; limit: number },
  });

  const comments = useQuery({
    queryKey: ["task-comments", commentsFor?.id],
    queryFn: async () => (await api.get(`/tasks/${commentsFor!.id}/comments`)).data as Comment[],
    enabled: !!commentsFor,
  });

  const create = useMutation({
    mutationFn: async () => {
      await api.post("/tasks", {
        title: form.title, description: form.description || undefined,
        priority: form.priority, assignedToId: form.assignedToId || undefined,
        dueDate: form.dueDate || undefined,
      });
    },
    onSuccess: () => {
      setCreating(false); setError("");
      setForm({ title: "", description: "", priority: "MEDIUM", assignedToId: "", dueDate: "" });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (err) => setError(errMessage(err)),
  });

  const addComment = useMutation({
    mutationFn: async () => { await api.post(`/tasks/${commentsFor!.id}/comments`, { comment: newComment }); },
    onSuccess: () => {
      setNewComment("");
      qc.invalidateQueries({ queryKey: ["task-comments", commentsFor?.id] });
      qc.invalidateQueries({ queryKey: ["tasks"] });
    },
    onError: (err) => alert(errMessage(err)),
  });

  async function act(t: TaskRow, action: "start" | "complete" | "cancel") {
    try { await api.post(`/tasks/${t.id}/${action}`); qc.invalidateQueries({ queryKey: ["tasks"] }); }
    catch (err) { alert(errMessage(err)); }
  }

  const badge = (s: string) => (
    <span className={`badge ${s === "COMPLETED" ? "ok" : s === "CANCELLED" ? "warn" : ""}`}>{s.replace(/_/g, " ")}</span>
  );

  return (
    <>
      <h2 className="page-title">Tasks</h2>
      <div className="toolbar">
        <RowsPerPage value={pageSize} onChange={setPageSize} />
        <select style={{ width: 150 }} value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All status</option>
          <option>PENDING</option><option>IN_PROGRESS</option><option>COMPLETED</option><option>CANCELLED</option>
        </select>
        <select style={{ width: 170 }} value={assignee} onChange={(e) => { setAssignee(e.target.value); setPage(1); }}>
          <option value="">All employees</option>
          {employees.data?.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
        </select>
        <div className="spacer" />
        {hasPerm("task:create") && (
          <button className="primary" onClick={() => { setCreating(true); setError(""); }}>+ New Task</button>
        )}
      </div>

      <table>
        <thead>
          <tr><th>Task</th><th>Complaint</th><th>Priority</th><th>Assigned</th><th>Due</th><th>Status</th><th /></tr>
        </thead>
        <tbody>
          {list.data?.items.map((t) => (
            <tr key={t.id}>
              <td>{t.title}{t._count.comments > 0 && <span style={{ color: "var(--muted)", fontSize: 12 }}> 💬{t._count.comments}</span>}</td>
              <td>{t.complaint ? <code>{t.complaint.complaintNumber}</code> : "—"}</td>
              <td><span className={`badge ${["HIGH", "URGENT"].includes(t.priority) ? "warn" : ""}`}>{t.priority}</span></td>
              <td>{t.assignedTo?.name ?? "—"}</td>
              <td style={{ color: t.dueDate && new Date(t.dueDate) < new Date() && !["COMPLETED", "CANCELLED"].includes(t.status) ? "var(--danger)" : undefined }}>
                {t.dueDate ? formatDate(t.dueDate) : "—"}
              </td>
              <td>{badge(t.status)}</td>
              <td style={{ whiteSpace: "nowrap" }}>
                <IconButton className="small" onClick={() => setCommentsFor(t)} icon="more" label="Comments">Comments</IconButton>{" "}
                {hasPerm("task:update") && !["COMPLETED", "CANCELLED"].includes(t.status) && (
                  <>
                    {t.status === "PENDING" && <IconButton className="small" onClick={() => void act(t, "start")} icon="more" label="Start">Start</IconButton>}{" "}
                    <IconButton className="small primary" onClick={() => void act(t, "complete")} icon="more" label="Done">Done</IconButton>{" "}
                    <IconButton className="small danger" onClick={() => void act(t, "cancel")} icon="more" label="✕">✕</IconButton>
                  </>
                )}
              </td>
            </tr>
          ))}
          {list.data?.items.length === 0 && (
            <tr><td colSpan={7} style={{ color: "var(--muted)" }}>No tasks found.</td></tr>
          )}
        </tbody>
      </table>

      {list.data && (
        <div className="pagination">
          <button className="small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <span>Page {page} of {Math.max(1, Math.ceil(list.data.total / list.data.limit))}</span>
          <button className="small" disabled={page * list.data.limit >= list.data.total} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}

      {creating && (
        <div className="modal-overlay" onClick={() => setCreating(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>New task</h3>
            <label>Title *</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <label>Description</label>
            <textarea rows={3} style={{ width: "100%", font: "inherit", padding: 8, border: "1px solid var(--border)", borderRadius: 8 }}
              value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div>
                <label>Priority</label>
                <select value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  <option>LOW</option><option>MEDIUM</option><option>HIGH</option><option>URGENT</option>
                </select>
              </div>
              <div>
                <label>Assign to</label>
                <select value={form.assignedToId} onChange={(e) => setForm({ ...form, assignedToId: e.target.value })}>
                  <option value="">— later —</option>
                  {employees.data?.map((emp) => <option key={emp.id} value={emp.id}>{emp.name}</option>)}
                </select>
              </div>
              <div><label>Due date</label>
                <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></div>
            </div>
            {error && <div className="error">{error}</div>}
            <div className="actions">
              <button onClick={() => setCreating(false)}>Cancel</button>
              <button className="primary" disabled={create.isPending || form.title.length < 3}
                onClick={() => create.mutate()}>{create.isPending ? "Creating…" : "Create"}</button>
            </div>
          </div>
        </div>
      )}

      {commentsFor && (
        <div className="modal-overlay" onClick={() => setCommentsFor(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>Comments — {commentsFor.title}</h3>
            <div style={{ maxHeight: 280, overflowY: "auto" }}>
              {comments.data?.map((c) => (
                <div key={c.id} style={{ borderBottom: "1px solid var(--border)", padding: "8px 0" }}>
                  <div style={{ fontSize: 12, color: "var(--muted)" }}>{new Date(c.createdAt).toLocaleString()}</div>
                  {c.comment}
                </div>
              ))}
              {comments.data?.length === 0 && <p style={{ color: "var(--muted)" }}>No comments yet.</p>}
            </div>
            {hasPerm("task:update") && (
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                <input placeholder="Add a comment…" value={newComment} onChange={(e) => setNewComment(e.target.value)}
                  data-enter-native
                  onKeyDown={(e) => { if (e.key === "Enter" && newComment.trim()) { e.preventDefault(); addComment.mutate(); } }} />
                <button className="primary" disabled={addComment.isPending || !newComment.trim()}
                  onClick={() => addComment.mutate()}>Post</button>
              </div>
            )}
            <div className="actions"><button onClick={() => setCommentsFor(null)}>Close</button></div>
          </div>
        </div>
      )}
    </>
  );
}
