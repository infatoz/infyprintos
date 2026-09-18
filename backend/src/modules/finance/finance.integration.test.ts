import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApp, stopTestApp, type TestActors } from "../../test/harness";
import type { Express } from "express";

describe("Finance expenses", () => {
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

  async function token(role: "admin" | "viewer" | "orderManager" = "admin") {
    const actor = actors[role];
    const res = await request(app).post("/api/v1/auth/login").send({ email: actor.email, password: actor.password });
    return res.body.data.accessToken as string;
  }

  it("seeds expense types and records an approved expense against a category and method", async () => {
    const auth = await token();
    const types = await request(app).get("/api/v1/finance/expense-types").set("Authorization", `Bearer ${auth}`);
    expect(types.status).toBe(200);
    expect(types.body.data.some((t: { slug: string }) => t.slug === "utilities")).toBe(true);

    const cats = await request(app).get("/api/v1/finance/expense-categories").set("Authorization", `Bearer ${auth}`);
    expect(cats.body.data.some((c: { slug: string }) => c.slug === "electricity")).toBe(true);

    const methods = await request(app).get("/api/v1/finance/payment-methods").set("Authorization", `Bearer ${auth}`);
    expect(methods.body.data.some((m: { code: string }) => m.code === "cash")).toBe(true);

    const created = await request(app)
      .post("/api/v1/finance/expenses")
      .set("Authorization", `Bearer ${auth}`)
      .send({ category: "electricity", amount: 2500, method: "bank", vendor: "BESCOM", notes: "March bill" });
    expect(created.status).toBe(201);
    expect(created.body.data.approvalStatus).toBe("approved");
    expect(created.body.data.type).toBe("utilities");
    expect(created.body.data.category).toBe("electricity");

    const summary = await request(app).get("/api/v1/finance/summary").set("Authorization", `Bearer ${auth}`);
    expect(summary.status).toBe(200);
    expect(summary.body.data.expenses).toBeGreaterThanOrEqual(2500);
  });

  it("lets staff add types, categories and payment methods and blocks unknown methods", async () => {
    const auth = await token();
    const type = await request(app)
      .post("/api/v1/finance/expense-types")
      .set("Authorization", `Bearer ${auth}`)
      .send({ name: "Staff welfare" });
    expect(type.status).toBe(201);
    expect(type.body.data.slug).toBe("staff-welfare");

    const cat = await request(app)
      .post("/api/v1/finance/expense-categories")
      .set("Authorization", `Bearer ${auth}`)
      .send({ name: "Tea and snacks", type: "staff-welfare" });
    expect(cat.status).toBe(201);

    const method = await request(app)
      .post("/api/v1/finance/payment-methods")
      .set("Authorization", `Bearer ${auth}`)
      .send({ name: "Petty cash box", type: "cash" });
    expect(method.status).toBe(201);
    expect(method.body.data.code).toBe("petty-cash-box");

    const expense = await request(app)
      .post("/api/v1/finance/expenses")
      .set("Authorization", `Bearer ${auth}`)
      .send({ category: "tea-and-snacks", amount: 180, method: "petty-cash-box" });
    expect(expense.status).toBe(201);

    const bad = await request(app)
      .post("/api/v1/finance/expenses")
      .set("Authorization", `Bearer ${auth}`)
      .send({ category: "electricity", amount: 10, method: "bitcoin" });
    expect(bad.status).toBe(422);

    const blocked = await request(app).delete(`/api/v1/finance/expense-types/${type.body.data._id}`).set("Authorization", `Bearer ${auth}`);
    expect(blocked.status).toBe(409);

    const viewer = await token("viewer");
    const denied = await request(app)
      .post("/api/v1/finance/expenses")
      .set("Authorization", `Bearer ${viewer}`)
      .send({ category: "electricity", amount: 10 });
    expect(denied.status).toBe(403);
  });
}, 60_000);
