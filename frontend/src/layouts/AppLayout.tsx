import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useEffect, useMemo, useState } from "react";
import {
  LayoutDashboard,
  ShoppingCart,
  Users,
  Package,
  FileText,
  ClipboardList,
  Factory,
  Warehouse,
  Wallet,
  BarChart3,
  Settings,
  LogOut,
  Search,
  Moon,
  Sun,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen
} from "lucide-react";
import { useAuth } from "@/stores/auth";
import { useTheme } from "@/stores/theme";
import { can } from "@/lib/access";
import { cn, initials } from "@/lib/cn";
import { CommandPalette } from "@/components/CommandPalette";

const GROUPS = [
  {
    label: "Floor",
    items: [
      { to: "/", label: "Overview", icon: LayoutDashboard, anyOf: ["reports.view", "orders.view"] },
      { to: "/pos", label: "POS", icon: ShoppingCart, anyOf: ["orders.create"] },
      { to: "/orders", label: "Orders", icon: ClipboardList, anyOf: ["orders.view"] },
      { to: "/production", label: "Production", icon: Factory, anyOf: ["production.view"] }
    ]
  },
  {
    label: "Commerce",
    items: [
      { to: "/customers", label: "Customers", icon: Users, anyOf: ["customers.view"] },
      { to: "/quotations", label: "Quotations", icon: FileText, anyOf: ["quotations.view"] },
      { to: "/catalog", label: "Catalog", icon: Package, anyOf: ["catalog.view"] }
    ]
  },
  {
    label: "Back office",
    items: [
      { to: "/inventory", label: "Inventory", icon: Warehouse, anyOf: ["inventory.view"] },
      { to: "/finance", label: "Finance", icon: Wallet, anyOf: ["finance.view"] },
      { to: "/reports", label: "Reports", icon: BarChart3, anyOf: ["reports.view"] },
      { to: "/settings", label: "Admin", icon: Settings, anyOf: ["settings.manage", "settings.owner", "users.view", "roles.manage"] }
    ]
  }
];

const SIDEBAR_KEY = "infatoz_sidebar";

function clockLabel(tz = "Asia/Kolkata") {
  try {
    return new Intl.DateTimeFormat("en-IN", {
      timeZone: tz,
      weekday: "short",
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit"
    }).format(new Date());
  } catch {
    return "";
  }
}

function readCollapsed() {
  try {
    return localStorage.getItem(SIDEBAR_KEY) === "collapsed";
  } catch {
    return false;
  }
}

