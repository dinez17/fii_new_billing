import { APP_NAME, APP_ICON } from "../../../../packages/browser/src/brand";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../stores/auth";
import { api } from "../lib/api";
import { isPlatformConsole } from "../lib/console";

interface NavItem { path: string; label: string; permission?: string }
interface NavGroup { label: string; items: NavItem[] }
type NavEntry = NavItem | NavGroup;
const isGroup = (e: NavEntry): e is NavGroup => "items" in e;

const NAV: NavEntry[] = isPlatformConsole ? [
  { path: "/platform/tenants", label: "Tenant management", permission: "platform:read" },
  { path: "/settings", label: "Account & security", permission: "settings:read" },
] : [
  { path: "/dashboard", label: "Dashboard" },
  {
    label: "Sales & Billing",
    items: [
      { path: "/invoices", label: "Invoices", permission: "invoice:read" },
      { path: "/quotations", label: "Quotations", permission: "invoice:read" },
      { path: "/proformas", label: "Proforma invoices", permission: "invoice:read" },
      { path: "/billing-runs", label: "Billing Runs", permission: "billing_run:read" },
      { path: "/notes", label: "Credit/Debit Notes", permission: "credit_note:read" },
      { path: "/payments", label: "Payments", permission: "payment:read" },
    ],
  },
  {
    label: "Customers",
    items: [
      { path: "/customers", label: "Customers", permission: "customer:read" },
      { path: "/subscribers", label: "Subscribers", permission: "subscriber:read" },
      { path: "/plans", label: "Plans", permission: "plan:read" },
    ],
  },
  {
    label: "Purchases",
    items: [
      { path: "/suppliers", label: "Suppliers", permission: "supplier:read" },
      { path: "/purchase-orders", label: "Purchase Orders", permission: "purchase_order:read" },
      { path: "/purchases", label: "Purchases", permission: "purchase_invoice:read" },
      { path: "/purchase-returns", label: "Purchase Returns", permission: "purchase_return:read" },
      { path: "/expenses", label: "Expenses", permission: "expense:read" },
    ],
  },
  {
    label: "Inventory",
    items: [
      { path: "/products", label: "Products & Stock", permission: "product:read" },
    ],
  },
  {
    label: "Accounting",
    items: [
      { path: "/day-book", label: "Day Book", permission: "day_book:read" },
      { path: "/ledger/customers", label: "Customer Ledger", permission: "report:read" },
      { path: "/ledger/suppliers", label: "Supplier Ledger", permission: "report:read" },
      { path: "/reports/sales", label: "Sales Report", permission: "report:read" },
      { path: "/reports/purchases", label: "Purchase Report", permission: "report:read" },
      { path: "/reports/collections", label: "Collections", permission: "report:read" },
      { path: "/reports/outstanding", label: "Outstanding", permission: "report:read" },
      { path: "/reports/profit-loss", label: "Profit & Loss", permission: "report:read" },
      { path: "/reports/pnl-tally", label: "P&L (Tally format)", permission: "report:read" },
      { path: "/reports/balance-sheet", label: "Balance Sheet", permission: "report:read" },
      { path: "/gst", label: "GST Reports", permission: "gst_report:read" },
      { path: "/exports", label: "Exports", permission: "report:export" },
    ],
  },
  {
    label: "Helpdesk",
    items: [
      { path: "/complaints", label: "Complaints", permission: "complaint:read" },
      { path: "/tasks", label: "Tasks", permission: "task:read" },
    ],
  },
  {
    label: "HR",
    items: [
      { path: "/employees", label: "Employees", permission: "employee:read" },
      { path: "/attendance", label: "Attendance & Leave", permission: "attendance:read" },
      { path: "/payroll", label: "Payroll", permission: "payroll:read" },
    ],
  },
  {
    label: "Administration",
    items: [
      { path: "/users", label: "Users", permission: "user:read" },
      { path: "/roles", label: "Roles", permission: "role:read" },
      { path: "/notifications", label: "Notifications", permission: "notification_template:read" },
      { path: "/audit", label: "Audit Logs", permission: "audit:read" },
      { path: "/settings", label: "Settings", permission: "settings:read" },
    ],
  },
  { path: "/backup", label: "Backup & Restore", permission: "backup:read" },
];

function NavGroupView({ group, hasPerm, open, onToggle }: {
  group: NavGroup; hasPerm: (p: string) => boolean; open: boolean; onToggle: () => void;
}) {
  const items = group.items.filter((i) => !i.permission || hasPerm(i.permission));
  if (items.length === 0) return null;

  return (
    <div className="nav-group">
      <button type="button" className={`nav-group-header ${open ? "open" : ""}`} onClick={onToggle}>
        <span>{group.label}</span>
        <span className="chev">▸</span>
      </button>
      {open && (
        <div className="nav-group-items">
          {items.map((i) => (
            <NavLink key={i.path} to={i.path} className={({ isActive }) => (isActive ? "active" : "")}>
              {i.label}
            </NavLink>
          ))}
        </div>
      )}
    </div>
  );
}

