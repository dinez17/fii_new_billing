import { IconButton } from "../../components/IconButton";
import { useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { EntitySelect, type ProductOption } from "../../components/EntitySelect";
import { ProductSelect } from "../../components/ProductSelect";
import { useAuth } from "../../stores/auth";

interface CustomerLite { id: string; name: string; phone: string; stateCode?: string; gstTreatment?: string }
interface Item { productId: string; description: string; hsnSac: string; quantity: string; unitPrice: string; discount: string; gstRate: string }

const EMPTY_ITEM: Item = { productId: "", description: "", hsnSac: "", quantity: "1", unitPrice: "", discount: "0", gstRate: "18" };
const inr = (v: number) => `₹${v.toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

// client-side preview only — the server computes the authoritative GST split
function preview(items: Item[]) {
  let sub = 0, disc = 0, taxable = 0, gst = 0;
  for (const it of items) {
    const gross = Number(it.quantity || 0) * Number(it.unitPrice || 0);
    const d = Number(it.discount || 0);
    sub += gross; disc += d;
    const base = gross - d;
    taxable += base;
    gst += (base * Number(it.gstRate || 0)) / 100;
  }
  return { sub, disc, taxable, gst, total: Math.round(taxable + gst) };
}

interface EditableInvoice {
  chargeGst: boolean;
  id: string; invoiceNumber: string; status: string; amountPaid: string; customerId: string; subscriberId?: string | null;
  invoiceDate: string; dueDate: string; notes?: string | null; terms?: string | null; poNumber?: string | null;
  customer: CustomerLite; subscriber?: { id: string; code: string; poNumber?: string | null; chargeGst?: boolean } | null;
  items: Array<Omit<Item, "productId" | "hsnSac"> & { productId?: string | null; hsnSac?: string | null }>;
}
export function NewInvoicePage() {
  const location = useLocation();
  const { id } = useParams();
  const invoice = useQuery({ queryKey: ["invoice-edit", id], enabled: !!id, queryFn: async () => (await api.get(`/invoices/${id}`)).data as EditableInvoice });
  if (id && invoice.isError) return <div className="error">{errMessage(invoice.error)}</div>;
  if (id && !invoice.data) return <p>Loading invoice…</p>;
  if (invoice.data && (invoice.data.status !== "UNPAID" || Number(invoice.data.amountPaid) > 0)) return <div className="error">Only unpaid invoices with no payments can be edited.</div>;
  return <InvoiceEditor key={id ?? "new"} invoice={invoice.data} defaultChargeGst={location.state?.chargeGst !== false} />;
}
function InvoiceEditor({ invoice, defaultChargeGst }: { invoice?: EditableInvoice; defaultChargeGst: boolean }) {
  const [chargeGst, setChargeGst] = useState(invoice?.chargeGst ?? defaultChargeGst);
  const navigate = useNavigate();
  const canReadSubscribers = useAuth((state) => state.hasPerm("subscriber:read"));
  const [subscriberCode, setSubscriberCode] = useState(invoice?.subscriber?.code ?? "");
  const [poNumber, setPoNumber] = useState<string | null>(invoice ? invoice.poNumber ?? "" : null);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    customerId: invoice?.customerId ?? "",
    invoiceDate: invoice?.invoiceDate.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    dueDate: invoice?.dueDate.slice(0, 10) ?? new Date(Date.now() + 10 * 86400000).toISOString().slice(0, 10),
    notes: invoice?.notes ?? "", terms: invoice?.terms ?? "",
    items: invoice?.items.map((it) => ({ ...it, productId: it.productId ?? "", hsnSac: it.hsnSac ?? "" })) ?? [{ ...EMPTY_ITEM }] as Item[],
  });

  const [selectedCustomer, setSelectedCustomer] = useState<CustomerLite | undefined>(invoice?.customer);
  const subscriberOptions = useQuery({
    queryKey: ["invoice-subscribers", form.customerId, subscriberCode],
    enabled: canReadSubscribers && !!form.customerId,
    queryFn: async () => (await api.get("/subscribers", { params: { customerId: form.customerId, search: subscriberCode || undefined, limit: 50 } })).data as { items: { id: string; code: string; poNumber: string | null; chargeGst: boolean }[] },
  });
  const selectedSubscriber = subscriberOptions.data?.items.find((subscriber) => subscriber.code === subscriberCode) ?? (invoice?.customerId === form.customerId && invoice.subscriber?.code === subscriberCode ? invoice.subscriber : undefined);
  const noGst = invoice ? !invoice.chargeGst : selectedSubscriber ? selectedSubscriber.chargeGst === false : !chargeGst;
  const effectiveItems = noGst ? form.items.map((item) => ({ ...item, gstRate: "0" })) : form.items;
  const [productDetails, setProductDetails] = useState<Record<string, ProductOption>>({});

  const create = useMutation({
    mutationFn: async () => {
      const body = {
        chargeGst: !noGst,
        customerId: form.customerId,
        subscriberId: selectedSubscriber?.id ?? (invoice ? null : undefined),
        poNumber: poNumber ?? selectedSubscriber?.poNumber ?? null,
        invoiceDate: form.invoiceDate,
        dueDate: form.dueDate,
        notes: form.notes,
        terms: invoice ? form.terms : form.terms || undefined,
        items: effectiveItems.map((it) => ({
          productId: it.productId || undefined,
          description: it.description, hsnSac: it.hsnSac || undefined,
          quantity: Number(it.quantity), unitPrice: Number(it.unitPrice),
          discount: Number(it.discount || 0), gstRate: Number(it.gstRate),
        })),
      };
      const { data } = invoice ? await api.put(`/invoices/${invoice.id}`, body) : await api.post("/invoices", body);
      return data as { invoiceNumber: string };
    },
    onSuccess: () => navigate("/invoices"),
    onError: (err) => setError(errMessage(err)),
  });

  const setItem = (i: number, patch: Partial<Item>) => {
    const items = [...form.items];
    items[i] = { ...items[i], ...patch };
    setForm({ ...form, items });
  };

  // picking a product auto-fills description, HSN, sale price and GST rate
  const pickProduct = (i: number, productId: string, p?: ProductOption) => {
    if (!productId) { setItem(i, { productId: "" }); return; }
    if (!p) return;
    setProductDetails((previous) => ({ ...previous, [p.id]: p }));
    setItem(i, {
      productId,
      description: p.name,
      hsnSac: p.hsnSac ?? "",
      unitPrice: Number(p.salePrice) ? String(Number(p.salePrice)) : "",
      gstRate: String(Number(p.gstRate)),
    });
  };

  const p = preview(effectiveItems);
  const valid = form.customerId && (!subscriberCode || !!selectedSubscriber) && form.items.length > 0 &&
    form.items.every((it) => it.description && Number(it.unitPrice) > 0 && Number(it.quantity) > 0);

  return (
    <>
      <div className="toolbar">
        <h2 className="page-title" style={{ margin: 0 }}>{invoice ? `Edit ${invoice.invoiceNumber}` : "New Invoice"}</h2>
        <div className="spacer" />
        <button onClick={() => navigate("/invoices")}>← Back to invoices</button>
      </div>

      <div className="card">
        <label>Invoice register</label>
        <select aria-label="Invoice register" disabled={!!invoice || !!selectedSubscriber} value={noGst ? "WITHOUT_GST" : "GST"} onChange={(e) => setChargeGst(e.target.value === "GST")}>
          <option value="GST">GST invoice</option><option value="WITHOUT_GST">Invoice without GST</option>
        </select>
        <small>{invoice ? "The invoice register and number are retained on edits." : selectedSubscriber ? "Uses the selected subscriber’s GST setting." : "Each register has its own number series."}</small>
        <div style={{ display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 12 }}>
          <div>
            <label>Customer *</label>
            <EntitySelect<CustomerLite> kind="customers" value={form.customerId} onChange={(id, customer) => { setForm({ ...form, customerId: id }); setSelectedCustomer(customer); setSubscriberCode(""); }} />
            {selectedCustomer && (
              <small>{selectedCustomer.gstTreatment ?? "B2C"} · state {selectedCustomer.stateCode ?? "same as company"}</small>
            )}
          </div>
          <div><label>Invoice date</label><input type="date" value={form.invoiceDate} onChange={(e) => setForm({ ...form, invoiceDate: e.target.value })} /></div>
          <div><label>Due date</label><input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} /></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 6 }}>
          {canReadSubscribers && <div>
              <label>Subscriber (optional, for PO number)</label>
              <input aria-label="Subscriber code for invoice" list="invoice-subscriber-codes" value={subscriberCode} placeholder="Search subscriber code / PO…" onChange={(e) => setSubscriberCode(e.target.value)} />
              <datalist id="invoice-subscriber-codes">{subscriberOptions.data?.items.map((subscriber) => <option key={subscriber.id} value={subscriber.code}>{subscriber.poNumber ?? "No PO number"}</option>)}</datalist>
              {selectedSubscriber && <small>PO: {selectedSubscriber.poNumber ?? "Not set"}</small>}
              {noGst && <small>Without GST — all invoice lines use zero tax.</small>}
              {subscriberCode && !selectedSubscriber && !subscriberOptions.isFetching && <small>Choose a matching subscriber code.</small>}
              {subscriberOptions.isError && <small className="error">{errMessage(subscriberOptions.error)}</small>}
          </div>}
          <div><label>PO number (for this invoice)</label><input aria-label="Invoice PO number" maxLength={100} value={poNumber ?? selectedSubscriber?.poNumber ?? ""} onChange={(e) => setPoNumber(e.target.value)} /></div>
        </div>
      </div>

      <div className="card">
        <label style={{ marginTop: 0 }}>Items — pick a product to auto-fill price/GST (stock decreases for goods), or use a custom line for services</label>
        <table style={{ fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ width: "20%" }}>Product</th><th style={{ width: "22%" }}>Description *</th>
              <th style={{ width: 90 }}>HSN/SAC</th><th style={{ width: 75 }}>Qty</th>
              <th style={{ width: 100 }}>Rate ₹ *</th><th style={{ width: 90 }}>Disc ₹</th><th style={{ width: 80 }}>GST %</th>
              <th style={{ width: 105, textAlign: "right" }}>Line total</th><th style={{ width: 36 }} />
            </tr>
          </thead>
          <tbody>
            {effectiveItems.map((it, i) => {
              const base = Number(it.quantity || 0) * Number(it.unitPrice || 0) - Number(it.discount || 0);
              const lineTotal = base + (base * Number(it.gstRate || 0)) / 100;
              const product = productDetails[it.productId];
              return (
                <tr key={i}>
                  <td>
                    <ProductSelect value={it.productId} onChange={(id, product) => pickProduct(i, id, product)} />
                    {product && !product.isService && (
                      <div style={{ fontSize: 11, color: Number(product.stockQty) < Number(it.quantity || 0) ? "var(--danger)" : "var(--muted)" }}>
                        in stock: {Number(product.stockQty)} {product.unit}
                      </div>
                    )}
                  </td>
                  <td><textarea rows={2} value={it.description} placeholder="Service / product description"
                    onChange={(e) => setItem(i, { description: e.target.value })} /></td>
                  <td><input value={it.hsnSac} placeholder="998599" onChange={(e) => setItem(i, { hsnSac: e.target.value })} /></td>
                  <td><input type="number" min="0" value={it.quantity} onChange={(e) => setItem(i, { quantity: e.target.value })} /></td>
                  <td><input type="number" min="0" value={it.unitPrice} onChange={(e) => setItem(i, { unitPrice: e.target.value })} /></td>
                  <td><input type="number" min="0" value={it.discount} onChange={(e) => setItem(i, { discount: e.target.value })} /></td>
                  <td>
                    <select disabled={noGst} value={it.gstRate} onChange={(e) => setItem(i, { gstRate: e.target.value })}>
                      <option>0</option><option>5</option><option>12</option><option>18</option><option>28</option>
                    </select>
                  </td>
                  <td style={{ textAlign: "right", whiteSpace: "nowrap" }}>{base > 0 ? inr(lineTotal) : "—"}</td>
                  <td>
                    {form.items.length > 1 && (
                      <IconButton className="small danger" title="Remove line"
                        onClick={() => setForm({ ...form, items: form.items.filter((_, x) => x !== i) })} icon="close" label="×">×</IconButton>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button className="small" style={{ marginTop: 8 }}
          onClick={() => setForm({ ...form, items: [...form.items, { ...EMPTY_ITEM }] })}>+ Add item</button>
      </div>

      <div className="card" style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 260 }}>
          <label style={{ marginTop: 0 }}>Notes (internal)</label>
          <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          <label>Terms</label><textarea value={form.terms} onChange={(e) => setForm({ ...form, terms: e.target.value })} />
        </div>
        <div style={{ textAlign: "right", minWidth: 240, lineHeight: 1.9 }}>
          Sub total {inr(p.sub)}<br />
          {p.disc > 0 && <>Discount − {inr(p.disc)}<br /></>}
          Taxable {inr(p.taxable)} · GST ~{inr(p.gst)}<br />
          <strong style={{ fontSize: 18 }}>Total ~{inr(p.total)}</strong>
          <div style={{ color: "var(--muted)", fontSize: 11 }}>preview — final CGST/SGST vs IGST split computed by server</div>
        </div>
      </div>

      {error && <div className="error" style={{ marginBottom: 12 }}>{error}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={() => navigate("/invoices")}>Cancel</button>
        <button className="primary" disabled={create.isPending || !valid} onClick={() => create.mutate()}>
          {create.isPending ? "Saving…" : invoice ? "Save invoice" : "Create invoice"}
        </button>
      </div>
    </>
  );
}
