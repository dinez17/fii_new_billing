import { IconButton } from "../../components/IconButton";
import { ListTable } from "../../components/ListPagination";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";

interface RoleRow {
  id: string; code: string; name: string; isSystem: boolean;
  _count: { users: number; permissions: number };
}
interface Permission { id: string; module: string; action: string }

const ACTIONS = ["create", "read", "update", "delete", "export", "approve"];

export function RolesPage() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPerm);
  const [selected, setSelected] = useState<RoleRow | null>(null);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState(false);
  const [newRole, setNewRole] = useState({ code: "", name: "" });
  const [error, setError] = useState("");

  const roles = useQuery({
    queryKey: ["roles"],
    queryFn: async () => (await api.get("/roles")).data as RoleRow[],
  });
  const perms = useQuery({
    queryKey: ["permissions"],
    queryFn: async () => (await api.get("/roles/permissions")).data as Permission[],
  });

  const modules = useMemo(() => {
    const m = new Map<string, Map<string, string>>(); // module → action → permId
    for (const p of perms.data ?? []) {
      if (!m.has(p.module)) m.set(p.module, new Map());
      m.get(p.module)!.set(p.action, p.id);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [perms.data]);

  async function selectRole(r: RoleRow) {
    setError("");
    try {
      const { data } = await api.get(`/roles/${r.id}`);
      setChecked(new Set<string>(data.permissionIds));
      setSelected(r);
    } catch (err) {
      alert(errMessage(err));
    }
  }

  const saveMatrix = useMutation({
    mutationFn: async () => {
      await api.put(`/roles/${selected!.id}/permissions`, { permissionIds: [...checked] });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["roles"] }); setSelected(null); },
    onError: (err) => setError(errMessage(err)),
  });

  const createRole = useMutation({
    mutationFn: async () => {
      await api.post("/roles", { code: newRole.code, name: newRole.name, permissionIds: [] });
    },
    onSuccess: () => { setCreating(false); setNewRole({ code: "", name: "" }); qc.invalidateQueries({ queryKey: ["roles"] }); },
    onError: (err) => setError(errMessage(err)),
  });

  function toggle(permId: string) {
    const next = new Set(checked);
    if (next.has(permId)) next.delete(permId); else next.add(permId);
    setChecked(next);
  }

  function toggleModule(actionIds: Map<string, string>) {
    const ids = [...actionIds.values()];
    const all = ids.every((id) => checked.has(id));
    const next = new Set(checked);
    for (const id of ids) { if (all) next.delete(id); else next.add(id); }
    setChecked(next);
  }

  return (
    <>
      <h2 className="page-title">Roles & Permissions</h2>
      <div className="toolbar">
        <div className="spacer" />
        {hasPerm("role:create") && (
          <button className="primary" onClick={() => { setCreating(true); setError(""); }}>+ New Role</button>
        )}
      </div>

      <ListTable>
        <thead><tr><th>Role</th><th>Code</th><th>Type</th><th>Users</th><th>Permissions</th><th /></tr></thead>
        <tbody>
          {roles.data?.map((r) => (
            <tr key={r.id}>
              <td>{r.name}</td>
              <td><code>{r.code}</code></td>
              <td><span className={`badge ${r.isSystem ? "" : "ok"}`}>{r.isSystem ? "System" : "Custom"}</span></td>
              <td>{r._count.users}</td>
              <td>{r._count.permissions}</td>
              <td>
                {!r.isSystem && hasPerm("role:update") && (
                  <IconButton className="small" onClick={() => void selectRole(r)} icon="edit" label="Edit permissions">Edit permissions</IconButton>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </ListTable>

      {selected && (
        <div className="modal-overlay" onClick={() => setSelected(null)}>
          <div className="modal" style={{ width: 760 }} onClick={(e) => e.stopPropagation()}>
            <h3>Permissions — {selected.name}</h3>
            <p style={{ color: "var(--muted)", marginBottom: 10 }}>
              Tick the module/action cells this role should have. Click a module name to toggle its whole row.
            </p>
            <div className="perm-grid">
              <div className="head">Module</div>
              {ACTIONS.map((a) => <div key={a} className="head" style={{ textAlign: "center" }}>{a}</div>)}
              {modules.map(([mod, actionIds]) => (
                <>
                  <div key={mod} className="mod" style={{ cursor: "pointer" }} onClick={() => toggleModule(actionIds)}>{mod}</div>
                  {ACTIONS.map((a) => {
                    const id = actionIds.get(a);
                    return (
                      <div key={`${mod}:${a}`} className="cell">
                        {id ? <input type="checkbox" checked={checked.has(id)} onChange={() => toggle(id)} /> : "—"}
                      </div>
                    );
                  })}
                </>
              ))}
            </div>
            {error && <div className="error">{error}</div>}
            <div className="actions">
              <button onClick={() => setSelected(null)}>Cancel</button>
              <button className="primary" disabled={saveMatrix.isPending} onClick={() => saveMatrix.mutate()}>
                {saveMatrix.isPending ? "Saving…" : `Save (${checked.size} permissions)`}
              </button>
            </div>
          </div>
        </div>
      )}

      {creating && (
        <div className="modal-overlay" onClick={() => setCreating(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>New role</h3>
            <label>Code (UPPER_SNAKE_CASE)</label>
            <input value={newRole.code} onChange={(e) => setNewRole({ ...newRole, code: e.target.value.toUpperCase() })} placeholder="FIELD_SUPERVISOR" />
            <label>Name</label>
            <input value={newRole.name} onChange={(e) => setNewRole({ ...newRole, name: e.target.value })} placeholder="Field Supervisor" />
            {error && <div className="error">{error}</div>}
            <div className="actions">
              <button onClick={() => setCreating(false)}>Cancel</button>
              <button className="primary" disabled={createRole.isPending || !newRole.code || !newRole.name}
                onClick={() => createRole.mutate()}>Create</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
