import { Children, Fragment, cloneElement, isValidElement, useState, type HTMLAttributes, type ReactElement, type ReactNode } from "react";

const SIZES = [10, 20, 25, 50, 100];
export function usePageSize(reset: () => void) {
  const [size, setSize] = useState(() => {
    try { const saved = Number(localStorage.getItem("fii-list-page-size")); return SIZES.includes(saved) ? saved : 20; }
    catch { return 20; }
  });
  return [size, (value: number) => {
    if (!SIZES.includes(value)) return;
    setSize(value); reset();
    try { localStorage.setItem("fii-list-page-size", String(value)); } catch { /* Preference storage is optional. */ }
  }] as const;
}

export function RowsPerPage({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  return <label className="rows-per-page">Rows <select aria-label="Rows per page" value={value} onChange={(e) => onChange(Number(e.target.value))}>
    {SIZES.map((size) => <option key={size} value={size}>{size}</option>)}
  </select></label>;
}

export function ListPager({ page, limit, total, onChange }: { page: number; limit: number; total: number; onChange: (page: number) => void }) {
  return <div className="pagination"><button aria-label="Previous page" disabled={page <= 1} onClick={() => onChange(page - 1)}>‹</button>
    <span>Page {page} of {Math.max(1, Math.ceil(total / limit))} · {total} records</span>
    <button aria-label="Next page" disabled={page * limit >= total} onClick={() => onChange(page + 1)}>›</button></div>;
}

function flatten(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap((child) => isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment ? flatten(child.props.children) : [child]);
}

/** Local pagination for complete, read-only lists and report previews. */
export function ListTable({ children, ...props }: HTMLAttributes<HTMLTableElement>) {
  const [page, setPage] = useState(1);
  const [size, setSize] = usePageSize(() => setPage(1));
  const parts = Children.toArray(children);
  const body = parts.find((part) => isValidElement(part) && part.type === "tbody") as ReactElement<{ children?: ReactNode }> | undefined;
  const rows = body ? flatten(body.props.children) : [];
  const pages = Math.max(1, Math.ceil(rows.length / size));
  const current = Math.min(page, pages);
  return <>
    <div className="list-pagination"><RowsPerPage value={size} onChange={setSize} /><span>{rows.length} rows</span>
      {pages > 1 && <><button aria-label="Previous page" disabled={current <= 1} onClick={() => setPage(current - 1)}>‹</button><span>{current} / {pages}</span><button aria-label="Next page" disabled={current >= pages} onClick={() => setPage(current + 1)}>›</button></>}
    </div>
    <div className="table-scroll"><table {...props}>{parts.map((part) => part === body ? cloneElement(body, { children: rows.map((row, index) => {
      if (!isValidElement<{ className?: string }>(row)) return row;
      const offPage = index < (current - 1) * size || index >= current * size;
      return cloneElement(row, { className: `${row.props.className ?? ""}${offPage ? " list-page-hidden" : ""}` });
    }) }) : part)}</table></div>
  </>;
}
