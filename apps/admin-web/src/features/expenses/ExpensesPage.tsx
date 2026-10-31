import { MoneyAccountSelect } from "../../components/MoneyAccountSelect";
import { formatDate } from "../../lib/date";
import { IconButton } from "../../components/IconButton";
import { RowsPerPage, usePageSize } from "../../components/ListPagination";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";
import { TransactionFilters, useTransactionPeriod } from "../../components/TransactionFilters";

interface Category { id: string; name: string }
interface Vendor { id: string; name: string }
interface ExpenseRow {
  id: string; expenseDate: string; description: string; amount: string;
  gstRate: string; gstAmount: string; total: string; mode: string; reference?: string;
  hasReceipt: boolean; status: string;
  category: { name: string }; vendor?: { name: string } | null;
}

const inr = (v: unknown) => `₹${Number(v).toLocaleString("en-IN", { minimumFractionDigits: 2 })}`;

export function ExpensesPage() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPerm);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = usePageSize(() => setPage(1));
  const period = useTransactionPeriod(() => setPage(1));
  const [status, setStatus] = useState("RECORDED");
  const [search, setSearch] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    categoryId: "", vendorId: "", expenseDate: new Date().toISOString().slice(0, 10),
    description: "", amount: "", gstRate: "0", mode: "CASH", financialAccountId: "", reference: "",
    receiptDataUrl: "", receiptName: "",
  });

  const categories = useQuery({
    queryKey: ["exp-categories"],
    queryFn: async () => (await api.get("/expense-categories")).data as Category[],
  });
  const vendors = useQuery({
    queryKey: ["exp-vendors"],
    queryFn: async () => (await api.get("/expense-vendors")).data as Vendor[],
  });

  const list = useQuery({
    queryKey: ["expenses", page, search, categoryId, pageSize, period.params, status],
    enabled: period.ready,
    queryFn: async () => (await api.get("/expenses", {
      params: { page, limit: pageSize, search: search || undefined, categoryId: categoryId || undefined, ...period.params, status },
    })).data as { items: ExpenseRow[]; total: number; limit: number; sums: { total: string; inputGst: string } },
  });

  const create = useMutation({
    mutationFn: async () => {
      await api.post("/expenses", {
        categoryId: form.categoryId,
        vendorId: form.vendorId || undefined,
        expenseDate: form.expenseDate,
        description: form.description,
        amount: Number(form.amount),
        gstRate: Number(form.gstRate),
        financialAccountId: form.financialAccountId || null,
        mode: form.mode,
        reference: form.reference || undefined,
        receiptDataUrl: form.receiptDataUrl || undefined,
      });
    },
    onSuccess: () => {
      setCreating(false); setError("");
      setForm({ ...form, description: "", amount: "", reference: "", receiptDataUrl: "", receiptName: "" });
      qc.invalidateQueries({ queryKey: ["expenses"] });
    },
    onError: (err) => setError(errMessage(err)),
  });

  async function addMaster(kind: "category" | "vendor") {
    const name = prompt(`New ${kind} name:`);
    if (!name) return;
    try {
      await api.post(kind === "category" ? "/expense-categories" : "/expense-vendors", { name });
      qc.invalidateQueries({ queryKey: [kind === "category" ? "exp-categories" : "exp-vendors"] });
    } catch (err) { alert(errMessage(err)); }
  }

  async function attachReceipt(file: File) {
    if (file.size > 500_000) { alert("Receipt must be under 500KB"); return; }
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as string);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    setForm({ ...form, receiptDataUrl: dataUrl, receiptName: file.name });
  }

  async function viewReceipt(e: ExpenseRow) {
    try {
      const { data } = await api.get(`/expenses/${e.id}/receipt`);
      const win = window.open("", "_blank");
      if (win) win.document.write(
        data.dataUrl.startsWith("data:application/pdf")
          ? `<iframe src="${data.dataUrl}" style="width:100%;height:100%" frameborder="0"></iframe>`
          : `<img src="${data.dataUrl}" style="max-width:100%" />`,
      );
    } catch (err) { alert(errMessage(err)); }
  }

  async function cancel(e: ExpenseRow) {
    if (!confirm(`Cancel expense "${e.description}"?`)) return;
    try { await api.post(`/expenses/${e.id}/cancel`); for (const key of ["expenses", "day-book", "balance-sheet", "pnl-tally", "report", "dashboard"]) void qc.invalidateQueries({ queryKey: [key] }); }
    catch (err) { alert(errMessage(err)); }
  }

  const gstAmt = (Number(form.amount || 0) * Number(form.gstRate || 0)) / 100;

  return (
    <>
      <h2 className="page-title">Expenses</h2>
      <div className="toolbar">
        <RowsPerPage value={pageSize} onChange={setPageSize} />
        <select aria-label="Expense status" value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}><option value="ALL">All statuses</option><option>RECORDED</option><option>CANCELLED</option></select>
        <TransactionFilters period={period} />
        <input style={{ width: 220 }} placeholder="Search description…" value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        <select style={{ width: 180 }} value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }}>
          <option value="">All categories</option>
          {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        {list.data && (
          <span style={{ color: "var(--muted)" }}>
            Total {inr(list.data.sums.total)} · Input GST {inr(list.data.sums.inputGst)}
          </span>
        )}
        <div className="spacer" />
        {hasPerm("expense:create") && (
          <>
            <button className="small" onClick={() => void addMaster("category")}>+ Category</button>
            <button className="small" onClick={() => void addMaster("vendor")}>+ Vendor</button>
            <button className="primary" onClick={() => { setCreating(true); setError(""); }}>+ New Expense</button>
          </>
        )}
      </div>

      <table>
        <thead>
          <tr><th>Date</th><th>Category</th><th>Description</th><th>Vendor</th><th>Amount</th><th>GST</th><th>Total</th><th>Mode</th><th /></tr>
        </thead>
        <tbody>
          {list.data?.items.map((e) => (
            <tr key={e.id}>
              <td>{formatDate(e.expenseDate)}</td>
              <td><span className="badge">{e.category.name}</span></td>
              <td>{e.description}{e.status === "CANCELLED" && <span className="badge warn" style={{ marginLeft: 6 }}>Cancelled</span>}</td>
              <td>{e.vendor?.name ?? "—"}</td>
              <td>{inr(e.amount)}</td>
              <td>{Number(e.gstAmount) > 0 ? inr(e.gstAmount) : "—"}</td>
              <td>{inr(e.total)}</td>
              <td><span className="badge">{e.mode}</span></td>
              <td style={{ whiteSpace: "nowrap" }}>
                {e.hasReceipt && <IconButton className="small" onClick={() => void viewReceipt(e)} icon="more" label="Receipt">Receipt</IconButton>}{" "}
                {hasPerm("expense:update") && e.status === "RECORDED" && (
                  <IconButton className="small danger" onClick={() => void cancel(e)} icon="close" label="Cancel">Cancel</IconButton>
                )}
              </td>
            </tr>
          ))}
          {list.data?.items.length === 0 && (
            <tr><td colSpan={9} style={{ color: "var(--muted)" }}>No expenses yet.</td></tr>
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
        <div className="modal-overlay entry-fullpage-overlay" onClick={() => setCreating(false)}>
          <div className="modal" style={{ width: 560 }} onClick={(e) => e.stopPropagation()}>
            <h3>New expense</h3>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <label>Category *</label>
                <select value={form.categoryId} onChange={(e) => setForm({ ...form, categoryId: e.target.value })}>
                  <option value="">— select —</option>
                  {categories.data?.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label>Vendor</label>
                <select value={form.vendorId} onChange={(e) => setForm({ ...form, vendorId: e.target.value })}>
                  <option value="">— none —</option>
                  {vendors.data?.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
            </div>
            <label>Description *</label>
            <input value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Office electricity bill — June" />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
              <div><label>Date</label>
                <input type="date" value={form.expenseDate} onChange={(e) => setForm({ ...form, expenseDate: e.target.value })} /></div>
              <div><label>Amount ₹ (taxable) *</label>
                <input type="number" value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value })} /></div>
              <div>
                <label>GST % (input credit)</label>
                <select value={form.gstRate} onChange={(e) => setForm({ ...form, gstRate: e.target.value })}>
                  <option>0</option><option>5</option><option>12</option><option>18</option><option>28</option>
                </select>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
              <div>
                <MoneyAccountSelect value={form.financialAccountId} onChange={id=>setForm({...form,financialAccountId:id})} />
                <label>Payment mode</label>
                <select value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                  <option>CASH</option><option>UPI</option><option>BANK_TRANSFER</option><option>CHEQUE</option><option>CARD</option>
                </select>
              </div>
              <div><label>Reference</label>
                <input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></div>
            </div>
            <label>Receipt (image/PDF, max 500KB)</label>
            <input type="file" accept="image/png,image/jpeg,application/pdf"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void attachReceipt(f); }} />
            {form.receiptName && <span style={{ color: "var(--ok)", fontSize: 12 }}>attached: {form.receiptName}</span>}
            {Number(form.amount) > 0 && (
              <p style={{ textAlign: "right", marginTop: 8 }}>
                Total: <strong>{inr(Number(form.amount) + gstAmt)}</strong>
                {gstAmt > 0 && <span style={{ color: "var(--muted)" }}> (incl. {inr(gstAmt)} input GST)</span>}
              </p>
            )}
            {error && <div className="error">{error}</div>}
            <div className="actions">
              <button onClick={() => setCreating(false)}>Cancel</button>
              <button className="primary"
                disabled={create.isPending || !form.categoryId || !form.description || !Number(form.amount)}
                onClick={() => create.mutate()}>
                {create.isPending ? "Saving…" : "Save expense"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
