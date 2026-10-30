import { formatDate } from "../../lib/date";
import { ActionIcon, IconButton } from "../../components/IconButton";
import { RowsPerPage, usePageSize, ListTable } from "../../components/ListPagination";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";
import { PartyListFilters, DEFAULT_PARTY_FILTERS } from "../../components/PartyListFilters";

interface SupplierRow {
  id: string; code: string; name: string; gstin?: string; phone?: string; email?: string;
  stateCode?: string; address?: string; openingBalance?: string; isActive: boolean;
  invoiceCount: number; currentOutstanding: string; heldInvoiceCount: number;
  _count: { purchaseInvoices: number };
}
interface LedgerEntry {
  id: string; entryDate: string; entryType: string; refNumber?: string;
  debit: string; credit: string; balance: string;
}
interface LedgerData { openingBalance: string; entries: LedgerEntry[]; outstanding: string }

interface FormState {
  id?: string; name: string; gstin: string; phone: string; email: string;
  address: string; stateCode: string; openingBalance: string;
}
const EMPTY: FormState = { name: "", gstin: "", phone: "", email: "", address: "", stateCode: "", openingBalance: "0" };

export function SuppliersPage() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPerm);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize(() => setPage(1));
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(DEFAULT_PARTY_FILTERS);
  const [form, setForm] = useState<FormState | null>(null);
  const [ledgerFor, setLedgerFor] = useState<SupplierRow | null>(null);
  const [error, setError] = useState("");

  const suppliers = useQuery({
    queryKey: ["suppliers", page, search, filters, pageSize],
    queryFn: async () => (await api.get("/suppliers", { params: { page, limit: pageSize, search: search || undefined, ...filters } })).data as
      { items: SupplierRow[]; total: number; limit: number },
  });

  const ledger = useQuery({
    queryKey: ["supplier-ledger", ledgerFor?.id],
    queryFn: async () => (await api.get(`/suppliers/${ledgerFor!.id}/ledger`)).data as LedgerData,
    enabled: !!ledgerFor,
  });

  const save = useMutation({
    mutationFn: async (f: FormState) => {
      const body = {
        name: f.name, gstin: f.gstin || undefined, phone: f.phone || undefined,
        email: f.email || undefined, address: f.address || undefined,
        stateCode: f.stateCode || undefined, openingBalance: Number(f.openingBalance || 0),
      };
      if (f.id) await api.put(`/suppliers/${f.id}`, body);
      else await api.post("/suppliers", body);
    },
    onSuccess: () => { setForm(null); setError(""); qc.invalidateQueries({ queryKey: ["suppliers"] }); },
    onError: (err) => setError(errMessage(err)),
  });

  return (
    <>
      <h2 className="page-title">Suppliers</h2>
      <div className="toolbar">
        <RowsPerPage value={pageSize} onChange={setPageSize} />
        <input style={{ width: 260 }} placeholder="Search name / phone / code…" value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <div className="spacer" />
        {hasPerm("supplier:create") && (
          <button className="primary" onClick={() => { setForm(EMPTY); setError(""); }}>+ New Supplier</button>
        )}
      </div>

      <div className="toolbar" style={{ flexWrap: "wrap" }}>
        <PartyListFilters value={filters} onChange={(value) => { setFilters(value); setPage(1); }} />
      </div>
      {suppliers.isError && <div className="error">{errMessage(suppliers.error)}</div>}
      <table>
        <thead><tr><th>Code</th><th>Name</th><th>Status</th><th>GSTIN</th><th>Phone</th><th>Invoices</th><th style={{ textAlign: "right" }}>Current payable</th><th /></tr></thead>
        <tbody>
          {suppliers.data?.items.map((s) => (
            <tr key={s.id}>
              <td><code>{s.code}</code></td>
              <td>{s.name}</td>
              <td><span className={`badge ${s.isActive ? "ok" : "warn"}`}>{s.isActive ? "Active" : "Inactive"}</span></td>
              <td>{s.gstin ?? "—"}</td>
              <td>{s.phone ?? "—"}</td>
              <td>{s.invoiceCount}</td>
              <td style={{ textAlign: "right" }}>₹{Number(s.currentOutstanding ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                {Number(s.currentOutstanding) < 0 && <div>Credit balance</div>}
                {s.heldInvoiceCount > 0 && <span className="held-warning" role="img" aria-label={`${s.heldInvoiceCount} legacy purchases held; balance incomplete`} title={`${s.heldInvoiceCount} legacy purchases and related payments held for correction; excluded from posted payable.`}><ActionIcon name="warning" /></span>}
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                {hasPerm("supplier:update") && (
                  <IconButton className="small" onClick={() => setForm({
                    id: s.id, name: s.name, gstin: s.gstin ?? "", phone: s.phone ?? "",
                    email: s.email ?? "", address: s.address ?? "", stateCode: s.stateCode ?? "",
                    openingBalance: String(s.openingBalance ?? 0),
                  })} icon="edit" label="Edit">Edit</IconButton>
                )}{" "}
                {hasPerm("ledger:read") && <IconButton className="small" onClick={() => setLedgerFor(s)} icon="ledger" label="Ledger">Ledger</IconButton>}
              </td>
            </tr>
          ))}
          {suppliers.data?.items.length === 0 && (
            <tr><td colSpan={8} style={{ color: "var(--muted)" }}>No suppliers match these filters.</td></tr>
          )}
        </tbody>
      </table>

      {suppliers.data && (
        <div className="pagination">
          <button className="small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <span>Page {page} of {Math.max(1, Math.ceil(suppliers.data.total / suppliers.data.limit))}</span>
          <button className="small" disabled={page * suppliers.data.limit >= suppliers.data.total} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}

      {form && (
        <div className="modal-overlay entry-fullpage-overlay" onClick={() => setForm(null)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>{form.id ? "Edit supplier" : "New supplier"}</h3>
            <label>Name *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr", gap: 8 }}>
              <div><label>GSTIN</label>
                <input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} /></div>
              <div><label>State code</label>
                <input placeholder="33" value={form.stateCode} onChange={(e) => setForm({ ...form, stateCode: e.target.value })} /></div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div><label>Phone</label><input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
              <div><label>Email</label><input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
            </div>
            <label>Address</label>
            <input value={form.address} onChange={(e) => setForm({ ...form, address: e.target.value })} />
            <label>Opening balance ₹ (+ve = you owe supplier)</label>
            <input type="number" value={form.openingBalance} onChange={(e) => setForm({ ...form, openingBalance: e.target.value })} />
            {error && <div className="error">{error}</div>}
            <div className="actions">
              <button onClick={() => setForm(null)}>Cancel</button>
              <button className="primary" disabled={save.isPending || !form.name} onClick={() => save.mutate(form)}>
                {save.isPending ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {ledgerFor && (
        <div className="modal-overlay entry-fullpage-overlay" onClick={() => setLedgerFor(null)}>
          <div className="modal" style={{ width: 720 }} onClick={(e) => e.stopPropagation()}>
            <h3>Supplier ledger — {ledgerFor.name}</h3>
            {ledger.data && (
              <>
                <p style={{ color: "var(--muted)" }}>
                  Opening ₹{Number(ledger.data.openingBalance).toFixed(2)} ·{" "}
                  <strong style={{ color: Number(ledger.data.outstanding) > 0 ? "var(--danger)" : "var(--ok)" }}>
                    Payable ₹{Number(ledger.data.outstanding).toFixed(2)}
                  </strong>
                </p>
                <ListTable style={{ fontSize: 13 }}>
                  <thead><tr><th>Date</th><th>Type</th><th>Ref</th><th style={{ textAlign: "right" }}>Debit</th><th style={{ textAlign: "right" }}>Credit</th><th style={{ textAlign: "right" }}>Balance</th></tr></thead>
                  <tbody>
                    {ledger.data.entries.map((e) => (
                      <tr key={e.id}>
                        <td>{formatDate(e.entryDate)}</td>
                        <td><span className="badge">{e.entryType.replace(/_/g, " ")}</span></td>
                        <td><code>{e.refNumber ?? "—"}</code></td>
                        <td style={{ textAlign: "right" }}>{Number(e.debit) > 0 ? Number(e.debit).toFixed(2) : ""}</td>
                        <td style={{ textAlign: "right" }}>{Number(e.credit) > 0 ? Number(e.credit).toFixed(2) : ""}</td>
                        <td style={{ textAlign: "right" }}>{Number(e.balance).toFixed(2)}</td>
                      </tr>
                    ))}
                    {ledger.data.entries.length === 0 && <tr><td colSpan={6} style={{ color: "var(--muted)" }}>No entries yet.</td></tr>}
                  </tbody>
                </ListTable>
              </>
            )}
            <div className="actions"><button className="primary" onClick={() => setLedgerFor(null)}>Close</button></div>
          </div>
        </div>
      )}
    </>
  );
}
