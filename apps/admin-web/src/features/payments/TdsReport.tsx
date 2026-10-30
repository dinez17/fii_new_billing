import { useAuth } from "../../stores/auth";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { api, errMessage } from "../../lib/api";
import { useTransactionPeriod } from "../../components/TransactionFilters";
import { RowsPerPage, usePageSize } from "../../components/ListPagination";
import { formatDate } from "../../lib/date";
interface TdsRow { customer: { id: string; code: string; name: string; gstin: string | null; phone: string | null; email: string | null }; tdsAmount: string; moneyReceived: string; entries: number }
interface Report { financialYear: { code: string; startDate: string; endDate: string }; items: TdsRow[]; totalTds: string; entries: number }
const inr = (value: unknown) => `₹${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export function TdsReport() {
  const userId = useAuth(state => state.user?.id);
  const [page, setPage] = useState(1), [search, setSearch] = useState("");
  const [pageSize, setPageSize] = usePageSize(() => setPage(1));
  const period = useTransactionPeriod(() => setPage(1));
  const query = useQuery({ queryKey: ["tds-report", userId, period.fyCode], enabled: period.ready && !!userId, queryFn: async () => (await api.get("/payments/tds-report", { params: { fyCode: period.fyCode || undefined } })).data as Report });
  const rows = query.data?.items.filter(row => [row.customer.name, row.customer.code, row.customer.gstin, row.customer.phone].some(v => v?.toLowerCase().includes(search.toLowerCase()))) ?? [];
  return <><h2 className="page-title">Customer TDS report</h2><div className="toolbar">
    {period.canRead && <select aria-label="TDS financial year" value={period.fyCode} onChange={e => period.setYear(e.target.value)}>{period.years.data?.map(fy => <option key={fy.id} value={fy.code}>{fy.code}{fy.isActive ? " ●" : ""}</option>)}</select>}
    <RowsPerPage value={pageSize} onChange={setPageSize} /><input aria-label="Search TDS customers" placeholder="Search customer / code / GSTIN / phone" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
  </div>{query.isPending && <p>Loading TDS report…</p>}{query.isError && <div className="error">{errMessage(query.error)}</div>}{period.years.isError && <div className="error">{errMessage(period.years.error)}</div>}
  {query.data && <><div className="card"><strong>FY {query.data.financialYear.code} · Total TDS deducted: {inr(query.data.totalTds)}</strong><p>{formatDate(query.data.financialYear.startDate)} – {formatDate(query.data.financialYear.endDate)} · Payment entries: {query.data.entries} · Customers: {query.data.items.length}</p><p className="document-help">Full financial-year totals by payment date. Reconcile recorded deductions with your tax-credit statement.</p></div>
  <table><thead><tr><th>Code</th><th>Customer</th><th>GSTIN</th><th>Phone / email</th><th>Entries</th><th>TDS deducted</th></tr></thead><tbody>{rows.slice((page-1)*pageSize,page*pageSize).map(row => <tr key={row.customer.id}><td>{row.customer.code}</td><td>{row.customer.name}</td><td>{row.customer.gstin ?? "—"}</td><td>{row.customer.phone ?? "—"}<br />{row.customer.email ?? ""}</td><td>{row.entries}</td><td>{inr(row.tdsAmount)}</td></tr>)}{!rows.length && <tr><td colSpan={6}>No TDS entries found.</td></tr>}</tbody></table>
  <div className="pagination"><button disabled={page <= 1} onClick={() => setPage(page-1)}>Previous</button><span>Page {page} of {Math.max(1,Math.ceil(rows.length/pageSize))} · {rows.length} customers</span><button disabled={page*pageSize >= rows.length} onClick={() => setPage(page+1)}>Next</button></div></>}
  </>;
}
