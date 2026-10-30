import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";

const companyFields = [
  ["name", "Company / business name", 120], ["legalName", "Legal name", 200],
  ["addressLine1", "Address line 1", 200], ["addressLine2", "Address line 2", 200],
  ["city", "City", 80], ["stateCode", "State code", 2], ["pincode", "Pincode", 6],
  ["phone", "Phone", 15], ["email", "Contact email", 200], ["pan", "PAN (optional)", 10],
] as const;
const bankFields = [
  ["bankName", "Bank name", 120], ["bankBranch", "Branch", 120],
  ["bankAccountNo", "Account number", 30], ["bankIfsc", "IFSC", 11],
  ["bankPayableAt", "Payable to / account name", 120],
] as const;

export function NonGstCompanyTab() {
  const canEdit = useAuth(s => s.hasPerm("settings:update"));
  const qc = useQueryClient();
  const [form, setForm] = useState<Record<string, string>>({ enabled: "false" });
  const [saved, setSaved] = useState(false), [error, setError] = useState("");
  const settings = useQuery({ queryKey: ["non-gst-company"], queryFn: async () => (await api.get("/settings/group/NON_GST_COMPANY")).data as Record<string, string> });
  useEffect(() => { if (settings.data) setForm({ enabled: "false", ...settings.data }); }, [settings.data]);
  const change = (key: string, value: string) => { setForm(f => ({ ...f, [key]: value })); setSaved(false); };
  const save = useMutation({
    mutationFn: () => api.put("/settings/group/NON_GST_COMPANY", form),
    onSuccess: () => { setError(""); setSaved(true); void qc.invalidateQueries({ queryKey: ["non-gst-company"] }); },
    onError: e => setError(errMessage(e)),
  });
  const disabled = !canEdit || settings.isPending || settings.isError || save.isPending;
  const field = ([key, label, maxLength]: readonly [string, string, number]) => <label key={key} style={{ margin: 0 }}>
    {label}{key === "name" && form.enabled === "true" ? " *" : ""}
    <input value={form[key] ?? ""} maxLength={maxLength} type={key === "email" ? "email" : "text"}
      required={key === "name" && form.enabled === "true"} inputMode={key === "stateCode" || key === "pincode" ? "numeric" : undefined}
      onChange={e => change(key, key === "pan" || key === "bankIfsc" ? e.target.value.toUpperCase() : e.target.value)} />
  </label>;
  async function upload(key: string, file?: File) {
    if (!file) return;
    if (!["image/png", "image/jpeg"].includes(file.type) || file.size > 280_000) { setError("Use a PNG or JPEG under 280 KB."); return; }
    const reader = new FileReader();
    reader.onload = () => { change(key, String(reader.result)); setError(""); };
    reader.onerror = () => setError("Unable to read image. Please select it again.");
    reader.readAsDataURL(file);
  }
  return <form className="card" style={{ maxWidth: 1000 }} onSubmit={e => { e.preventDefault(); save.mutate(); }}>
    <h3 style={{ marginTop: 0 }}>Without-GST company & bank details</h3>
    <p style={{ color: "var(--muted)" }}>Use a separate business identity and bank account for without-GST invoice PDFs, email attachments, related notes and receipts allocated entirely to without-GST invoices.</p>
    {settings.isPending && <p>Loading profile…</p>}
    {settings.isError && <div className="error">{errMessage(settings.error)}</div>}
    <fieldset disabled={disabled} style={{ padding: 0, border: 0, margin: 0 }}>
      <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <input type="checkbox" checked={form.enabled === "true"} onChange={e => change("enabled", e.target.checked ? "true" : "false")} style={{ width: "auto" }} />
        Enable separate without-GST company profile
      </label>
      <p style={{ color: "var(--muted)", fontSize: 13 }}>When enabled, blank fields stay blank and will not reuse the GST company's details or bank account. GSTIN is omitted from this company profile. Changes apply when PDFs are generated, including existing invoices.</p>
      <h4>Company details</h4>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>{companyFields.map(field)}</div>
      <h4>Separate bank account</h4>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12 }}>{bankFields.map(field)}</div>
      <h4>Branding (optional)</h4>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 16 }}>
        {[["logoUrl", "Company logo"], ["signatureUrl", "Authorised signature"]].map(([key, label]) => <div key={key}>
          <label>{label} — PNG/JPEG, max 280 KB<input type="file" accept="image/png,image/jpeg" onChange={e => void upload(key, e.target.files?.[0])} /></label>
          {form[key] && <div style={{ display: "flex", gap: 12, alignItems: "center" }}><img src={form[key]} alt={label} style={{ width: 110, height: 65, objectFit: "contain" }} /><button type="button" onClick={() => change(key, "")}>Remove</button></div>}
        </div>)}
      </div>
      {canEdit && <button className="primary" style={{ marginTop: 18 }} disabled={save.isPending}>{save.isPending ? "Saving…" : "Save without-GST profile"}</button>}
    </fieldset>
    {error && <div className="error" role="alert">{error}</div>}
    {saved && <div className="success-banner" role="status">Without-GST company profile saved.</div>}
  </form>;
}
