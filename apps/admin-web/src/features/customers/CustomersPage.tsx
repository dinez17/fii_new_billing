import { formatDate } from "../../lib/date";
import { RowsPerPage, usePageSize, ListTable } from "../../components/ListPagination";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";
import { BulkImport } from "../../components/BulkImport";
import { CustomerKycPanel, downloadCustomerCaf } from "./CustomerKycPanel";
import { PartyListFilters, DEFAULT_CUSTOMER_FILTERS } from "../../components/PartyListFilters";
import { ActionIcon, IconButton } from "../../components/IconButton";
import { CustomerAddress } from "../../components/CustomerAddress";

interface CustomerRow {
  additionalEmails?: string[]; stateName?: string; installationCity?: string; installationState?: string; installationStateCode?: string; installationPincode?: string;
  id: string; code: string; name: string; phone: string | null; email?: string;
  gstin?: string; gstTreatment: string; city?: string; stateCode?: string;
  isActive: boolean; portalEnabled: boolean;
  currentOutstanding: string; heldInvoiceCount: number; invoiceCount: number;
  _count: { subscribers: number };
  portalUser?: { id: string; status: string } | null;
  billingAddress?: string; serviceAddress?: string; pincode?: string; openingBalance?: string;
}

interface FormState {
  additionalEmails: string; stateName: string; installationCity: string; installationState: string; installationStateCode: string; installationPincode: string;
  id?: string; name: string; phone: string; email: string; gstin: string;
  gstTreatment: string; billingAddress: string; serviceAddress: string; city: string; stateCode: string;
  pincode: string; openingBalance: string;
}

const EMPTY: FormState = {
  additionalEmails: "", stateName: "", installationCity: "", installationState: "", installationStateCode: "", installationPincode: "",
  name: "", phone: "", email: "", gstin: "", gstTreatment: "B2C",
  billingAddress: "", serviceAddress: "", city: "", stateCode: "", pincode: "", openingBalance: "0",
};

interface LedgerEntry {
  id: string; entryDate: string; entryType: string; refNumber?: string;
  debit: string; credit: string; narration?: string; balance: string;
}
interface LedgerData {
  customer: { name: string; code: string };
  openingBalance: string; entries: LedgerEntry[]; outstanding: string;
}

