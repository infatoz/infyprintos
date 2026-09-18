import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApp, stopTestApp, type TestActors } from "../../test/harness";
import { Item } from "../../models/Catalog";
import { Customer } from "../../models/Customer";
import { PaymentMethod } from "../../models/Settings";
import { Expense } from "../../models/Finance";
import type { Express } from "express";

describe("Reports and analytics", () => {
  let app: Express;
  let actors: TestActors;
  let itemId = "";
  let customerId = "";

  beforeAll(async () => {
    const started = await startTestApp();
    app = started.app;
    actors = started.actors;
    const item = await Item.create({
      organizationId: actors.orgId,
      name: "Visiting Card",
      sku: "VC-RPT",
      salesPrice: 50,
      taxRate: 18,
      taxInclusive: false,
      requiresDesign: false,
      active: true
    });
    itemId = String(item._id);
    const customer = await Customer.create({
      organizationId: actors.orgId,
      name: "Report Client",
      phone: "9888877766",
      phoneDigits: "9888877766",
      code: "CUS-RPT-1",
      creditLimit: 20000,
      outstanding: 0
    });
    customerId = String(customer._id);
    await PaymentMethod.create({ organizationId: actors.orgId, name: "Cash", code: "cash", active: true });
  }, 60_000);

  afterAll(async () => {
    await stopTestApp();
  });

  async function token(role: "admin" | "viewer" | "orderManager" = "admin") {
    const actor = actors[role];
    const res = await request(app).post("/api/v1/auth/login").send({ email: actor.email, password: actor.password });
    return res.body.data.accessToken as string;
  }

  it("builds dashboard, GST, aging and CSV from live orders", async () => {
    const auth = await token("admin");
    const created = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${auth}`)
      .send({
        customerId,
        items: [{ itemId, quantity: 2 }],
        submit: true,
        paymentMethod: "cash",
        paymentAmount: 20,
        source: "pos"
      });
    expect(created.status).toBe(201);
    expect(created.body.data.totals.grandTotal).toBe(118);

    await Expense.create({
      organizationId: actors.orgId,
      number: "EXP-RPT-1",
      type: "operating",
      category: "electricity",
      amount: 15,
      date: new Date(),
      approvalStatus: "approved"
    });

    const dash = await request(app).get("/api/v1/reports/dashboard?preset=30d").set("Authorization", `Bearer ${auth}`);
    expect(dash.status).toBe(200);
    expect(dash.body.data.sales).toBeGreaterThanOrEqual(118);
    expect(dash.body.data.collected).toBeGreaterThanOrEqual(20);
    expect(dash.body.data.taxTotal).toBeGreaterThan(0);
    expect(dash.body.data.orders).toBeGreaterThanOrEqual(1);
    expect(dash.body.data.expenses).toBeGreaterThanOrEqual(15);
    expect(dash.body.data.compare).toBeTruthy();
    expect(Array.isArray(dash.body.data.statusMix)).toBe(true);
    expect(Array.isArray(dash.body.data.top?.items)).toBe(true);

    const gst = await request(app).get("/api/v1/reports/detail?kind=gst&preset=30d").set("Authorization", `Bearer ${auth}`);
    expect(gst.status).toBe(200);
    expect(gst.body.data.taxTotal).toBeGreaterThan(0);
    expect(gst.body.data.rates.length).toBeGreaterThan(0);

    const aging = await request(app).get("/api/v1/reports/detail?kind=aging").set("Authorization", `Bearer ${auth}`);
    expect(aging.status).toBe(200);
    expect(aging.body.data.total).toBeGreaterThanOrEqual(0);

    const pnl = await request(app).get("/api/v1/reports/detail?kind=pnl&preset=today").set("Authorization", `Bearer ${auth}`);
    expect(pnl.status).toBe(200);
    expect(pnl.body.data.current.sales).toBeGreaterThanOrEqual(118);

    const csv = await request(app).get("/api/v1/reports/export?type=sales&preset=30d").set("Authorization", `Bearer ${auth}`);
    expect(csv.status).toBe(200);
    expect(csv.headers["content-type"]).toMatch(/csv/);
    expect(String(csv.text || csv.body)).toMatch(/revenue|period/i);
  });

  it("lets viewers read reports but blocks CSV export", async () => {
    const viewer = await token("viewer");
    const dash = await request(app).get("/api/v1/reports/dashboard").set("Authorization", `Bearer ${viewer}`);
    expect(dash.status).toBe(200);
    const denied = await request(app).get("/api/v1/reports/export?type=gst").set("Authorization", `Bearer ${viewer}`);
    expect(denied.status).toBe(403);
    const bad = await request(app).get("/api/v1/reports/detail?kind=unknown").set("Authorization", `Bearer ${viewer}`);
    expect(bad.status).toBe(400);
  });
});
