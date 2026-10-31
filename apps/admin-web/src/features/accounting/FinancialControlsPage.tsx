import {WriteOffHistory} from "./WriteOffHistory";
import {YearEndClose} from "./YearEndClose";
import {SourcePosting} from "./SourcePosting";
import {BankCsvImport} from "./BankCsvImport";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, errMessage } from "../../lib/api";
import { useAuth } from "../../stores/auth";
import { formatDate } from "../../lib/date";
import { ListTable, ListPager, RowsPerPage, usePageSize } from "../../components/ListPagination";

interface Account { id: string; code: string; name: string; type: string; isMoneyAccount: boolean; opening?: string; debit?: string; credit?: string; closing?: string }
interface Journal { source:string; id: string; entryDate: string; narration: string; reversalOf: string | null; lines: Array<{ id: string; debit: string; credit: string; account: Account }> }
interface Statement { id: string; statementDate: string; reference: string; narration: string; debit: string; credit: string; journalLineId: string | null }
const money = (v: unknown) => Number(v ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const today = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

export function FinancialControlsPage() {
  const [tab, setTab] = useState("accounts"), [page, setPage] = useState(1);
  const [limit, setLimit] = usePageSize(() => setPage(1));
  const [accountId, setAccountId] = useState("");
  const [account, setAccount] = useState({ code: "", name: "", type: "ASSET", isMoneyAccount: false });
  const [entry, setEntry] = useState({ entryDate: today(), narration: "", lines: [{ accountId: "", debit: "", credit: "" }, { accountId: "", debit: "", credit: "" }] });
  const [statement, setStatement] = useState({ date: today(), reference: "", narration: "", debit: "", credit: "" });
  const [matching, setMatching] = useState<Statement | null>(null), [matchId, setMatchId] = useState("");
  const [reverseJournal, setReverseJournal] = useState<Journal | null>(null), [reason, setReason] = useState("");
  const [fyCode, setFyCode] = useState("");
  const [yearChecks, setYearChecks] = useState<Record<string,boolean>>({}), [yearNote, setYearNote] = useState("");
  const qc = useQueryClient(), hasPerm = useAuth(s => s.hasPerm);
  const years = useQuery({ queryKey: ["financial-years"], queryFn: async () => (await api.get("/financial-years")).data as Array<{ code: string; isActive: boolean }> , enabled: hasPerm("financial_year:read") });
  const selectedFy = fyCode || years.data?.find(y => y.isActive)?.code;
  const accounts = useQuery({ queryKey: ["financial-accounts"], queryFn: async () => (await api.get("/financial-controls/accounts")).data as Account[] });
  const trial = useQuery({ queryKey: ["trial-balance", selectedFy], queryFn: async () => (await api.get("/financial-controls/trial-balance", { params: { fyCode: selectedFy } })).data as { items: Account[]; difference: string; scope: string }, enabled: tab === "trial" });
  const journals = useQuery({ queryKey: ["financial-journals", page, limit], queryFn: async () => (await api.get("/financial-controls/journals", { params: { page, limit } })).data as { items: Journal[]; total: number }, enabled: tab === "journals" });
  const statements = useQuery({ queryKey: ["bank-statements", accountId, page, limit], queryFn: async () => (await api.get("/financial-controls/bank-statements", { params: { accountId, page, limit } })).data as { items: Statement[]; total: number }, enabled: tab === "bank" && !!accountId });
  const candidates = useQuery({ queryKey: ["bank-match-candidates", matching?.id], enabled: !!matching,
    queryFn: async () => (await api.get(`/financial-controls/bank-statements/${matching!.id}/candidates`)).data as Array<{ id: string; journal: { entryDate: string; narration: string } }> });
  const yearEnd = useQuery({ queryKey: ["year-end-review", selectedFy], enabled: tab === "yearend" && !!selectedFy,
    queryFn: async () => (await api.get(`/financial-controls/year-end/${selectedFy}`)).data as { signature: string; heldDocuments: number; unmatchedBankLines: number; pendingEvents: number; profitBasis: string | null; needsReview: boolean; checks: string[]; review: { reviewedAt: string; note: string } | null } });
  const mutate = useMutation({ mutationFn: async ({ url, body }: { url: string; body: unknown }) => api.post(`/financial-controls/${url}`, body), onSuccess: () => { void qc.invalidateQueries(); setReverseJournal(null); setMatching(null); } });
  const changeLine = (i: number, key: string, value: string) => setEntry({ ...entry, lines: entry.lines.map((l,index) => index === i ? { ...l, [key]: value } : l) });
  return <>
    <h2 className="page-title">Financial controls</h2>
    <p>New financial documents post automatically. Use Source posting to reconcile older documents and assign historical bank accounts. Verify opening balances before relying on the full trial balance.</p>
    <div className="toolbar">{["accounts","journals","trial","bank","sources","writeoffs","yearend"].map(t => <button key={t} className={tab === t ? "primary" : ""} onClick={() => { setTab(t); setPage(1); mutate.reset(); }}>{({ accounts: "Accounts", journals: "Journals", trial: "Trial balance", bank: "Bank reconciliation", sources:"Source posting", writeoffs:"Write-offs", yearend: "Year-end checklist" })[t]}</button>)}<RowsPerPage value={limit} onChange={setLimit} /></div>
    {mutate.isError && <div className="error">{errMessage(mutate.error)}</div>}
    {mutate.isSuccess && <p role="status">Saved successfully.</p>}
    {accounts.isError && <div className="error">{errMessage(accounts.error)}</div>}
    {tab === "accounts" && <>
      {hasPerm("settings:update") && <form className="card" onSubmit={e => { e.preventDefault(); mutate.mutate({ url: "accounts", body: account }); }}>
        <h3>Add account</h3><div className="toolbar"><label>Code<input required maxLength={30} value={account.code} onChange={e => setAccount({ ...account, code: e.target.value.toUpperCase() })} /></label><label>Name<input required value={account.name} onChange={e => setAccount({ ...account, name: e.target.value })} /></label><label>Type<select value={account.type} onChange={e => setAccount({ ...account, type: e.target.value, isMoneyAccount: false })}>{["ASSET","LIABILITY","EQUITY","INCOME","EXPENSE"].map(t => <option key={t}>{t}</option>)}</select></label><label><input type="checkbox" disabled={account.type !== "ASSET"} checked={account.isMoneyAccount} onChange={e => setAccount({ ...account, isMoneyAccount: e.target.checked })} />Cash / bank account</label><button disabled={mutate.isPending}>Create account</button></div>
        <small>Enter a verified opening balance as a balanced opening journal, with its corresponding capital or opening-control account. No balance is assumed.</small>
      </form>}
      <ListTable><thead><tr><th>Code</th><th>Name</th><th>Type</th><th>Cash/bank</th></tr></thead><tbody>{accounts.data?.slice((page-1)*limit,page*limit).map(a => <tr key={a.id}><td>{a.code}</td><td>{a.name}</td><td>{a.type}</td><td>{a.isMoneyAccount ? "Yes" : "—"}</td></tr>)}</tbody></ListTable><ListPager page={page} limit={limit} total={accounts.data?.length ?? 0} onChange={setPage} />
    </>}
    {tab === "journals" && <>
      {hasPerm("day_book:create") && <form className="card" onSubmit={e => { e.preventDefault(); mutate.mutate({ url: "journals", body: { ...entry, lines: entry.lines.map(l => ({ accountId: l.accountId, debit: Number(l.debit), credit: Number(l.credit) })) } }); }}>
        <h3>Post balanced journal / transfer</h3><label>Date<input required type="date" value={entry.entryDate} onChange={e => setEntry({ ...entry, entryDate: e.target.value })} /></label><label>Narration<input required minLength={10} value={entry.narration} onChange={e => setEntry({ ...entry, narration: e.target.value })} /></label>
        <ListTable><thead><tr><th>Account</th><th>Debit</th><th>Credit</th><th /></tr></thead><tbody>{entry.lines.map((l,i) => <tr key={i}><td><select required value={l.accountId} onChange={e => changeLine(i,"accountId",e.target.value)}><option value="">Select account</option>{accounts.data?.map(a => <option key={a.id} value={a.id}>{a.code} · {a.name}</option>)}</select></td><td><input type="number" min="0" step="0.01" value={l.debit} onChange={e => changeLine(i,"debit",e.target.value)} /></td><td><input type="number" min="0" step="0.01" value={l.credit} onChange={e => changeLine(i,"credit",e.target.value)} /></td><td><button type="button" disabled={entry.lines.length <= 2} onClick={() => setEntry({ ...entry, lines: entry.lines.filter((_,index) => i !== index) })}>Remove</button></td></tr>)}</tbody></ListTable>
        <div className="actions"><button type="button" onClick={() => setEntry({ ...entry, lines: [...entry.lines, { accountId: "", debit: "", credit: "" }] })}>Add line</button><button disabled={mutate.isPending}>Post journal</button></div>
        <small>For a bank transfer, debit the receiving account and credit the sending account. This does not duplicate an operational receipt or change customer balances.</small>
      </form>}
      {journals.isError && <div className="error">{errMessage(journals.error)}</div>}
      <ListTable><thead><tr><th>Date / journal</th><th>Narration</th><th>Lines</th><th /></tr></thead><tbody>{journals.data?.items.map(j => <tr key={j.id}><td>{formatDate(j.entryDate)}<small>{j.id}</small></td><td>{j.narration}</td><td>{j.lines.map(l => <div key={l.id}>{l.account.name}: Dr {money(l.debit)} / Cr {money(l.credit)}</div>)}</td><td>{j.source === "MANUAL" && !j.reversalOf && hasPerm("day_book:update") && <button onClick={() => { setReverseJournal(j); setReason(""); }}>Reverse</button>}</td></tr>)}</tbody></ListTable><ListPager page={page} limit={limit} total={journals.data?.total ?? 0} onChange={setPage} />
    </>}
    {tab === "trial" && <>
      <label>Financial year<select value={selectedFy ?? ""} onChange={e => setFyCode(e.target.value)}>{years.data?.map(y => <option key={y.code}>{y.code}</option>)}</select></label>
      {trial.isError && <div className="error">{errMessage(trial.error)}</div>}<p>{trial.data?.scope}</p>
      <ListTable><thead><tr><th>Account</th><th>Opening Dr (+) / Cr (−)</th><th>Period debit</th><th>Period credit</th><th>Closing Dr (+) / Cr (−)</th></tr></thead><tbody>{trial.data?.items.slice((page-1)*limit,page*limit).map(a => <tr key={a.id}><td>{a.code} · {a.name}</td><td>{money(a.opening)}</td><td>{money(a.debit)}</td><td>{money(a.credit)}</td><td>{money(a.closing)}</td></tr>)}</tbody></ListTable><p>Trial-balance difference: ₹{money(trial.data?.difference)}</p><ListPager page={page} limit={limit} total={trial.data?.items.length ?? 0} onChange={setPage} />
    </>}
    {tab === "bank" && <>
      <label>Cash / bank account<select aria-label="Cash / bank account" value={accountId} onChange={e => { setAccountId(e.target.value); setPage(1); }}><option value="">Select account</option>{accounts.data?.filter(a => a.isMoneyAccount).map(a => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      {accountId && hasPerm("day_book:create") && <BankCsvImport key={accountId} accountId={accountId} />}
      <p>Enter statement debits as withdrawals and credits as receipts. Matching checks the opposite side in our journal and the exact amount. It does not create a financial transaction.</p>
      {accountId && hasPerm("day_book:create") && <form className="card" onSubmit={e => { e.preventDefault(); mutate.mutate({ url: "bank-statements", body: { accountId, rows: [{ ...statement, debit: Number(statement.debit), credit: Number(statement.credit) }] } }); }}>
        <h3>Add statement line</h3><div className="toolbar"><label>Date<input required type="date" value={statement.date} onChange={e => setStatement({ ...statement, date: e.target.value })} /></label><label>Reference<input required value={statement.reference} onChange={e => setStatement({ ...statement, reference: e.target.value })} /></label><label>Narration<input value={statement.narration} onChange={e => setStatement({ ...statement, narration: e.target.value })} /></label><label>Withdrawal<input min="0" step="0.01" type="number" value={statement.debit} onChange={e => setStatement({ ...statement, debit: e.target.value })} /></label><label>Receipt<input min="0" step="0.01" type="number" value={statement.credit} onChange={e => setStatement({ ...statement, credit: e.target.value })} /></label><button disabled={mutate.isPending}>Add line</button></div>
      </form>}
      {statements.isError && <div className="error">{errMessage(statements.error)}</div>}
      <ListTable><thead><tr><th>Date</th><th>Reference</th><th>Withdrawal</th><th>Receipt</th><th>Match journal line</th></tr></thead><tbody>{statements.data?.items.map(s => <tr key={s.id}><td>{formatDate(s.statementDate)}</td><td>{s.reference} · {s.narration}</td><td>{money(s.debit)}</td><td>{money(s.credit)}</td><td><span>{s.journalLineId ? "Reconciled" : "Unmatched"}</span>{hasPerm("day_book:update") && <button disabled={mutate.isPending} onClick={() => { if (s.journalLineId) mutate.mutate({ url: `bank-statements/${s.id}/match`, body: { journalLineId: null } }); else { setMatching(s); setMatchId(""); } }}>{s.journalLineId ? "Unmatch" : "Find matching entry"}</button>}</td></tr>)}</tbody></ListTable><ListPager page={page} limit={limit} total={statements.data?.total ?? 0} onChange={setPage} />
    </>}
    {tab === "writeoffs" && <><label>Financial year<select value={selectedFy??""} onChange={e=>setFyCode(e.target.value)}>{years.data?.map(y=><option key={y.code}>{y.code}</option>)}</select></label><WriteOffHistory fyCode={selectedFy??""} canReverse={hasPerm("credit_note:update")} /></>}
    {tab === "sources" && <><label>Financial year<select value={selectedFy??""} onChange={e=>setFyCode(e.target.value)}>{years.data?.map(y=><option key={y.code}>{y.code}</option>)}</select></label><SourcePosting fyCode={selectedFy??""} canPost={hasPerm("settings:update")&&hasPerm("day_book:create")} /></>}
    {tab === "yearend" && <div className="card"><h3>Financial-year review</h3><label>Financial year<select value={selectedFy ?? ""} onChange={e => { setFyCode(e.target.value); setYearChecks({}); setYearNote(""); }}>{years.data?.map(y => <option key={y.code}>{y.code}</option>)}</select></label>
      {yearEnd.isError && <div className="error">{errMessage(yearEnd.error)}</div>}
      {yearEnd.data && <><p>Held legacy documents: {yearEnd.data.heldDocuments} · Unmatched bank lines: {yearEnd.data.unmatchedBankLines} · Pending financial events: {yearEnd.data.pendingEvents}</p><p>Profit carry-forward starts: {yearEnd.data.profitBasis ? formatDate(yearEnd.data.profitBasis) : "Historical basis"}. Saving this review does not reset it.</p>
        <p>{yearEnd.data.needsReview ? "Review required: no current review or records changed." : `Review saved ${formatDate(yearEnd.data.review!.reviewedAt)}`}</p>
        {yearEnd.data.checks.map(key => <label key={key} style={{ display: "block", margin: 10 }}><input type="checkbox" checked={!!yearChecks[key]} onChange={e => setYearChecks({ ...yearChecks, [key]: e.target.checked })} />{({ customerBalances: "Customer balances and outstanding verified", supplierBalances: "Supplier balances verified", cashAndBanks: "Physical cash and bank balances reconciled", stock: "Closing stock verified", tdsAndTaxes: "TDS and tax balances reviewed", legacyHolds: "Legacy holds and their effect on completeness reviewed", profitAndOpeningBalances: "Profit and next-year opening balances reviewed" })[key]}</label>)}
        <label>Reconciliation evidence and unresolved exceptions<textarea minLength={20} maxLength={1000} value={yearNote} onChange={e => setYearNote(e.target.value)} /></label>
        {hasPerm("financial_year:update") && <button disabled={mutate.isPending || yearNote.trim().length < 20 || yearEnd.data.pendingEvents > 0 || yearEnd.data.checks.some(key => !yearChecks[key])} onClick={() => mutate.mutate({ url: `year-end/${selectedFy}/review`, body: { signature: yearEnd.data!.signature, note: yearNote, checks: yearChecks } })}>Save year-end review</button>}
        <p>This checklist records your reconciliation. It does not post missing records, certify balances or lock the year. After resolving exceptions, use the controlled closing preview below to close and lock the year.</p>
      </>}
    </div>}
    {tab === "yearend" && hasPerm("financial_year:update") && selectedFy && <YearEndClose fyCode={selectedFy} />}
    {matching && <div className="modal-overlay"><div className="modal" role="dialog" aria-modal="true"><h3>Reconcile {matching.reference}</h3><p>{formatDate(matching.statementDate)} · Withdrawal {money(matching.debit)} · Receipt {money(matching.credit)}</p>
      {candidates.isError && <div className="error">{errMessage(candidates.error)}</div>}
      <label>Matching journal entry<select aria-label="Matching journal entry" value={matchId} onChange={e => setMatchId(e.target.value)}><option value="">Select a matching entry</option>{candidates.data?.map(c => <option key={c.id} value={c.id}>{formatDate(c.journal.entryDate)} · {c.journal.narration}</option>)}</select></label>
      {!candidates.isFetching && !candidates.data?.length && <p>No unmatched journal lines have this account, direction and amount. Review or post the missing entry first.</p>}
      <div className="actions"><button onClick={() => setMatching(null)}>Cancel</button><button disabled={!matchId || mutate.isPending} onClick={() => mutate.mutate({ url: `bank-statements/${matching.id}/match`, body: { journalLineId: matchId } })}>Confirm match</button></div></div></div>}
    {reverseJournal && <div className="modal-overlay"><div className="modal"><h3>Reverse journal</h3><p>Posts an equal opposite journal dated {formatDate(today())}. Original entries remain in the audit trail.</p><label>Reason<textarea value={reason} onChange={e => setReason(e.target.value)} /></label><div className="actions"><button onClick={() => setReverseJournal(null)}>Cancel</button><button disabled={mutate.isPending || reason.trim().length < 10} onClick={() => mutate.mutate({ url: `journals/${reverseJournal.id}/reverse`, body: { reason, entryDate: today() } })}>Confirm reversal</button></div></div></div>}
  </>;
}
