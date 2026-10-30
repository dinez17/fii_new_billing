import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";

const templates = [
  { id: "COMMERCIAL", name: "Commercial", detail: "Clean address cards and teal accents. Current format.", color: "#117C78" },
  { id: "TALLY", name: "Tally-style", detail: "Boxed voucher form, invoice details grid and dedicated HSN column.", color: "#222222" },
  { id: "CLASSIC", name: "Classic", detail: "Centered letterhead, serif typography and an open recipient layout.", color: "#8D6939" },
  { id: "MODERN", name: "Modern", detail: "Company sidebar, stacked address panels and large invoice heading.", color: "#236FC1" },
  { id: "MINIMAL", name: "Minimal", detail: "Large invoice title, stacked addresses and a separate details column.", color: "#555555" },
  { id: "COMPACT", name: "Compact Ledger", detail: "Horizontal party records, dedicated HSN column and dense ledger rows.", color: "#32684B" },
  { id: "TELECOM_STATEMENT", name: "Telecom Statement", detail: "Reference 1: company banner, office and invoice grid, buyer / installation panels and boxed totals.", color: "#222222" },
  { id: "SERVICE_TAX", name: "Service Tax Summary", detail: "Reference 2: boxed service invoice with an HSN-wise GST breakdown and customer signature area.", color: "#444444" },
  { id: "IT_SERVICES", name: "IT Services", detail: "Reference 3: letterhead, invoice details, service table and bank panel. Paid stamp for paid invoices.", color: "#666666" },
];

const previewUrl = (id: string) => `/invoice-templates/${id.toLowerCase()}.png?v=20261030-forms2`;

function Thumbnail({ id }: { id: string; color: string }) {
  return <img src={previewUrl(id)} alt={`${id.toLowerCase()} invoice layout preview`} style={{ height: 240, width: "100%", objectFit: "contain", display: "block", background: "#eef1f4", borderRadius: 4 }} />;
}

export function InvoiceTemplatesTab() {
  const canEdit = useAuth(s => s.hasPerm("settings:update"));
  const qc = useQueryClient();
  const [selected, setSelected] = useState("COMMERCIAL");
  const [saved, setSaved] = useState(false);
  const settings = useQuery({ queryKey: ["invoice-format"], queryFn: async () => (await api.get("/settings/group/INVOICE")).data as { template?: string } });
  useEffect(() => { if (settings.data) setSelected(settings.data.template ?? "COMMERCIAL"); }, [settings.data]);
  const save = useMutation({
    mutationFn: () => api.put("/settings/group/INVOICE", { template: selected }),
    onSuccess: () => { setSaved(true); void qc.invalidateQueries({ queryKey: ["invoice-format"] }); },
  });
  return <div className="card">
    <h3 style={{ marginTop: 0 }}>Default invoice format</h3>
    <p style={{ color: "var(--muted)" }}>Choose the layout for your GST and without-GST invoice downloads and email attachments. This applies when a PDF is generated, including existing invoices; saved amounts and invoice numbers stay the same.</p>
    {settings.isPending && <p>Loading invoice format…</p>}
    {settings.isError && <div className="error">{errMessage(settings.error)}</div>}
    <fieldset disabled={!canEdit || settings.isPending || settings.isError || save.isPending} style={{ border: 0, padding: 0, margin: "18px 0", display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
      <legend className="sr-only">Invoice templates</legend>
      {templates.map(t => <label key={t.id} style={{ margin: 0, border: `2px solid ${selected === t.id ? t.color : "var(--border)"}`, borderRadius: 10, padding: 12, cursor: canEdit ? "pointer" : "default", background: selected === t.id ? "#f5f8fb" : "white", color: "#18334d" }}>
        <Thumbnail id={t.id} color={t.color} />
        <a href={previewUrl(t.id)} target="_blank" rel="noreferrer" style={{ display: "block", textAlign: "center", fontSize: 12, marginTop: 6 }}>View full preview</a>
        <span style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}><input type="radio" name="invoice-template" value={t.id} checked={selected === t.id} onChange={() => { setSelected(t.id); setSaved(false); }} style={{ width: "auto", margin: 0 }} /><strong>{t.name}</strong></span>
        <span style={{ display: "block", fontSize: 13, fontWeight: 400, lineHeight: 1.5, marginTop: 6 }}>{t.detail}</span>
        {settings.data?.template === t.id || (!settings.data?.template && t.id === "COMMERCIAL") ? <span style={{ display: "block", fontSize: 12, color: t.color, marginTop: 6 }}>Saved default</span> : null}
      </label>)}
    </fieldset>
    {save.isError && <div className="error">{errMessage(save.error)}</div>}
    {saved && <div className="success-banner" role="status">Default invoice format saved.</div>}
    {canEdit && <button className="primary" disabled={save.isPending || settings.isPending || settings.isError} onClick={() => save.mutate()}>{save.isPending ? "Saving…" : "Save as default"}</button>}
  </div>;
}
