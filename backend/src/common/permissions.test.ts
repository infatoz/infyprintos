import { describe, expect, it } from "vitest";
import { hasPermission, modulesForPermissions, permissionsNotHeld, resolvePermissions } from "./permissions";
import { creditAvailable, wouldExceedCredit } from "./credit";

describe("hasPermission", () => {
  it("grants owner every permission", () => {
    expect(hasPermission({ roleSlug: "owner", permissions: [] }, "finance.view")).toBe(true);
  });

  it("requires all listed permissions by default", () => {
    const actor = { roleSlug: "order_manager", permissions: ["orders.view", "orders.create"] };
    expect(hasPermission(actor, ["orders.view", "orders.create"])).toBe(true);
    expect(hasPermission(actor, ["orders.view", "orders.cancel"])).toBe(false);
  });

  it("supports any-of checks", () => {
    const actor = { roleSlug: "viewer", permissions: ["reports.view"] };
    expect(hasPermission(actor, ["finance.view", "reports.view"], "any")).toBe(true);
  });
});

describe("resolvePermissions", () => {
  it("expands owner to the full catalog", () => {
    expect(resolvePermissions({ slug: "owner", permissions: [] }).length).toBeGreaterThan(10);
  });

  it("applies grant and revoke overrides", () => {
    const perms = resolvePermissions(
      { slug: "viewer", permissions: ["reports.view"] },
      { grant: ["customers.create"], revoke: ["reports.view"] }
    );
    expect(perms).toContain("customers.create");
    expect(perms).not.toContain("reports.view");
  });
});

describe("module access", () => {
  it("maps permissions to assigned modules", () => {
    const modules = modulesForPermissions(["orders.view", "orders.change_status"]);
    expect(modules.map((m) => m.id)).toEqual(expect.arrayContaining(["overview", "orders"]));
    expect(modules.map((m) => m.id)).not.toContain("finance");
    expect(permissionsNotHeld({ roleSlug: "viewer", permissions: ["orders.view"] }, ["orders.view", "finance.view"])).toEqual([
      "finance.view"
    ]);
    expect(permissionsNotHeld({ roleSlug: "owner", permissions: [] }, ["finance.view"])).toEqual([]);
  });
});

describe("credit rules", () => {
  it("computes available credit", () => {
    expect(creditAvailable(50000, 12000)).toBe(38000);
  });

  it("blocks credit hold", () => {
    expect(wouldExceedCredit({ creditHold: true, creditLimit: 0, outstanding: 0, additionalBalance: 0, prepaidRequiresFullPay: false, balanceDue: 0 }).blocked).toBe(true);
  });

  it("blocks unpaid prepaid confirmation", () => {
    const result = wouldExceedCredit({
      creditHold: false,
      creditLimit: 0,
      outstanding: 0,
      additionalBalance: 500,
      prepaidRequiresFullPay: true,
      balanceDue: 500
    });
    expect(result.reason).toMatch(/Prepaid/);
  });

  it("blocks over-limit balances", () => {
    const result = wouldExceedCredit({
      creditHold: false,
      creditLimit: 1000,
      outstanding: 800,
      additionalBalance: 400,
      prepaidRequiresFullPay: false,
      balanceDue: 400
    });
    expect(result.blocked).toBe(true);
  });

  it("blocks a blocked customer even with available credit", () => {
    const result = wouldExceedCredit({
      creditHold: false,
      creditLimit: 50_000,
      outstanding: 0,
      additionalBalance: 100,
      prepaidRequiresFullPay: false,
      balanceDue: 100,
      lifecycleStatus: "blocked"
    });
    expect(result.blocked).toBe(true);
    expect(result.reason).toMatch(/blocked/i);
  });
});