export function AppLayout() {
  const { user, logout, hydrate } = useAuth();
  const { theme, toggle } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [now, setNow] = useState(() => clockLabel(user?.organization?.timezone));
  const isPos = location.pathname === "/pos";

  const groups = useMemo(
    () =>
      GROUPS.map((g) => ({
        ...g,
        items: g.items.filter((item) => can(user, item.anyOf, "any"))
      })).filter((g) => g.items.length),
    [user]
  );
  const items = groups.flatMap((g) => g.items);
  const mobilePrimary = items.slice(0, 4);
  const mobileMore = items.slice(4);
  const orgName = user?.organization?.name || "Infy PrintOS";
  const branchName = user?.branch?.code || user?.branch?.name;

  function toggleSidebar() {
    setCollapsed((v) => {
      const next = !v;
      try {
        localStorage.setItem(SIDEBAR_KEY, next ? "collapsed" : "expanded");
      } catch {
        /* ignore */
      }
      return next;
    });
  }

  useEffect(() => {
    const id = window.setInterval(() => setNow(clockLabel(user?.organization?.timezone)), 30_000);
    return () => window.clearInterval(id);
  }, [user?.organization?.timezone]);

  useEffect(() => {
    function refreshAccess() {
      if (document.visibilityState === "hidden") return;
      void hydrate();
    }
    window.addEventListener("focus", refreshAccess);
    document.addEventListener("visibilitychange", refreshAccess);
    return () => {
      window.removeEventListener("focus", refreshAccess);
      document.removeEventListener("visibilitychange", refreshAccess);
    };
  }, [hydrate]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearchOpen((v) => !v);
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        toggleSidebar();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    setMoreOpen(false);
    setSearchOpen(false);
  }, [location.pathname]);

  return (
    <div className="min-h-dvh bg-paper text-ink">
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-30 hidden flex-col bg-sidebar text-sidebar-text transition-[width] duration-200 ease-out lg:flex",
          collapsed ? "w-[72px]" : "w-[248px]"
        )}
      >
        <div className={cn("flex items-center py-4", collapsed ? "flex-col gap-2 px-2" : "gap-3 px-3")}>
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-white/10 text-[11px] font-semibold tracking-wide text-white">IN</div>
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold text-white">{orgName}</div>
              <div className="truncate text-[11px] text-sidebar-text/70">{branchName ? `${branchName} branch` : "Printing ERP"}</div>
            </div>
          )}
          <button
            type="button"
            className="grid h-8 w-8 shrink-0 place-items-center rounded-lg text-sidebar-text/80 hover:bg-white/10 hover:text-white"
            onClick={toggleSidebar}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand (Ctrl+B)" : "Collapse (Ctrl+B)"}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-4">
          {groups.map((group) => (
            <div key={group.label} className="mb-4">
              {!collapsed && (
                <div className="px-2 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-sidebar-text/45">{group.label}</div>
              )}
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <NavLink
                    key={item.to}
                    to={item.to}
                    end={item.to === "/"}
                    title={collapsed ? item.label : undefined}
                    className={({ isActive }) =>
                      cn(
                        "flex items-center rounded-lg py-2 text-[13.5px] text-sidebar-text/80 transition hover:bg-white/5 hover:text-white",
                        collapsed ? "justify-center px-0" : "gap-2.5 px-2.5",
                        isActive && "bg-white/10 font-medium text-white"
                      )
                    }
                  >
                    <item.icon size={16} strokeWidth={1.75} />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </NavLink>
                ))}
              </div>
            </div>
          ))}
        </nav>
        <div className={cn("border-t border-white/10", collapsed ? "p-2" : "p-3")}>
          <div className={cn("mb-1 flex items-center", collapsed ? "justify-center py-1" : "gap-2.5 px-1 py-1")}>
            <div
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/10 text-[11px] font-semibold text-white"
              title={collapsed ? `${user?.name ?? ""} · ${user?.role?.name ?? "Staff"}` : undefined}
            >
              {initials(user?.name)}
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-white">{user?.name}</div>
                <div className="truncate text-[11px] text-sidebar-text/60">{user?.role?.name ?? "Staff"}</div>
              </div>
            )}
          </div>
          <button
            className={cn(
              "flex items-center rounded-lg py-2 text-[13px] text-sidebar-text/70 hover:bg-white/5 hover:text-white",
              collapsed ? "w-full justify-center" : "w-full gap-2 px-2.5"
            )}
            title={collapsed ? "Sign out" : undefined}
            onClick={async () => {
              await logout();
              navigate("/login");
            }}
          >
            <LogOut size={14} />
            {!collapsed && "Sign out"}
          </button>
        </div>
      </aside>

      <div className={cn("transition-[padding] duration-200 ease-out", collapsed ? "lg:pl-[72px]" : "lg:pl-[248px]")}>
        <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-surface/90 px-3 backdrop-blur-md sm:gap-3 sm:px-4 lg:px-6">
          <button
            type="button"
            className="hidden h-9 w-9 shrink-0 place-items-center rounded-lg border border-line hover:bg-paper lg:grid"
            onClick={toggleSidebar}
            aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            title={collapsed ? "Expand sidebar (Ctrl+B)" : "Collapse sidebar (Ctrl+B)"}
          >
            {collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
          <div className="flex items-center gap-2 lg:hidden">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-sidebar text-[10px] font-semibold text-white">IN</div>
            <span className="max-w-[40vw] truncate text-[13px] font-semibold">{orgName}</span>
          </div>
          <button
            type="button"
            className="relative hidden h-9 max-w-xl flex-1 items-center rounded-lg border border-line bg-paper px-3 text-left text-[13px] text-muted transition hover:border-ink/20 md:flex"
            onClick={() => setSearchOpen(true)}
          >
            <Search className="mr-2 h-4 w-4" />
            Search customers, orders, SKUs
            <kbd className="ml-auto hidden rounded-md border border-line bg-surface px-1.5 py-0.5 text-[10px] font-medium text-muted lg:inline">Ctrl K</kbd>
          </button>
          <div className="ml-auto flex items-center gap-2">
            <span className="hidden text-[12px] tabular-nums text-muted sm:block">{now}</span>
            <button type="button" className="grid h-9 w-9 place-items-center rounded-lg md:hidden" aria-label="Search" onClick={() => setSearchOpen(true)}>
              <Search size={16} />
            </button>
            <button
              type="button"
              className="grid h-9 w-9 place-items-center rounded-lg border border-line hover:bg-paper"
              onClick={toggle}
              aria-label="Toggle color theme"
            >
              {theme === "dark" ? <Sun size={15} /> : <Moon size={15} />}
            </button>
          </div>
        </header>
        <main
          className={cn(
            isPos
              ? "max-w-none p-0 pb-[calc(7.25rem+env(safe-area-inset-bottom))] lg:h-[calc(100dvh-3.5rem)] lg:overflow-hidden lg:pb-0"
              : "mx-auto w-full max-w-[1320px] p-3 pb-[calc(6rem+env(safe-area-inset-bottom))] sm:p-4 lg:p-8 lg:pb-8"
          )}
        >
          <Outlet />
        </main>
      </div>

      <nav className="touch-nav fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 px-1 pb-[env(safe-area-inset-bottom)] pt-1 backdrop-blur lg:hidden">
        <div className="grid grid-cols-5">
          {mobilePrimary.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === "/"}
              className={({ isActive }) =>
                cn("flex min-h-11 flex-col items-center justify-center gap-0.5 py-1 text-[10px] font-medium text-muted", isActive && "text-ink")
              }
            >
              <item.icon size={16} />
              {item.label}
            </NavLink>
          ))}
          <button
            type="button"
            className="flex min-h-11 flex-col items-center justify-center gap-0.5 py-1 text-[10px] font-medium text-muted"
            onClick={() => setMoreOpen((v) => !v)}
          >
            <MoreHorizontal size={16} />
            More
          </button>
        </div>
        {moreOpen && (
          <div className="grid grid-cols-3 gap-1 px-2 pb-2 pt-1">
            {mobileMore.map((item) => (
              <NavLink key={item.to} to={item.to} onClick={() => setMoreOpen(false)} className="rounded-lg bg-paper px-2 py-2 text-center text-[11px] font-medium">
                {item.label}
              </NavLink>
            ))}
          </div>
        )}
      </nav>
      <CommandPalette open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  );
}
