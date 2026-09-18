import type { AuthUser } from "@/stores/auth";

export const MODULE_ROUTES: Array<{ id: string; label: string; path: string; anyOf: string[] }> = [
  { id: "overview", label: "Overview", path: "/", anyOf: ["reports.view", "orders.view"] },
  { id: "pos", label: "POS", path: "/pos", anyOf: ["orders.create"] },
  { id: "orders", label: "Orders", path: "/orders", anyOf: ["orders.view"] },
  { id: "production", label: "Production", path: "/production", anyOf: ["production.view"] },
  { id: "customers", label: "Customers", path: "/customers", anyOf: ["customers.view"] },
  { id: "quotations", label: "Quotations", path: "/quotations", anyOf: ["quotations.view"] },
  { id: "catalog", label: "Catalog", path: "/catalog", anyOf: ["catalog.view"] },
  { id: "inventory", label: "Inventory", path: "/inventory", anyOf: ["inventory.view"] },
  { id: "finance", label: "Finance", path: "/finance", anyOf: ["finance.view"] },
  { id: "reports", label: "Reports", path: "/reports", anyOf: ["reports.view"] },
  { id: "admin", label: "Admin", path: "/settings", anyOf: ["settings.manage", "settings.owner", "users.view", "roles.manage"] }
];

export function actorPermissions(user: AuthUser | null | undefined) {
  if (!user) return [];
  if (user.role?.slug === "owner") return user.permissions?.length ? user.permissions : ["settings.owner"];
  return user.permissions ?? user.role?.permissions ?? [];
}

export function can(user: AuthUser | null | undefined, needed: string | string[], mode: "all" | "any" = "all") {
  if (!user) return false;
  if (user.role?.slug === "owner") return true;
  const list = Array.isArray(needed) ? needed : [needed];
  const perms = actorPermissions(user);
  return mode === "all" ? list.every((p) => perms.includes(p)) : list.some((p) => perms.includes(p));
}

export function modulesForUser(user: AuthUser | null | undefined) {
  if (!user) return [];
  if (user.role?.slug === "owner") return MODULE_ROUTES.map((m) => ({ id: m.id, label: m.label, path: m.path }));
  return MODULE_ROUTES.filter((m) => can(user, m.anyOf, "any")).map((m) => ({ id: m.id, label: m.label, path: m.path }));
}

export function firstAllowedPath(user: AuthUser | null | undefined) {
  return modulesForUser(user)[0]?.path ?? "/";
}

export function modulesFromPermissions(permissions: string[], roleSlug?: string) {
  if (roleSlug === "owner") return MODULE_ROUTES.map((m) => ({ id: m.id, label: m.label, path: m.path }));
  return MODULE_ROUTES.filter((m) => m.anyOf.some((p) => permissions.includes(p))).map((m) => ({
    id: m.id,
    label: m.label,
    path: m.path
  }));
}
