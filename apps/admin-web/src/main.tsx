import { installResponsiveTables } from "../../../packages/browser/src/responsive-tables";
import { installPwa } from "../../../packages/browser/src/pwa";
import { installThemePicker } from "../../../packages/browser/src/themes";
import React from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Layout } from "./components/Layout";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { LoginPage } from "./features/auth/LoginPage";
import { AccountRecoveryPage } from "./features/auth/AccountRecoveryPage";
import { DashboardPage } from "./features/dashboard/DashboardPage";
import { UsersPage } from "./features/users/UsersPage";
import { RolesPage } from "./features/roles/RolesPage";
import { AuditPage } from "./features/audit/AuditPage";
import { CustomersPage } from "./features/customers/CustomersPage";
import { PlansPage } from "./features/plans/PlansPage";
import { SubscribersPage } from "./features/subscribers/SubscribersPage";
import { SettingsPage } from "./features/settings/SettingsPage";
import { InvoicesPage } from "./features/invoices/InvoicesPage";
import { NewInvoicePage } from "./features/invoices/NewInvoicePage";
import { SalesDocumentsPage } from "./features/quotations/SalesDocumentsPage";
import { SalesDocumentForm } from "./features/quotations/SalesDocumentForm";
import { NotesPage } from "./features/notes/NotesPage";
import { PaymentsPage } from "./features/payments/PaymentsPage";
import { FinancialControlsPage } from "./features/accounting/FinancialControlsPage";
import { BillingRunsPage } from "./features/billing-runs/BillingRunsPage";
import { NotificationsPage } from "./features/notifications/NotificationsPage";
import { SuppliersPage } from "./features/suppliers/SuppliersPage";
import { ProductsPage } from "./features/inventory/ProductsPage";
import { PurchaseInvoicesPage } from "./features/purchases/PurchaseInvoicesPage";
import { NewPurchaseInvoicePage } from "./features/purchases/NewPurchaseInvoicePage";
import { PurchaseOrdersPage } from "./features/purchases/PurchaseOrdersPage";
import { PurchaseReturnsPage } from "./features/purchases/PurchaseReturnsPage";
import { NewPurchaseOrderPage } from "./features/purchases/NewPurchaseOrderPage";
import { ExpensesPage } from "./features/expenses/ExpensesPage";
import { EmployeesPage } from "./features/hr/EmployeesPage";
import { AttendancePage } from "./features/hr/AttendancePage";
import { PayrollPage } from "./features/hr/PayrollPage";
import { DayBookPage } from "./features/accounting/DayBookPage";
import { SalesReportPage, PurchaseReportPage, CollectionsReportPage, OutstandingReportPage, ProfitLossPage } from "./features/accounting/ReportsPage";
import { ExportsPage } from "./features/accounting/ExportsPage";
import { ProfitLossTallyPage, BalanceSheetPage } from "./features/accounting/TallyReportsPage";
import { CustomerLedgerPage, SupplierLedgerPage } from "./features/accounting/LedgerPage";
import { GstPage } from "./features/accounting/GstPage";
import { BackupPage } from "./features/backup/BackupPage";
import { TenantsPage } from "./features/platform/TenantsPage";
import { ComplaintsPage } from "./features/helpdesk/ComplaintsPage";
import { TasksPage } from "./features/helpdesk/TasksPage";
import "./styles.css";
import "../../../packages/browser/src/mobile.css";
import "../../../packages/browser/src/pwa.css";
import "../../../packages/browser/src/theme.css";
import { isPlatformConsole } from "./lib/console";
import { installEnterNavigation } from "../../../packages/browser/src/enter-navigation";

const removeEnterNavigation = installEnterNavigation();
const removeThemePicker = installThemePicker();
const removeResponsiveTables = installResponsiveTables();
const removePwa = import.meta.env.PROD ? installPwa() : () => {};
import.meta.hot?.dispose(() => { removeResponsiveTables(); removePwa(); removeThemePicker(); });
import.meta.hot?.dispose(removeEnterNavigation);

