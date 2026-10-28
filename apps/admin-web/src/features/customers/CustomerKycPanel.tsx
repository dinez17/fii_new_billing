import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";

type Kind = "PHOTO" | "ID_FRONT" | "ID_BACK" | "GST_CERTIFICATE";
interface DocumentInfo { kind: Kind; fileName: string; mimeType: string; sizeBytes: number; updatedAt: string }
interface Kyc { idProofType: string | null; idProofNumberMasked: string; documents: DocumentInfo[] }
const labels: Record<Kind, string> = { PHOTO: "Customer photo", ID_FRONT: "ID proof - front", ID_BACK: "ID proof - back", GST_CERTIFICATE: "GST certificate" };

function download(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export async function downloadCustomerCaf(customerId: string) {
  const { data } = await api.get(`/customers/${customerId}/caf`, { responseType: "blob" });
  download(data, `CAF-${customerId}.pdf`);
}

export function CustomerKycPanel({ customerId }: { customerId: string }) {
  const qc = useQueryClient();
  const [type, setType] = useState("");
  const [number, setNumber] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [photoUrl, setPhotoUrl] = useState("");
  const kyc = useQuery({ queryKey: ["customer-kyc", customerId], queryFn: async () => (await api.get<Kyc>(`/customers/${customerId}/kyc`)).data });
  useEffect(() => { if (kyc.data) setType(kyc.data.idProofType ?? ""); }, [kyc.data]);
  const photoVersion = kyc.data?.documents.find((document) => document.kind === "PHOTO")?.updatedAt;
  useEffect(() => {
    if (!photoVersion) { setPhotoUrl(""); return; }
    const controller = new AbortController(); let objectUrl = ""; let active = true;
    void api.get(`/customers/${customerId}/documents/PHOTO`, { responseType: "blob", signal: controller.signal }).then(({ data }) => {
      if (!active) return; objectUrl = URL.createObjectURL(data); setPhotoUrl(objectUrl);
    }).catch((e) => { if (!controller.signal.aborted) setError(errMessage(e)); });
    return () => { active = false; controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [customerId, photoVersion]);

  const saveId = useMutation({
    mutationFn: async () => api.put(`/customers/${customerId}/kyc`, { idProofType: type || null, ...(number.trim() ? { idProofNumber: number.trim() } : {}) }),
    onSuccess: () => { setNumber(""); setError(""); setMessage("ID-proof details saved. CAF now uses these details."); void qc.invalidateQueries({ queryKey: ["customer-kyc", customerId] }); },
    onError: (e) => setError(errMessage(e)),
  });
  const upload = useMutation({
    mutationFn: async ({ kind, file }: { kind: Kind; file: File }) => {
      const max = kind === "PHOTO" ? 500 * 1024 : 1024 * 1024;
      if (file.size > max) throw new Error(kind === "PHOTO" ? "Photo must be 500 KB or smaller" : "Document must be 1 MB or smaller");
      const dataUrl = await new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => resolve(String(reader.result)); reader.onerror = () => reject(new Error("Cannot read file")); reader.readAsDataURL(file); });
      return api.post(`/customers/${customerId}/documents/${kind}`, { fileName: file.name, dataUrl });
    },
    onSuccess: () => { setError(""); setMessage("Document saved. Upload another file to replace it."); void qc.invalidateQueries({ queryKey: ["customer-kyc", customerId] }); },
    onError: (e) => setError(errMessage(e)),
  });
  const caf = useMutation({ mutationFn: () => downloadCustomerCaf(customerId), onError: (e) => setError(errMessage(e)) });
  async function getDocument(document: DocumentInfo) {
    try { download((await api.get(`/customers/${customerId}/documents/${document.kind}`, { responseType: "blob" })).data, document.fileName); }
    catch (e) { setError(errMessage(e)); }
  }
  const busy = upload.isPending || saveId.isPending || caf.isPending;
  return <section style={{ borderTop: "1px solid var(--border)", marginTop: 24, paddingTop: 16 }}>
    <h3>Photo, ID proof & CAF</h3>
    <p style={{ color: "var(--muted)", fontSize: 12 }}>Documents and ID details save separately. Save changes to the customer profile before downloading its CAF.</p>
    {kyc.isPending && <p>Loading customer documents…</p>}
    {kyc.isError && <div className="error">{errMessage(kyc.error)}</div>}
    {kyc.data && <>
      {photoUrl && <img src={photoUrl} alt="Customer photo" style={{ width: 90, height: 110, objectFit: "contain", border: "1px solid var(--border)", borderRadius: 6 }} />}
      <label htmlFor="customer-proof-type">ID-proof type</label>
      <select id="customer-proof-type" value={type} disabled={busy} onChange={(e) => setType(e.target.value)}>
        <option value="">Not selected</option><option value="AADHAAR">Aadhaar</option><option value="PAN">PAN</option><option value="PASSPORT">Passport</option><option value="DRIVING_LICENCE">Driving licence</option><option value="VOTER_ID">Voter ID</option><option value="OTHER">Other</option>
      </select>
      <label htmlFor="customer-proof-number">ID-proof number {kyc.data.idProofNumberMasked && `(saved: ${kyc.data.idProofNumberMasked})`}</label>
      <input id="customer-proof-number" maxLength={80} autoComplete="off" value={number} placeholder="Enter a new number; leave blank to keep the saved number" disabled={busy} onChange={(e) => setNumber(e.target.value)} />
      <p style={{ color: "var(--muted)", fontSize: 12 }}>ID numbers and file contents are encrypted. The CAF shows only the last four characters of the ID number.</p>
      <button type="button" disabled={busy} onClick={() => saveId.mutate()}>{saveId.isPending ? "Saving…" : "Save ID details"}</button>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 12, marginTop: 12 }}>
        {(Object.keys(labels) as Kind[]).map((kind) => {
          const document = kyc.data.documents.find((entry) => entry.kind === kind);
          return <div key={kind} style={{ border: "1px solid var(--border)", padding: 10, borderRadius: 8 }}>
            <label>{labels[kind]}<input type="file" accept={kind === "PHOTO" ? "image/png,image/jpeg" : "image/png,image/jpeg,application/pdf"} disabled={busy} onChange={(e) => { const file = e.target.files?.[0]; if (file) { setMessage(""); setError(""); upload.mutate({ kind, file }); } e.target.value = ""; }} /></label>
            <small>{kind === "PHOTO" ? "PNG / JPEG, up to 500 KB" : "PNG / JPEG / PDF, up to 1 MB"}</small>
            {document && <div style={{ marginTop: 6, overflowWrap: "anywhere" }}><span>{document.fileName}</span> <button type="button" className="small" disabled={busy} onClick={() => void getDocument(document)}>Download</button></div>}
          </div>;
        })}
      </div>
      {upload.isPending && <p role="status">Uploading document…</p>}
      <button type="button" style={{ marginTop: 14 }} disabled={busy} onClick={() => caf.mutate()}>{caf.isPending ? "Generating…" : "Download CAF PDF"}</button>
    </>}
    {message && <p role="status" style={{ color: "var(--ok)" }}>{message}</p>}
    {error && <div className="error" role="alert">{error}</div>}
  </section>;
}
