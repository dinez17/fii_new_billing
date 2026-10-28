export interface PartyFilters {
  activity: string; balance: string; sortBy: string; order: string;
}
export const DEFAULT_PARTY_FILTERS: PartyFilters = { activity: "all", balance: "all", sortBy: "outstanding", order: "desc" };
export const DEFAULT_CUSTOMER_FILTERS: PartyFilters = { activity: "active", balance: "due", sortBy: "outstanding", order: "desc" };

export function PartyListFilters({ value, onChange, customer = false }: { value: PartyFilters; onChange: (value: PartyFilters) => void; customer?: boolean }) {
  function change(key: keyof PartyFilters, next: string) { onChange({ ...value, [key]: next }); }
  return <>
    <select aria-label="Activity filter" style={{ width: 145 }} value={value.activity} onChange={(e) => change("activity", e.target.value)}>
      <option value="all">All statuses</option><option value="active">Active</option><option value="inactive">Inactive</option>
    </select>
    <select aria-label="Balance filter" style={{ width: 160 }} value={value.balance} onChange={(e) => change("balance", e.target.value)}>
      <option value="all">All balances</option><option value="due">Outstanding &gt; 0</option><option value="settled">Settled (zero)</option>{!customer && <option value="credit">Credit balance</option>}
    </select>
    <select aria-label="Sort by" style={{ width: 165 }} value={value.sortBy} onChange={(e) => change("sortBy", e.target.value)}>
      <option value="outstanding">Outstanding</option><option value="invoiceCount">Invoice count</option><option value="name">Name</option><option value="code">Code</option><option value="status">Active status</option><option value="createdAt">Created date</option>
    </select>
    <select aria-label="Sort direction" style={{ width: 150 }} value={value.order} onChange={(e) => change("order", e.target.value)}>
      <option value="desc">Descending ↓</option><option value="asc">Ascending ↑</option>
    </select>
    <button onClick={() => onChange(customer ? DEFAULT_CUSTOMER_FILTERS : DEFAULT_PARTY_FILTERS)}>Reset filters</button>
  </>;
}
