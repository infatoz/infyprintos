export const PERMISSIONS = [
  "customers.view",
  "customers.create",
  "customers.update",
  "customers.delete",
  "customers.kyc",
  "customers.credit",
  "catalog.view",
  "catalog.create",
  "catalog.update",
  "catalog.delete",
  "quotations.view",
  "quotations.create",
  "quotations.update",
  "quotations.delete",
  "quotations.send",
  "orders.view",
  "orders.create",
  "orders.edit",
  "orders.cancel",
  "orders.approve",
  "orders.change_status",
  "orders.view_cost",
  "orders.price_override",
  "designs.manage",
  "production.view",
  "production.manage",
  "inventory.view",
  "inventory.adjust",
  "inventory.purchase",
  "finance.view",
  "finance.create_expense",
  "finance.approve_expense",
  "finance.payments",
  "reports.view",
  "reports.export",
  "users.view",
  "users.manage",
  "roles.manage",
  "settings.manage",
  "settings.owner",
  "audit.view"
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_SET = new Set<string>(PERMISSIONS);

export const PERMISSION_GROUPS: Array<{ id: string; label: string; permissions: Permission[] }> = [
  { id: "customers", label: "Customers", permissions: ["customers.view", "customers.create", "customers.update", "customers.delete", "customers.kyc", "customers.credit"] },
  { id: "catalog", label: "Catalog", permissions: ["catalog.view", "catalog.create", "catalog.update", "catalog.delete"] },
  { id: "quotations", label: "Quotations", permissions: ["quotations.view", "quotations.create", "quotations.update", "quotations.delete", "quotations.send"] },
  { id: "orders", label: "Orders & POS", permissions: ["orders.view", "orders.create", "orders.edit", "orders.cancel", "orders.approve", "orders.change_status", "orders.view_cost", "orders.price_override"] },
  { id: "designs", label: "Design", permissions: ["designs.manage"] },
  { id: "production", label: "Production", permissions: ["production.view", "production.manage"] },
  { id: "inventory", label: "Inventory", permissions: ["inventory.view", "inventory.adjust", "inventory.purchase"] },
  { id: "finance", label: "Finance", permissions: ["finance.view", "finance.create_expense", "finance.approve_expense", "finance.payments"] },
  { id: "reports", label: "Reports", permissions: ["reports.view", "reports.export"] },
  { id: "access", label: "People & roles", permissions: ["users.view", "users.manage", "roles.manage"] },
  { id: "settings", label: "Settings", permissions: ["settings.manage", "settings.owner"] },
  { id: "audit", label: "Audit", permissions: ["audit.view"] }
];

export const PERMISSION_LABELS: Record<Permission, string> = {
  "customers.view": "View customers",
  "customers.create": "Create customers",
  "customers.update": "Edit customers",
  "customers.delete": "Delete customers",
  "customers.kyc": "Manage KYC",
  "customers.credit": "Change credit limits",
  "catalog.view": "View catalog",
  "catalog.create": "Create items",
  "catalog.update": "Edit items",
  "catalog.delete": "Delete items",
  "quotations.view": "View quotations",
  "quotations.create": "Create quotations",
  "quotations.update": "Edit quotations",
  "quotations.delete": "Delete quotations",
  "quotations.send": "Send quotations",
  "orders.view": "View orders",
  "orders.create": "Create orders / POS",
  "orders.edit": "Edit draft orders",
  "orders.cancel": "Cancel orders",
  "orders.approve": "Confirm orders",
  "orders.change_status": "Move order status",
  "orders.view_cost": "View job cost",
  "orders.price_override": "Override prices",
  "designs.manage": "Upload artwork",
  "production.view": "View production",
  "production.manage": "Run production",
  "inventory.view": "View inventory",
  "inventory.adjust": "Adjust stock",
  "inventory.purchase": "Record purchases",
  "finance.view": "View finance",
  "finance.create_expense": "Record expenses",
  "finance.approve_expense": "Approve expenses",
  "finance.payments": "Record collections",
  "reports.view": "View reports",
  "reports.export": "Export reports",
  "users.view": "View staff",
  "users.manage": "Create and edit staff",
  "roles.manage": "Create and edit roles",
  "settings.manage": "Manage organisation",
  "settings.owner": "Owner-only settings",
  "audit.view": "View audit log"
};

export const ACCESS_MODULES: Array<{ id: string; label: string; path: string; anyOf: Permission[] }> = [
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

export function modulesForPermissions(permissions: readonly string[], roleSlug?: string) {
  if (roleSlug === "owner") return ACCESS_MODULES.map((m) => ({ id: m.id, label: m.label, path: m.path }));
  return ACCESS_MODULES.filter((m) => m.anyOf.some((p) => permissions.includes(p))).map((m) => ({
    id: m.id,
    label: m.label,
    path: m.path
  }));
}

export function permissionsNotHeld(actor: { roleSlug: string; permissions: readonly string[] }, requested: readonly string[]) {
  if (actor.roleSlug === "owner") return [] as Permission[];
  const held = new Set(actor.permissions);
  return sanitizePermissions(requested).filter((p) => !held.has(p));
}

export function slugifyRole(name: string) {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") || "role";
}

export function sanitizePermissions(list: unknown, opts?: { allowOwnerKey?: boolean }) {
  const raw = Array.isArray(list) ? list.filter((p): p is string => typeof p === "string") : [];
  const unique = [...new Set(raw.filter((p) => PERMISSION_SET.has(p)))] as Permission[];
  if (opts?.allowOwnerKey) return unique;
  return unique.filter((p) => p !== "settings.owner");
}

export const DEFAULT_ROLES: Record<string, { name: string; description: string; permissions: Permission[]; system: boolean }> = {
  owner: {
    name: "Owner",
    description: "Complete control of the business",
    system: true,
    permissions: [...PERMISSIONS]
  },
  administrator: {
    name: "Administrator",
    description: "All operational access except owner-only configuration",
    system: true,
    permissions: PERMISSIONS.filter((p) => p !== "settings.owner")
  },
  order_manager: {
    name: "Order Manager",
    description: "Customers, quotations, orders, design approvals, production and delivery",
    system: true,
    permissions: [
      "customers.view",
      "customers.create",
      "customers.update",
      "catalog.view",
      "catalog.create",
      "catalog.update",
      "quotations.view",
      "quotations.create",
      "quotations.update",
      "quotations.send",
      "orders.view",
      "orders.create",
      "orders.edit",
      "orders.approve",
      "orders.change_status",
      "orders.cancel",
      "designs.manage",
      "production.view",
      "production.manage",
      "inventory.view",
      "finance.payments",
      "reports.view"
    ]
  },
  viewer: {
    name: "Viewer",
    description: "Read-only dashboards and reports",
    system: true,
    permissions: ["customers.view", "catalog.view", "quotations.view", "orders.view", "production.view", "inventory.view", "finance.view", "reports.view"]
  },
  production_manager: {
    name: "Production Manager",
    description: "Production queue, machines and quality checks",
    system: true,
    permissions: ["orders.view", "orders.change_status", "production.view", "production.manage", "inventory.view", "designs.manage"]
  },
  designer: {
    name: "Designer",
    description: "Artwork upload and design revisions",
    system: true,
    permissions: ["orders.view", "designs.manage", "customers.view"]
  },
  inventory_manager: {
    name: "Inventory Manager",
    description: "Stock, purchases, consumption and wastage",
    system: true,
    permissions: ["inventory.view", "inventory.adjust", "inventory.purchase", "catalog.view", "reports.view"]
  },
  accountant: {
    name: "Accountant",
    description: "Invoices, payments, expenses and financial reports",
    system: true,
    permissions: [
      "orders.view",
      "orders.view_cost",
      "finance.view",
      "finance.create_expense",
      "finance.approve_expense",
      "finance.payments",
      "reports.view",
      "reports.export",
      "customers.view",
      "customers.credit"
    ]
  },
  delivery_executive: {
    name: "Delivery Executive",
    description: "Dispatch and delivery confirmation",
    system: true,
    permissions: ["orders.view", "orders.change_status"]
  },
  customer: {
    name: "Customer",
    description: "Customer portal access",
    system: true,
    permissions: []
  }
};

export function resolvePermissions(
  role: { slug: string; permissions?: string[] | null },
  overrides?: { grant?: string[] | null; revoke?: string[] | null } | null
) {
  if (role.slug === "owner") return [...PERMISSIONS];
  const grant = new Set<string>([...(role.permissions ?? []), ...(overrides?.grant ?? [])]);
  for (const p of overrides?.revoke ?? []) grant.delete(p);
  return [...grant] as Permission[];
}

export function hasPermission(
  actor: { roleSlug: string; permissions: readonly string[] },
  needed: Permission | Permission[],
  mode: "all" | "any" = "all"
) {
  if (actor.roleSlug === "owner") return true;
  const list = Array.isArray(needed) ? needed : [needed];
  return mode === "all" ? list.every((p) => actor.permissions.includes(p)) : list.some((p) => actor.permissions.includes(p));
}