export function Layout() {
  const { user, hasPerm, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const sidebar = useRef<HTMLElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  const [failedLogo, setFailedLogo] = useState<string | null>(null);
  const branding = useQuery({
    queryKey: ["company", "sidebar-branding", user?.id],
    queryFn: async () => (await api.get("/settings/branding")).data as { name: string; logoUrl: string | null },
    enabled: !isPlatformConsole && !!user,
  });
  const tenantLogo = branding.data?.logoUrl;
  const logo = !isPlatformConsole && tenantLogo && tenantLogo !== failedLogo ? tenantLogo : APP_ICON;
  const closeMobile = () => { setMobileOpen(false); menuButton.current?.focus(); };
  useEffect(() => { setMobileOpen(false); }, [location.pathname]);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 1024px)");
    const onChange = () => { if (!media.matches) setMobileOpen(false); };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  useEffect(() => {
    if (!mobileOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden"; document.body.dataset.mobileNav = "open";
    const focusable = () => [...(sidebar.current?.querySelectorAll<HTMLElement>('a[href],button:not(:disabled)') ?? [])].filter(el => el.getClientRects().length > 0);
    focusable()[0]?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setMobileOpen(false); menuButton.current?.focus(); }
      if (event.key !== "Tab") return;
      const elements = focusable(), first = elements[0], last = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    };
    document.addEventListener("keydown", key);
    return () => { document.body.style.overflow = previousOverflow; delete document.body.dataset.mobileNav; document.removeEventListener("keydown", key); };
  }, [mobileOpen]);

  // Accordion: only one group open at a time. Start with the group that owns
  // the current route expanded.
  const activeGroup = NAV.find((e): e is NavGroup =>
    isGroup(e) && e.items.some((i) => (!i.permission || hasPerm(i.permission)) && location.pathname.startsWith(i.path)),
  )?.label ?? null;
  const currentPage = NAV.flatMap(entry => isGroup(entry) ? entry.items : [entry]).find(item => location.pathname === item.path)?.label ?? "Workspace";
  const [openGroup, setOpenGroup] = useState<string | null>(activeGroup);

  async function onLogout() {
    try { await api.post("/auth/logout", {}); } catch { /* ignore */ }
    logout();
    navigate("/login");
  }

  return (
    <div className={`shell ${mobileOpen ? "mobile-nav-open" : ""}`}>
      {mobileOpen && <button className="sidebar-backdrop" aria-label="Close navigation" tabIndex={-1} onClick={closeMobile} />}
      <aside id="main-navigation" ref={sidebar} className="sidebar" aria-label="Main navigation" onClick={e => { if (e.target instanceof Element && e.target.closest("a")) closeMobile(); }}>
        <div className="brand"><img className="sidebar-logo" src={logo} alt={isPlatformConsole ? APP_NAME : branding.data?.name || APP_NAME} onError={() => { if (tenantLogo) setFailedLogo(tenantLogo); }} /><span className="sidebar-brand-name">{isPlatformConsole ? APP_NAME : branding.data?.name || APP_NAME}</span><button type="button" className="mobile-nav-close" aria-label="Close navigation" onClick={closeMobile}>×</button></div>
        {NAV.map((entry) =>
          isGroup(entry) ? (
            <NavGroupView
              key={entry.label}
              group={entry}
              hasPerm={hasPerm}
              open={openGroup === entry.label}
              onToggle={() => setOpenGroup((cur) => (cur === entry.label ? null : entry.label))}
            />
          ) : (!entry.permission || hasPerm(entry.permission)) ? (
            <NavLink key={entry.path} to={entry.path} className={({ isActive }) => (isActive ? "active" : "")}>
              {entry.label}
            </NavLink>
          ) : null
        )}
      </aside>
      <div className="main">
        <header className="topbar">
          <div className="workspace-context"><span>{isPlatformConsole ? "Platform" : "Workspace"}</span><span className="context-divider" aria-hidden="true">/</span><strong>{currentPage}</strong></div>
          <div className="mobile-nav-heading"><button type="button" ref={menuButton} className="mobile-nav-toggle" aria-label="Open navigation" aria-controls="main-navigation" aria-expanded={mobileOpen} onClick={() => setMobileOpen(!mobileOpen)}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18" /></svg></button><span className="mobile-brand">{APP_NAME}</span></div>
          <div className="who">
            <span data-theme-picker />
            <span className="user-avatar" aria-hidden="true">{user?.name?.trim().slice(0, 1).toUpperCase() || "U"}</span>
            <span className="who-identity" title={`${user?.name ?? ""} · ${user?.email ?? ""}`}>{user?.name}<span className="who-email"> · {user?.email}</span></span>
            <button className="small" style={{ marginLeft: 12 }} onClick={onLogout}>Logout</button>
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