const qc = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <QueryClientProvider client={qc}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<AccountRecoveryPage />} />
          <Route path="/reset-password" element={<AccountRecoveryPage />} />
          <Route path="/verify-email" element={<AccountRecoveryPage />} />
          {isPlatformConsole ? <Route element={<ProtectedRoute permission="platform:read"><Layout /></ProtectedRoute>}>
            <Route path="/platform/tenants" element={<TenantsPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="*" element={<Navigate to="/platform/tenants" replace />} />
          </Route> : <Route element={<ProtectedRoute><Layout /></ProtectedRoute>}>
            <Route path="/" element={<Navigate to="/dashboard" replace />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/invoices" element={<ProtectedRoute permission="invoice:read"><InvoicesPage /></ProtectedRoute>} />
            <Route path="/quotations" element={<ProtectedRoute permission="invoice:read"><SalesDocumentsPage key="quotations" kind="QUOTATION" /></ProtectedRoute>} />
            <Route path="/quotations/new" element={<ProtectedRoute permission="invoice:create"><SalesDocumentForm kind="QUOTATION" /></ProtectedRoute>} />
            <Route path="/quotations/:id/edit" element={<ProtectedRoute permission="invoice:read"><SalesDocumentForm kind="QUOTATION" /></ProtectedRoute>} />
            <Route path="/proformas" element={<ProtectedRoute permission="invoice:read"><SalesDocumentsPage key="proformas" kind="PROFORMA" /></ProtectedRoute>} />
            <Route path="/proformas/new" element={<ProtectedRoute permission="invoice:create"><SalesDocumentForm kind="PROFORMA" /></ProtectedRoute>} />
            <Route path="/proformas/:id/edit" element={<ProtectedRoute permission="invoice:read"><SalesDocumentForm kind="PROFORMA" /></ProtectedRoute>} />
            <Route path="/invoices/new" element={<ProtectedRoute permission="invoice:create"><NewInvoicePage /></ProtectedRoute>} />
            <Route path="/invoices/:id/edit" element={<ProtectedRoute permission="invoice:update"><NewInvoicePage /></ProtectedRoute>} />
            <Route path="/notes" element={<ProtectedRoute permission="credit_note:read"><NotesPage /></ProtectedRoute>} />
            <Route path="/payments" element={<ProtectedRoute permission="payment:read"><PaymentsPage /></ProtectedRoute>} />
            <Route path="/billing-runs" element={<ProtectedRoute permission="billing_run:read"><BillingRunsPage /></ProtectedRoute>} />
            <Route path="/notifications" element={<ProtectedRoute permission="notification_template:read"><NotificationsPage /></ProtectedRoute>} />
            <Route path="/suppliers" element={<ProtectedRoute permission="supplier:read"><SuppliersPage /></ProtectedRoute>} />
            <Route path="/products" element={<ProtectedRoute permission="product:read"><ProductsPage /></ProtectedRoute>} />
            <Route path="/purchases" element={<ProtectedRoute permission="purchase_invoice:read"><PurchaseInvoicesPage /></ProtectedRoute>} />
            <Route path="/purchases/new" element={<ProtectedRoute permission="purchase_invoice:create"><NewPurchaseInvoicePage /></ProtectedRoute>} />
            <Route path="/purchase-orders" element={<ProtectedRoute permission="purchase_order:read"><PurchaseOrdersPage /></ProtectedRoute>} />
            <Route path="/purchase-returns" element={<ProtectedRoute permission="purchase_return:read"><PurchaseReturnsPage /></ProtectedRoute>} />
            <Route path="/purchase-orders/new" element={<ProtectedRoute permission="purchase_order:create"><NewPurchaseOrderPage /></ProtectedRoute>} />
            <Route path="/expenses" element={<ProtectedRoute permission="expense:read"><ExpensesPage /></ProtectedRoute>} />
            <Route path="/employees" element={<ProtectedRoute permission="employee:read"><EmployeesPage /></ProtectedRoute>} />
            <Route path="/attendance" element={<ProtectedRoute permission="attendance:read"><AttendancePage /></ProtectedRoute>} />
            <Route path="/payroll" element={<ProtectedRoute permission="payroll:read"><PayrollPage /></ProtectedRoute>} />
            <Route path="/financial-controls" element={<ProtectedRoute permission="report:read"><FinancialControlsPage /></ProtectedRoute>} />
            <Route path="/day-book" element={<ProtectedRoute permission="day_book:read"><DayBookPage /></ProtectedRoute>} />
            <Route path="/reports/sales" element={<ProtectedRoute permission="report:read"><SalesReportPage /></ProtectedRoute>} />
            <Route path="/reports/purchases" element={<ProtectedRoute permission="report:read"><PurchaseReportPage /></ProtectedRoute>} />
            <Route path="/reports/collections" element={<ProtectedRoute permission="report:read"><CollectionsReportPage /></ProtectedRoute>} />
            <Route path="/reports/outstanding" element={<ProtectedRoute permission="report:read"><OutstandingReportPage /></ProtectedRoute>} />
            <Route path="/reports/profit-loss" element={<ProtectedRoute permission="report:read"><ProfitLossPage /></ProtectedRoute>} />
            <Route path="/ledger/customers" element={<ProtectedRoute permission="report:read"><CustomerLedgerPage /></ProtectedRoute>} />
            <Route path="/ledger/suppliers" element={<ProtectedRoute permission="report:read"><SupplierLedgerPage /></ProtectedRoute>} />
            <Route path="/reports/pnl-tally" element={<ProtectedRoute permission="report:read"><ProfitLossTallyPage /></ProtectedRoute>} />
            <Route path="/reports/balance-sheet" element={<ProtectedRoute permission="report:read"><BalanceSheetPage /></ProtectedRoute>} />
            <Route path="/exports" element={<ProtectedRoute permission="report:export"><ExportsPage /></ProtectedRoute>} />
            <Route path="/gst" element={<ProtectedRoute permission="gst_report:read"><GstPage /></ProtectedRoute>} />
            <Route path="/complaints" element={<ProtectedRoute permission="complaint:read"><ComplaintsPage /></ProtectedRoute>} />
            <Route path="/tasks" element={<ProtectedRoute permission="task:read"><TasksPage /></ProtectedRoute>} />
            <Route path="/customers" element={<ProtectedRoute permission="customer:read"><CustomersPage /></ProtectedRoute>} />
            <Route path="/plans" element={<ProtectedRoute permission="plan:read"><PlansPage /></ProtectedRoute>} />
            <Route path="/subscribers" element={<ProtectedRoute permission="subscriber:read"><SubscribersPage /></ProtectedRoute>} />
            <Route path="/settings" element={<ProtectedRoute permission="settings:read"><SettingsPage /></ProtectedRoute>} />
            <Route path="/users" element={<ProtectedRoute permission="user:read"><UsersPage /></ProtectedRoute>} />
            <Route path="/roles" element={<ProtectedRoute permission="role:read"><RolesPage /></ProtectedRoute>} />
            <Route path="/audit" element={<ProtectedRoute permission="audit:read"><AuditPage /></ProtectedRoute>} />
            <Route path="/backup" element={<ProtectedRoute permission="backup:read"><BackupPage /></ProtectedRoute>} />
          </Route>}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
