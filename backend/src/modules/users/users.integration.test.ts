import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApp, stopTestApp, type TestActors } from "../../test/harness";
import { PERMISSIONS } from "../../common/permissions";
import type { Express } from "express";

describe("Users, roles and permission management", () => {
  let app: Express;
  let actors: TestActors;
  const password = "StaffPass123!";

  beforeAll(async () => {
    const started = await startTestApp();
    app = started.app;
    actors = started.actors;
  }, 60_000);

  afterAll(async () => {
    await stopTestApp();
  });

  async function token(role: "owner" | "admin" | "orderManager" | "viewer") {
    const actor = actors[role];
    const res = await request(app).post("/api/v1/auth/login").send({ email: actor.email, password: actor.password });
    return res.body.data.accessToken as string;
  }

  async function auth(role: "owner" | "admin" | "orderManager" | "viewer") {
    return { Authorization: `Bearer ${await token(role)}` };
  }

  it("returns a grouped permission catalog only to access administrators", async () => {
    const denied = await request(app).get("/api/v1/users/permissions").set(await auth("viewer"));
    expect(denied.status).toBe(403);

    const res = await request(app).get("/api/v1/users/permissions").set(await auth("admin"));
    expect(res.status).toBe(200);
    expect(res.body.data.permissions).toEqual([...PERMISSIONS]);
    expect(res.body.data.groups.some((g: { id: string }) => g.id === "access")).toBe(true);
    expect(res.body.data.modules.some((m: { id: string }) => m.id === "finance")).toBe(true);
    expect(res.body.data.labels["orders.approve"]).toBe("Confirm orders");
  });

  it("blocks Viewer and Order Manager from listing staff", async () => {
    const viewer = await request(app).get("/api/v1/users").set(await auth("viewer"));
    expect(viewer.status).toBe(403);
    const orders = await request(app).get("/api/v1/users").set(await auth("orderManager"));
    expect(orders.status).toBe(403);
  });

  it("lists seeded system roles with member counts", async () => {
    const res = await request(app).get("/api/v1/users/roles").set(await auth("admin"));
    expect(res.status).toBe(200);
    const slugs = res.body.data.map((r: { slug: string }) => r.slug);
    expect(slugs).toEqual(expect.arrayContaining(["owner", "administrator", "order_manager", "viewer"]));
    const owner = res.body.data.find((r: { slug: string }) => r.slug === "owner");
    expect(owner.system).toBe(true);
    expect(owner.memberCount).toBeGreaterThanOrEqual(1);
    expect(owner.permissionCount).toBe(PERMISSIONS.length);
  });

  it("lets an administrator CRUD a custom role and refuses reserved slugs and owner keys", async () => {
    const headers = await auth("admin");
    const created = await request(app)
      .post("/api/v1/users/roles")
      .set(headers)
      .send({
        name: "Night Shift Lead",
        description: "Evening floor coverage",
        permissions: ["orders.view", "orders.change_status", "settings.owner", "not.a.perm"]
      });
    expect(created.status).toBe(201);
    expect(created.body.data.slug).toBe("night_shift_lead");
    expect(created.body.data.system).toBe(false);
    expect(created.body.data.permissions).toEqual(["orders.view", "orders.change_status"]);

    const reserved = await request(app).post("/api/v1/users/roles").set(headers).send({
      name: "Owner",
      slug: "owner",
      permissions: ["orders.view"]
    });
    expect(reserved.status).toBe(409);

    const patched = await request(app)
      .patch(`/api/v1/users/roles/${created.body.data._id}`)
      .set(headers)
      .send({ permissions: ["orders.view", "production.view", "settings.owner"] });
    expect(patched.status).toBe(200);
    expect(patched.body.data.permissions).toEqual(["orders.view", "production.view"]);

    const copy = await request(app)
      .post(`/api/v1/users/roles/${created.body.data._id}/duplicate`)
      .set(headers)
      .send({ name: "Night Shift Copy" });
    expect(copy.status).toBe(201);
    expect(copy.body.data.slug).toBe("night_shift_copy");
    expect(copy.body.data.system).toBe(false);

    const ownerRole = (await request(app).get("/api/v1/users/roles").set(headers)).body.data.find(
      (r: { slug: string }) => r.slug === "owner"
    );
    const deleteOwner = await request(app).delete(`/api/v1/users/roles/${ownerRole._id}`).set(headers);
    expect(deleteOwner.status).toBe(403);

    const editOwner = await request(app).patch(`/api/v1/users/roles/${ownerRole._id}`).set(headers).send({ name: "Hijack" });
    expect(editOwner.status).toBe(403);
  });

  it("resets a default role back to the seeded permission set", async () => {
    const headers = await auth("admin");
    const roles = (await request(app).get("/api/v1/users/roles").set(headers)).body.data as Array<{ _id: string; slug: string }>;
    const viewer = roles.find((r) => r.slug === "viewer")!;
    await request(app).patch(`/api/v1/users/roles/${viewer._id}`).set(headers).send({ permissions: ["orders.view"] });
    const reset = await request(app).post(`/api/v1/users/roles/${viewer._id}/reset`).set(headers);
    expect(reset.status).toBe(200);
    expect(reset.body.data.permissions).toEqual(expect.arrayContaining(["customers.view", "orders.view", "reports.view"]));
    expect(reset.body.data.permissions).toHaveLength(8);
  });

  it("lets an administrator create and update staff but not assign or edit Owner", async () => {
    const headers = await auth("admin");
    const roles = (await request(app).get("/api/v1/users/roles").set(headers)).body.data as Array<{ _id: string; slug: string }>;
    const viewerId = roles.find((r) => r.slug === "viewer")!._id;
    const ownerId = roles.find((r) => r.slug === "owner")!._id;

    const created = await request(app).post("/api/v1/users").set(headers).send({
      name: "Floor Viewer",
      email: "floor.viewer@test.local",
      password,
      roleId: viewerId,
      department: "Front desk"
    });
    expect(created.status).toBe(201);
    expect(created.body.data.email).toBe("floor.viewer@test.local");
    expect(created.body.data.roleId.slug).toBe("viewer");
    expect(created.body.data).not.toHaveProperty("passwordHash");

    const asOwner = await request(app).post("/api/v1/users").set(headers).send({
      name: "Fake Owner",
      email: "fake.owner@test.local",
      password,
      roleId: ownerId
    });
    expect(asOwner.status).toBe(403);

    const patched = await request(app).patch(`/api/v1/users/${created.body.data._id}`).set(headers).send({
      department: "Accounts",
      permissionOverrides: { grant: ["users.view", "settings.owner"], revoke: ["reports.view"] }
    });
    expect(patched.status).toBe(200);
    expect(patched.body.data.department).toBe("Accounts");
    expect(patched.body.data.permissionOverrides.grant).toEqual(["users.view"]);
    expect(patched.body.data.effectivePermissions).toContain("users.view");
    expect(patched.body.data.effectivePermissions).not.toContain("reports.view");
    expect(patched.body.data.effectivePermissions).not.toContain("settings.owner");

    const ownerEdit = await request(app).patch(`/api/v1/users/${actors.owner.id}`).set(headers).send({ name: "Hijacked" });
    expect(ownerEdit.status).toBe(403);
  });

  it("applies grant and revoke overrides on the next authenticated request", async () => {
    const admin = await auth("admin");
    const roles = (await request(app).get("/api/v1/users/roles").set(admin)).body.data as Array<{ _id: string; slug: string }>;
    const viewerId = roles.find((r) => r.slug === "viewer")!._id;
    const created = await request(app).post("/api/v1/users").set(admin).send({
      name: "Override Case",
      email: "override.case@test.local",
      password,
      roleId: viewerId
    });
    expect(created.status).toBe(201);

    const login = async () => {
      const res = await request(app).post("/api/v1/auth/login").send({ email: "override.case@test.local", password });
      return { Authorization: `Bearer ${res.body.data.accessToken}` };
    };

    const before = await request(app).get("/api/v1/users").set(await login());
    expect(before.status).toBe(403);

    await request(app).patch(`/api/v1/users/${created.body.data._id}`).set(admin).send({
      permissionOverrides: { grant: ["users.view"] }
    });
    const granted = await request(app).get("/api/v1/users").set(await login());
    expect(granted.status).toBe(200);

    await request(app).patch(`/api/v1/users/${created.body.data._id}`).set(admin).send({
      permissionOverrides: { grant: ["users.view"], revoke: ["customers.view"] }
    });
    const revoked = await request(app).get("/api/v1/customers").set(await login());
    expect(revoked.status).toBe(403);
  });

  it("protects the last owner and allows a second owner created by an owner", async () => {
    const owner = await auth("owner");
    const roles = (await request(app).get("/api/v1/users/roles").set(owner)).body.data as Array<{ _id: string; slug: string }>;
    const ownerRoleId = roles.find((r) => r.slug === "owner")!._id;

    const selfOff = await request(app).patch(`/api/v1/users/${actors.owner.id}`).set(owner).send({ active: false });
    expect(selfOff.status).toBe(400);

    const selfDelete = await request(app).delete(`/api/v1/users/${actors.owner.id}`).set(owner);
    expect(selfDelete.status).toBe(400);

    const viewerId = roles.find((r) => r.slug === "viewer")!._id;
    const demoteLast = await request(app).patch(`/api/v1/users/${actors.owner.id}`).set(owner).send({ roleId: viewerId });
    expect(demoteLast.status).toBe(409);

    const second = await request(app).post("/api/v1/users").set(owner).send({
      name: "Co Owner",
      email: "co.owner@test.local",
      password,
      roleId: ownerRoleId
    });
    expect(second.status).toBe(201);

    const demoteWithBackup = await request(app).patch(`/api/v1/users/${second.body.data._id}`).set(owner).send({ roleId: viewerId });
    expect(demoteWithBackup.status).toBe(200);

    const last = await request(app).patch(`/api/v1/users/${actors.owner.id}`).set(owner).send({ roleId: viewerId });
    expect(last.status).toBe(409);
  });

  it("refuses to delete a role that still has staff assigned", async () => {
    const headers = await auth("admin");
    const created = await request(app).post("/api/v1/users/roles").set(headers).send({
      name: "Temp Role",
      permissions: ["orders.view"]
    });
    const staff = await request(app).post("/api/v1/users").set(headers).send({
      name: "Temp Staff",
      email: "temp.staff@test.local",
      password,
      roleId: created.body.data._id
    });
    expect(staff.status).toBe(201);

    const blocked = await request(app).delete(`/api/v1/users/roles/${created.body.data._id}`).set(headers);
    expect(blocked.status).toBe(409);

    const viewerId = ((await request(app).get("/api/v1/users/roles").set(headers)).body.data as Array<{ _id: string; slug: string }>).find(
      (r) => r.slug === "viewer"
    )!._id;
    await request(app).patch(`/api/v1/users/${staff.body.data._id}`).set(headers).send({ roleId: viewerId });
    const deleted = await request(app).delete(`/api/v1/users/roles/${created.body.data._id}`).set(headers);
    expect(deleted.status).toBe(200);
  });

  it("keeps staff inside assigned modules and blocks granting unheld permissions", async () => {
    const admin = await auth("admin");
    const limited = await request(app).post("/api/v1/users/roles").set(admin).send({
      name: "People Admin",
      permissions: ["users.view", "users.manage", "roles.manage"]
    });
    expect(limited.status).toBe(201);
    expect(limited.body.data.modules.map((m: { id: string }) => m.id)).toEqual(["admin"]);

    const staff = await request(app).post("/api/v1/users").set(admin).send({
      name: "People Lead",
      email: "people.lead@test.local",
      password,
      roleId: limited.body.data._id
    });
    expect(staff.status).toBe(201);
    expect(staff.body.data.modules.map((m: { id: string }) => m.id)).toEqual(["admin"]);

    const login = await request(app).post("/api/v1/auth/login").send({ email: "people.lead@test.local", password });
    const headers = { Authorization: `Bearer ${login.body.data.accessToken}` };

    const finance = await request(app).get("/api/v1/finance/summary").set(headers);
    expect(finance.status).toBe(403);
    const catalog = await request(app).get("/api/v1/catalog/items").set(headers);
    expect(catalog.status).toBe(403);
    const people = await request(app).get("/api/v1/users").set(headers);
    expect(people.status).toBe(200);

    const escalate = await request(app).post("/api/v1/users/roles").set(headers).send({
      name: "Finance Hijack",
      permissions: ["finance.view", "finance.approve_expense"]
    });
    expect(escalate.status).toBe(403);

    const allowedRole = await request(app).post("/api/v1/users/roles").set(headers).send({
      name: "Staff Viewer",
      permissions: ["users.view"]
    });
    expect(allowedRole.status).toBe(201);

    const viewer = await request(app).get("/api/v1/finance/summary").set(await auth("viewer"));
    expect(viewer.status).toBe(200);
    const viewerUsers = await request(app).get("/api/v1/users").set(await auth("viewer"));
    expect(viewerUsers.status).toBe(403);

    const exportDenied = await request(app).get("/api/v1/reports/export").set(await auth("viewer"));
    expect(exportDenied.status).toBe(403);
    const exportOk = await request(app).get("/api/v1/reports/export").set(admin);
    expect(exportOk.status).toBe(200);
    expect(String(exportOk.headers["content-type"])).toMatch(/csv/);
  });
});