export function CustomersPage() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPerm);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize(() => setPage(1));
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState(DEFAULT_CUSTOMER_FILTERS);
  const [form, setForm] = useState<FormState | null>(null);
  const [copyInstallation, setCopyInstallation] = useState(false);
  const [ledgerFor, setLedgerFor] = useState<CustomerRow | null>(null);
  const [error, setError] = useState("");
  const [cafFor, setCafFor] = useState("");
  const [portalFor, setPortalFor] = useState<CustomerRow | null>(null);
  const [portalPassword, setPortalPassword] = useState(""), [portalConfirm, setPortalConfirm] = useState("");
  const [portalError, setPortalError] = useState(""), [portalBusy, setPortalBusy] = useState(false), [showPortalPassword, setShowPortalPassword] = useState(false);

  const ledger = useQuery({
    queryKey: ["ledger", ledgerFor?.id],
    queryFn: async () => (await api.get(`/customers/${ledgerFor!.id}/ledger`)).data as LedgerData,
    enabled: !!ledgerFor,
  });

  const customers = useQuery({
    queryKey: ["customers", page, search, filters, pageSize],
    queryFn: async () => (await api.get("/customers", { params: { page, limit: pageSize, search: search || undefined, ...filters } })).data as
      { items: CustomerRow[]; total: number; limit: number },
  });

  const save = useMutation({
    mutationFn: async (f: FormState) => {
      const body = {
        additionalEmails: f.additionalEmails.split(/[,;\n]/).map((email) => email.trim()).filter(Boolean),
        stateName: f.stateName, installationCity: f.installationCity, installationState: f.installationState,
        installationStateCode: f.installationStateCode, installationPincode: f.installationPincode,
        name: f.name, phone: f.phone, email: f.email,
        gstin: f.gstin, gstTreatment: f.gstTreatment,
        billingAddress: f.billingAddress || undefined, serviceAddress: f.serviceAddress || undefined, city: f.city || undefined,
        stateCode: f.stateCode || undefined, pincode: f.pincode || undefined,
        openingBalance: Number(f.openingBalance || 0),
      };
      return f.id ? (await api.put(`/customers/${f.id}`, body)).data : (await api.post("/customers", body)).data;
    },
    onSuccess: (data, f) => { setForm(!f.id && hasPerm("customer:update") ? { ...f, id: data.id } : null); setError(""); qc.invalidateQueries({ queryKey: ["customers"] }); },
    onError: (err) => setError(errMessage(err)),
  });

  async function togglePortal(c: CustomerRow) {
    if (c.portalEnabled) {
      if (!confirm(`Disable portal access for ${c.name}?`)) return;
      try { await api.post(`/customers/${c.id}/portal-access`, { enable: false }); } catch (error) { alert(errMessage(error)); return; }
    } else {
      setPortalFor(c); setPortalPassword(""); setPortalConfirm(""); setPortalError(""); setShowPortalPassword(false); return;
    }
    qc.invalidateQueries({ queryKey: ["customers"] });
  }

  return (
    <>
      {portalFor && <div className="modal-overlay"><form className="modal" role="dialog" aria-modal="true" aria-label="Enable customer portal" onSubmit={async event => {
        event.preventDefault(); setPortalError("");
        if (portalPassword !== portalConfirm) { setPortalError("Passwords do not match"); return; }
        if (portalPassword.length < 8 || new TextEncoder().encode(portalPassword).length > 72) { setPortalError("Use at least 8 characters and at most 72 UTF-8 bytes"); return; }
        setPortalBusy(true);
        try { await api.post(`/customers/${portalFor.id}/portal-access`, { enable: true, password: portalPassword }); setPortalPassword(""); setPortalConfirm(""); setPortalFor(null); await qc.invalidateQueries({ queryKey: ["customers"] }); }
        catch (error) { setPortalError(errMessage(error)); } finally { setPortalBusy(false); }
      }}>
        <h3>Enable portal access</h3><p>{portalFor.name}</p>
        <label>Portal login email<input value={portalFor.email || ""} readOnly aria-label="Portal login email" /></label>
        {!portalFor.email && <p className="error">Edit the customer and save a primary email before enabling the portal.</p>}
        {!portalFor.isActive && <p className="error">Reactivate this customer before enabling portal access.</p>}
        <label>Portal password<input type={showPortalPassword ? "text" : "password"} aria-label="Portal password" autoComplete="new-password" autoFocus required minLength={8} maxLength={72} value={portalPassword} onChange={e => { setPortalPassword(e.target.value); setPortalError(""); }} /></label>
        <label>Confirm portal password<input type={showPortalPassword ? "text" : "password"} aria-label="Confirm portal password" autoComplete="new-password" required minLength={8} maxLength={72} value={portalConfirm} onChange={e => { setPortalConfirm(e.target.value); setPortalError(""); }} /></label>
        <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input style={{ width: "auto" }} type="checkbox" checked={showPortalPassword} onChange={e => setShowPortalPassword(e.target.checked)} /> Show password</label>
        <p className="document-help">{portalFor.portalUser ? "Re-enabling access replaces the previous password and revokes saved portal sign-ins." : "The customer signs in using this primary email and the password you choose."}</p>
        {portalError && <div className="error" role="alert">{portalError}</div>}
        <div className="actions"><button type="button" disabled={portalBusy} onClick={() => { setPortalFor(null); setPortalPassword(""); setPortalConfirm(""); }}>Cancel</button><button className="primary" disabled={portalBusy || !portalFor.email || !portalFor.isActive}>{portalBusy ? "Enabling…" : "Set password & enable"}</button></div>
      </form></div>}
      <h2 className="page-title">Customers</h2>
      {error && !form && <div className="error">{error}</div>}
      <div className="toolbar">
        <RowsPerPage value={pageSize} onChange={setPageSize} />
        <input style={{ width: 280 }} placeholder="Search name / phone / code…" value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <div className="spacer" />
        {hasPerm("customer:create") && <BulkImport kind="customers" />}
        {hasPerm("customer:create") && (
          <button className="primary" onClick={() => { setCopyInstallation(false); setForm(EMPTY); setError(""); }}>+ New Customer</button>
        )}
      </div>

      <div className="toolbar" style={{ flexWrap: "wrap" }}>
        <PartyListFilters customer value={filters} onChange={(value) => { setFilters(value); setPage(1); }} />
      </div>
      {customers.isError && <div className="error">{errMessage(customers.error)}</div>}
      <table>
        <thead>
          <tr><th>Code</th><th>Name</th><th>Status</th><th>Phone</th><th>GST</th><th title="Invoices with a remaining balance; paid and cancelled invoices excluded">Due invoices</th><th style={{ textAlign: "right" }}>Balance to pay</th><th>Subs</th><th>Portal</th><th /></tr>
        </thead>
        <tbody>
          {customers.data?.items.map((c) => (
            <tr key={c.id}>
              <td><code>{c.code}</code></td>
              <td>{c.name}</td>
              <td><span className={`badge ${c.isActive ? "ok" : "warn"}`}>{c.isActive ? "Active" : "Inactive"}</span></td>
              <td title={c.phone ?? "Not provided"}>{c.phone ?? "—"}</td>
              <td>{c.gstin ? <span title={c.gstin} className="badge">{c.gstTreatment}</span> : c.gstTreatment}</td>
              <td>{c.invoiceCount}</td>
              <td style={{ textAlign: "right" }}>
                <span title="Remaining invoice amounts after payments and credit notes">₹{Number(c.currentOutstanding ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
                {c.heldInvoiceCount > 0 && <span className="held-warning" role="img" aria-label={`${c.heldInvoiceCount} legacy invoices held; balance incomplete`} title={`${c.heldInvoiceCount} legacy invoices and related receipts held for correction; excluded from this balance. Review Settings → Legacy import.`}><ActionIcon name="warning" /></span>}
              </td>
              <td>{c._count.subscribers}</td>
              <td>
                <span className={`badge ${c.portalEnabled ? "ok" : ""}`}>{c.portalEnabled ? "enabled" : "off"}</span>
              </td>
              <td style={{ whiteSpace: "nowrap" }}>
                {hasPerm("customer:update") && (
                  <>
                    <IconButton className="small" onClick={() => { setCopyInstallation(false); setForm({
                      additionalEmails: (c.additionalEmails ?? []).join(", "), stateName: c.stateName ?? "", installationCity: c.installationCity ?? "", installationState: c.installationState ?? "", installationStateCode: c.installationStateCode ?? "", installationPincode: c.installationPincode ?? "",
                      id: c.id, name: c.name, phone: c.phone ?? "", email: c.email ?? "",
                      gstin: c.gstin ?? "", gstTreatment: c.gstTreatment,
                      billingAddress: c.billingAddress ?? "", serviceAddress: c.serviceAddress ?? "", city: c.city ?? "",
                      stateCode: c.stateCode ?? "", pincode: c.pincode ?? "",
                      openingBalance: String(c.openingBalance ?? 0),
                    }); }} icon="edit" label="Edit">Edit</IconButton>{" "}
                    <IconButton className="small" disabled={!!cafFor} onClick={async () => { setCafFor(c.id); setError(""); try { await downloadCustomerCaf(c.id); } catch (e) { setError(errMessage(e)); } finally { setCafFor(""); } }} icon="download" label={cafFor === c.id ? "Generating…" : "CAF PDF"}>{cafFor === c.id ? "Generating…" : "CAF PDF"}</IconButton>{" "}
                    <IconButton className="small" onClick={() => void togglePortal(c)} icon={c.portalEnabled ? "lock" : "unlock"} label={c.portalEnabled ? "Disable portal" : "Enable portal"}>
                      {c.portalEnabled ? "Disable portal" : "Enable portal"}
                    </IconButton>
                  </>
                )}{" "}
                {hasPerm("ledger:read") && (
                  <IconButton className="small" onClick={() => setLedgerFor(c)} icon="ledger" label="Ledger">Ledger</IconButton>
                )}
              </td>
            </tr>
          ))}
          {customers.data && customers.data.items.length === 0 && (
            <tr><td colSpan={10} style={{ color: "var(--muted)" }}>No customers match these filters.</td></tr>
          )}
        </tbody>
      </table>

      {customers.data && (
        <div className="pagination">
          <button className="small" disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
          <span>Page {page} of {Math.max(1, Math.ceil(customers.data.total / customers.data.limit))}</span>
          <button className="small" disabled={page * customers.data.limit >= customers.data.total} onClick={() => setPage(page + 1)}>Next</button>
        </div>
      )}

      {ledgerFor && (
        <div className="modal-overlay" onClick={() => setLedgerFor(null)}>
          <div className="modal" style={{ width: 720 }} onClick={(e) => e.stopPropagation()}>
            <h3>Ledger — {ledgerFor.name} <code style={{ fontSize: 13 }}>{ledgerFor.code}</code></h3>
            {ledger.data && (
              <>
                <p style={{ color: "var(--muted)" }}>
                  Opening balance ₹{Number(ledger.data.openingBalance).toFixed(2)} ·{" "}
                  <strong style={{ color: Number(ledger.data.outstanding) > 0 ? "var(--danger)" : "var(--ok)" }}>
                    Outstanding ₹{Number(ledger.data.outstanding).toFixed(2)}
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
                    {ledger.data.entries.length === 0 && (
                      <tr><td colSpan={6} style={{ color: "var(--muted)" }}>No ledger entries yet.</td></tr>
                    )}
                  </tbody>
                </ListTable>
              </>
            )}
            <div className="actions">
              <button className="primary" onClick={() => setLedgerFor(null)}>Close</button>
            </div>
          </div>
        </div>
      )}

      {form && (
        <div className="modal-overlay entry-fullpage-overlay" onClick={() => setForm(null)}>
          <div className="modal" style={{ width: 760 }} onClick={(e) => e.stopPropagation()}>
            <h3>{form.id ? `Edit customer` : "New customer"}</h3>
            <label>Name *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <label>Phone (if available)</label>
            <input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            <label>Primary Email (needed for portal access)</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
            <label>Additional emails for invoices and receipts (comma separated)</label>
            <input value={form.additionalEmails} onChange={(e) => setForm({ ...form, additionalEmails: e.target.value })} />
            <small>Invoices and receipts go to the primary and additional emails. Only the primary email is used for portal access.</small>
            <label>GST Treatment</label>
            <select value={form.gstTreatment} onChange={(e) => setForm({ ...form, gstTreatment: e.target.value })}>
              <option>B2C</option><option>B2B</option><option>EXPORT</option><option>SEZ</option><option>NIL</option>
            </select>
                <label>GSTIN {form.gstTreatment === "B2B" ? "*" : "(optional)"}</label>
                <input value={form.gstin} onChange={(e) => setForm({ ...form, gstin: e.target.value.toUpperCase() })} />
            <CustomerAddress key={`billing-${form.id ?? "new"}`} title="Billing" value={{ address: form.billingAddress, city: form.city, state: form.stateName, stateCode: form.stateCode, pincode: form.pincode }} onChange={(value) => setForm((old) => old ? { ...old, billingAddress: value.address, city: value.city, stateName: value.state, stateCode: value.stateCode, pincode: value.pincode, ...(copyInstallation ? { serviceAddress: value.address, installationCity: value.city, installationState: value.state, installationStateCode: value.stateCode, installationPincode: value.pincode } : {}) } : old)} />
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}><input type="checkbox" style={{ width: "auto" }} checked={copyInstallation} onChange={(e) => {
              const checked = e.target.checked; setCopyInstallation(checked);
              if (checked) setForm({ ...form, serviceAddress: form.billingAddress, installationCity: form.city, installationState: form.stateName, installationStateCode: form.stateCode, installationPincode: form.pincode });
            }} />Installation address same as billing address</label>
            {copyInstallation ? <p style={{ fontSize: 12 }}>Installation: {[form.serviceAddress, form.installationCity, form.installationState, form.installationPincode].filter(Boolean).join(", ") || "Enter the billing address above."}</p> : <CustomerAddress key={`installation-${form.id ?? "new"}`} title="Installation" value={{ address: form.serviceAddress, city: form.installationCity, state: form.installationState, stateCode: form.installationStateCode, pincode: form.installationPincode }} onChange={(value) => setForm((old) => old ? { ...old, serviceAddress: value.address, installationCity: value.city, installationState: value.state, installationStateCode: value.stateCode, installationPincode: value.pincode } : old)} />}
            <label>Opening balance (₹, +ve = customer owes you)</label>
            <input type="number" value={form.openingBalance} onChange={(e) => setForm({ ...form, openingBalance: e.target.value })} />
            {form.id && hasPerm("customer:update") ? <CustomerKycPanel key={form.id} customerId={form.id} /> : <p style={{ color: "var(--muted)", fontSize: 12 }}>Save the customer first to add a photo, ID proof and GST certificate. A CAF PDF can then be generated automatically from the saved data.</p>}
            {error && <div className="error">{error}</div>}
            <div className="actions">
              <button onClick={() => setForm(null)}>Cancel</button>
              <button className="primary" disabled={save.isPending || !form.name}
                onClick={() => save.mutate(form)}>{save.isPending ? "Saving…" : "Save"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
