import { Navigate, Outlet, Route, Routes, useParams } from "react-router-dom";
import { useAuth } from "@/stores/auth";
import { can, firstAllowedPath } from "@/lib/access";
import { AppLayout } from "@/layouts/AppLayout";
import { LoginPage } from "@/modules/auth/LoginPage";
import { DashboardPage } from "@/modules/dashboard/DashboardPage";
import { PosPage } from "@/modules/orders/PosPage";
import { OrdersPage, OrderDetailPage } from "@/modules/orders/OrdersPage";
import { CustomersPage } from "@/modules/customers/CustomersPage";
import { CustomerDetailPage } from "@/modules/customers/CustomerDetailPage";
import { CatalogPage } from "@/modules/catalog/CatalogPage";
import { QuotationsPage, QuotationDetailPage } from "@/modules/quotations/QuotationsPage";
import { ProductionPage } from "@/modules/production/ProductionPage";
import { InventoryPage } from "@/modules/inventory/InventoryPage";
import { FinancePage } from "@/modules/finance/FinancePage";
import { ReportsPage } from "@/modules/reports/ReportsPage";
import { SettingsPage } from "@/modules/settings/SettingsPage";
import { PublicDesignPage, PublicMembershipPage, PublicQuotationPage } from "@/modules/public/PublicPages";
import { Skeleton } from "@/components/ui";

function Guard() {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="grid min-h-screen place-items-center bg-paper p-6">
        <div className="w-full max-w-sm space-y-3">
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-24 w-full" />
          <p className="text-center text-[13px] text-ink/50">Loading workspace…</p>
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function RequirePermission({ anyOf }: { anyOf: string[] }) {
  const user = useAuth((s) => s.user);
  if (!can(user, anyOf, "any")) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-lg font-semibold">You don’t have access</h1>
        <p className="mt-2 text-[13px] text-ink/55">This area is limited by your role. Ask an owner to grant the permission if you need it.</p>
      </div>
    );
  }
  return <Outlet />;
}

function HomeRoute() {
  const user = useAuth((s) => s.user);
  if (can(user, ["reports.view", "orders.view"], "any")) return <DashboardPage />;
  const next = firstAllowedPath(user);
  if (next === "/") {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <h1 className="text-lg font-semibold">You don’t have access</h1>
        <p className="mt-2 text-[13px] text-ink/55">This account has no modules assigned. Ask an owner to grant a role.</p>
      </div>
    );
  }
  return <Navigate to={next} replace />;
}

function CustomerRoute() {
  const { id = "" } = useParams();
  return <CustomerDetailPage id={id} />;
}

function QuotationRoute() {
  const { id = "" } = useParams();
  return <QuotationDetailPage id={id} />;
}

export function AppRoutes() {
  const user = useAuth((s) => s.user);
  return (
    <Routes>
      <Route path="/login" element={user ? <Navigate to="/" replace /> : <LoginPage />} />
      <Route path="/approve/quotation/:token" element={<PublicQuotationPage />} />
      <Route path="/approve/design/:token" element={<PublicDesignPage />} />
      <Route path="/card/:token" element={<PublicMembershipPage />} />
      <Route element={<Guard />}>
        <Route element={<AppLayout />}>
          <Route index element={<HomeRoute />} />
          <Route element={<RequirePermission anyOf={["orders.create"]} />}>
            <Route path="pos" element={<PosPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["customers.view"]} />}>
            <Route path="customers" element={<CustomersPage />} />
            <Route path="customers/:id" element={<CustomerRoute />} />
          </Route>
          <Route element={<RequirePermission anyOf={["catalog.view"]} />}>
            <Route path="catalog" element={<CatalogPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["quotations.view"]} />}>
            <Route path="quotations" element={<QuotationsPage />} />
            <Route path="quotations/:id" element={<QuotationRoute />} />
          </Route>
          <Route element={<RequirePermission anyOf={["orders.view"]} />}>
            <Route path="orders" element={<OrdersPage />} />
            <Route path="orders/:id" element={<OrderDetailPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["production.view"]} />}>
            <Route path="production" element={<ProductionPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["inventory.view"]} />}>
            <Route path="inventory" element={<InventoryPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["finance.view"]} />}>
            <Route path="finance" element={<FinancePage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["reports.view"]} />}>
            <Route path="reports" element={<ReportsPage />} />
          </Route>
          <Route element={<RequirePermission anyOf={["settings.manage", "settings.owner", "users.view", "roles.manage"]} />}>
            <Route path="settings" element={<SettingsPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to={user ? firstAllowedPath(user) : "/login"} replace />} />
    </Routes>
  );
}
