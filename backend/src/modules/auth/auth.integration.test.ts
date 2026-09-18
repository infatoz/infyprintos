import bcrypt from "bcryptjs";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { User } from "../../models/User";
import { startTestApp, stopTestApp, type TestActors } from "../../test/harness";
import type { Express } from "express";

describe("auth + RBAC integration", () => {
  let app: Express;
  let actors: TestActors;

  beforeAll(async () => {
    const started = await startTestApp();
    app = started.app;
    actors = started.actors;
  }, 60_000);

  afterAll(async () => {
    await stopTestApp();
  });

  async function login(email: string, password: string) {
    return request(app).post("/api/v1/auth/login").send({ email, password });
  }

  it("rejects invalid credentials without leaking whether the user exists", async () => {
    const res = await login(actors.owner.email, "wrong-password");
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("Invalid credentials");
  });

  it("rejects inactive users", async () => {
    const res = await login(actors.inactive.email, actors.inactive.password);
    expect(res.status).toBe(401);
  });

  it("logs in the owner with hashed password verification and issues tokens", async () => {
    const stored = await User.findById(actors.owner.id);
    expect(stored?.passwordHash).toBeTruthy();
    expect(stored?.passwordHash).not.toBe(actors.owner.password);
    expect(await bcrypt.compare(actors.owner.password, stored!.passwordHash)).toBe(true);

    const res = await login(actors.owner.email, actors.owner.password);
    expect(res.status).toBe(200);
    expect(res.body.data.accessToken).toBeTruthy();
    expect(res.body.data.refreshToken).toBeTruthy();
    expect(res.body.data.user.role.slug).toBe("owner");
    expect(res.body.data.user.permissions).toContain("settings.owner");
    expect(res.body.data.user).not.toHaveProperty("passwordHash");
  });

  it("returns the current user on /me and 401 without a token", async () => {
    const denied = await request(app).get("/api/v1/auth/me");
    expect(denied.status).toBe(401);

    const { body } = await login(actors.admin.email, actors.admin.password);
    const me = await request(app).get("/api/v1/auth/me").set("Authorization", `Bearer ${body.data.accessToken}`);
    expect(me.status).toBe(200);
    expect(me.body.data.email).toBe(actors.admin.email);
    expect(me.body.data.permissions).not.toContain("settings.owner");
  });

  it("rotates refresh tokens and rejects the previous one", async () => {
    const { body } = await login(actors.orderManager.email, actors.orderManager.password);
    const firstRefresh = body.data.refreshToken;
    const rotated = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: firstRefresh });
    expect(rotated.status).toBe(200);
    expect(rotated.body.data.accessToken).toBeTruthy();
    expect(rotated.body.data.refreshToken).toBeTruthy();
    expect(rotated.body.data.refreshToken).not.toBe(firstRefresh);

    const reuse = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: firstRefresh });
    expect(reuse.status).toBe(401);
  });

  it("logout revokes sessions so refresh fails", async () => {
    const { body } = await login(actors.viewer.email, actors.viewer.password);
    const out = await request(app)
      .post("/api/v1/auth/logout")
      .set("Authorization", `Bearer ${body.data.accessToken}`)
      .send({ refreshToken: body.data.refreshToken });
    expect(out.status).toBe(200);

    const refresh = await request(app).post("/api/v1/auth/refresh").send({ refreshToken: body.data.refreshToken });
    expect(refresh.status).toBe(401);
  });

  it("blocks Viewer from user management and owner-only settings", async () => {
    const { body } = await login(actors.viewer.email, actors.viewer.password);
    const auth = { Authorization: `Bearer ${body.data.accessToken}` };

    const users = await request(app).get("/api/v1/users").set(auth);
    expect(users.status).toBe(403);

    const settings = await request(app).patch("/api/v1/settings/business").set(auth).send({ name: "Hacked" });
    expect(settings.status).toBe(403);
  });

  it("allows Order Manager to view customers but not manage users", async () => {
    const { body } = await login(actors.orderManager.email, actors.orderManager.password);
    const auth = { Authorization: `Bearer ${body.data.accessToken}` };

    const customers = await request(app).get("/api/v1/customers").set(auth);
    expect(customers.status).toBe(200);

    const users = await request(app).get("/api/v1/users").set(auth);
    expect(users.status).toBe(403);
  });

  it("allows Administrator operational access but not owner-only business setup", async () => {
    const { body } = await login(actors.admin.email, actors.admin.password);
    const auth = { Authorization: `Bearer ${body.data.accessToken}` };

    const customers = await request(app).post("/api/v1/customers").set(auth).send({
      name: "Walk-in",
      phone: "9000000001"
    });
    expect(customers.status).toBe(201);

    const ownerSettings = await request(app).patch("/api/v1/settings/business").set(auth).send({ name: "Should fail" });
    expect(ownerSettings.status).toBe(403);
  });

  it("lets Owner patch business profile", async () => {
    const { body } = await login(actors.owner.email, actors.owner.password);
    const res = await request(app)
      .patch("/api/v1/settings/business")
      .set("Authorization", `Bearer ${body.data.accessToken}`)
      .send({ name: "Owner Press" });
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe("Owner Press");
  });
}, 60_000);
