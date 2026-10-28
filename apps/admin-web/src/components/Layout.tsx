import { useState } from "react";
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

  // Accordion: only one group open at a time. Start with the group that owns
  // the current route expanded.
  const activeGroup = NAV.find((e): e is NavGroup =>
    isGroup(e) && e.items.some((i) => (!i.permission || hasPerm(i.permission)) && location.pathname.startsWith(i.path)),
  )?.label ?? null;
  const [openGroup, setOpenGroup] = useState<string | null>(activeGroup);

  async function onLogout() {
    try { await api.post("/auth/logout", {}); } catch { /* ignore */ }
    logout();
    navigate("/login");
  }

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="brand">{isPlatformConsole ? "FII Platform" : "FII Billing"}</div>
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
          <div />
          <div className="who">
            {user?.name} · {user?.email}{" "}
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
