import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery } from "@tanstack/react-query";
import { api, errMessage } from "../lib/api";

export interface EntityOption { id: string; name: string; sku?: string; code?: string; phone?: string; isActive?: boolean }
export interface ProductOption extends EntityOption { sku: string; unit: string; hsnSac?: string; salePrice: string; purchasePrice: string; gstRate: string; isService: boolean; stockQty: string }

export function EntitySelect<T extends EntityOption = EntityOption>({ kind, value, onChange, placeholder, onCreate, disabled = false, activeOnly = false }: {
  kind: "customers" | "suppliers" | "products" | "plans";
  value: string;
  onChange: (id: string, item?: T) => void;
  placeholder?: string;
  onCreate?: (name: string) => void;
  disabled?: boolean;
  activeOnly?: boolean;
}) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debounced, setDebounced] = useState("");
  const [active, setActive] = useState(0);
  const [picked, setPicked] = useState<T>();
  const root = useRef<HTMLDivElement>(null), menu = useRef<HTMLDivElement>(null), input = useRef<HTMLInputElement>(null);
  const [position, setPosition] = useState({ left: 0, top: 0, width: 260 });
  useEffect(() => { const timer = setTimeout(() => { setDebounced(search); setActive(0); }, 250); return () => clearTimeout(timer); }, [search]);
  const results = useQuery({ queryKey: ["entity-search", kind, debounced, activeOnly], enabled: open,
    queryFn: async ({ signal }) => {
      const data = (await api.get(`/${kind}`, { params: { search: debounced || undefined, page: 1, limit: 50, activity: activeOnly ? "active" : undefined }, signal })).data;
      if (Array.isArray(data)) { const items = (data as T[]).filter((item) => `${item.name} ${item.code ?? ""}`.toLowerCase().includes(debounced.toLowerCase())); return { items, total: items.length }; }
      return data as { items: T[]; total: number };
    },
  });
  const selected = useQuery({ queryKey: ["entity-search", kind, "selected", value], enabled: !!value && picked?.id !== value,
    queryFn: async ({ signal }) => {
      if (kind === "plans") {
        const data = (await api.get<T[]>("/plans", { signal })).data.find((plan) => plan.id === value);
        if (!data) throw new Error("Plan not found");
        return data;
      }
      return (await api.get<T>(`/${kind}/${value}`, { signal })).data;
    },
  });
  const item = picked?.id === value ? picked : selected.data;
  const label = (entry: EntityOption) => [entry.name, entry.sku ?? entry.code, entry.phone].filter(Boolean).join(" · ");
  const options = results.data?.items.filter((entry) => activeOnly ? entry.isActive === true : entry.isActive !== false) ?? [];
  const waiting = results.isFetching || search !== debounced;
  const canCreate = !!onCreate && search.trim().length >= 2 && !waiting && !results.isError && !!results.data && !options.some((entry) => entry.name.toLowerCase() === search.trim().toLowerCase() || entry.sku?.toLowerCase() === search.trim().toLowerCase());
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = root.current?.getBoundingClientRect(); if (!rect) return;
      const height = Math.min(300, Math.max(120, options.length * 42 + 80));
      const top = window.innerHeight - rect.bottom < height && rect.top > height ? Math.max(8, rect.top - height) : rect.bottom + 4;
      setPosition({ left: Math.max(8, Math.min(rect.left, window.innerWidth - Math.max(rect.width, 260) - 8)), top, width: Math.max(rect.width, 260) });
    };
    update(); window.addEventListener("resize", update); window.addEventListener("scroll", update, true);
    return () => { window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [open, options.length]);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false); };
    document.addEventListener("pointerdown", close); return () => document.removeEventListener("pointerdown", close);
  }, [open]);
  function choose(entry: T) { setPicked(entry); onChange(entry.id, entry); setOpen(false); setSearch(""); }
  return <div className="entity-select" ref={root}>
    <div className="entity-select-input"><input ref={input} role="combobox" aria-label={placeholder ?? `Search ${kind}`} aria-expanded={open} aria-controls={`${id}-options`} aria-autocomplete="list" aria-activedescendant={open && options[active] ? `${id}-${active}` : undefined}
      disabled={disabled} placeholder={placeholder ?? `Search ${kind}…`} value={open ? search : item ? label(item) : value ? "Loading selection…" : ""}
      onFocus={() => { setOpen(true); setSearch(""); }} onChange={(e) => { setOpen(true); setSearch(e.target.value); setActive(0); }}
      onKeyDown={(e) => {
        if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setActive((i) => Math.min(i + 1, options.length - 1)); }
        if (e.key === "ArrowUp") { e.preventDefault(); setActive((i) => Math.max(0, i - 1)); }
        if (e.key === "Enter" && open) { e.preventDefault(); if (!waiting && options[active]) choose(options[active]); }
        if (e.key === "Escape" || e.key === "Tab") setOpen(false);
      }} />
      {value && !disabled && <button type="button" aria-label={`Clear ${kind} selection`} onClick={() => { onChange(""); setPicked(undefined); setSearch(""); setOpen(false); }}>×</button>}
    </div>
    {selected.isError && <div className="error">{errMessage(selected.error)}</div>}
    {open && createPortal(<div ref={menu} className="entity-select-menu" style={{ left: position.left, top: position.top, width: position.width }}>
      <div role="listbox" id={`${id}-options`} aria-label={kind}>
        {waiting ? <div className="entity-select-hint">Searching…</div> : results.isError ? <div className="error">{errMessage(results.error)} <button type="button" onClick={() => void results.refetch()}>Retry</button></div> : <>
          {options.map((entry, i) => <button type="button" role="option" aria-selected={entry.id === value} id={`${id}-${i}`} key={entry.id} className={active === i ? "active" : ""} onMouseEnter={() => setActive(i)} onMouseDown={(e) => e.preventDefault()} onClick={() => choose(entry)}>{label(entry)}{activeOnly && <span className="badge ok" style={{ marginLeft: 6 }}>Active</span>}</button>)}
          {!options.length && <div className="entity-select-hint">No matching {kind}.</div>}
          {(results.data?.total ?? 0) > 50 && <div className="entity-select-hint">Showing up to 50 matches. Type more to narrow the search.</div>}
        </>}
      </div>
      {canCreate && <button type="button" className="entity-select-create" onMouseDown={(e) => e.preventDefault()} onClick={() => { setOpen(false); onCreate?.(search.trim()); }}>+ Create product “{search.trim()}”</button>}
    </div>, document.body)}
  </div>;
}
