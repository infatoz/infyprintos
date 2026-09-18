import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApp, stopTestApp, type TestActors } from "../../test/harness";
import { InventoryItem, BillOfMaterials } from "../../models/Inventory";
import { Item } from "../../models/Catalog";
import { Customer } from "../../models/Customer";
import { ProductionJob } from "../../models/Production";
import type { Express } from "express";

describe("Production jobs", () => {
  let app: Express;
  let actors: TestActors;
  let orderId = "";
  let jobId = "";
  let invId = "";

  beforeAll(async () => {
    const started = await startTestApp();
    app = started.app;
    actors = started.actors;
    const inv = await InventoryItem.create({
      organizationId: actors.orgId,
      sku: "RM-JOB",
      name: "Job Vinyl",
      unit: "sqft",
      costPerUnit: 4,
      stockQty: 0
    });
    invId = String(inv._id);
    const catalog = await Item.create({
      organizationId: actors.orgId,
      name: "Job Banner",
      sku: "JB-1",
      salesPrice: 50,
      taxRate: 0,
      requiresDesign: false,
      active: true
    });
    await BillOfMaterials.create({
      organizationId: actors.orgId,
      itemId: catalog._id,
      wastePercent: 0,
      materials: [{ inventoryItemId: inv._id, quantityPerUnit: 3, unit: "sqft" }],
      active: true
    });
    const customer = await Customer.create({
      organizationId: actors.orgId,
      name: "Press Client",
      phone: "9000090000",
      phoneDigits: "9000090000",
      code: "CUS-JOB",
      creditLimit: 50000
    });
    const adminLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: actors.admin.email, password: actors.admin.password });
    const admin = adminLogin.body.data.accessToken as string;
    await request(app)
      .post("/api/v1/inventory/move")
      .set("Authorization", `Bearer ${admin}`)
      .send({ inventoryItemId: invId, type: "opening", quantity: 100, unitCost: 4 });

    const omLogin = await request(app)
      .post("/api/v1/auth/login")
      .send({ email: actors.orderManager.email, password: actors.orderManager.password });
    const om = omLogin.body.data.accessToken as string;
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${om}`)
      .set("Idempotency-Key", "job-order-1")
      .send({ customerId: String(customer._id), items: [{ itemId: String(catalog._id), quantity: 2 }], submit: true });
    orderId = order.body.data._id;
    await request(app).post(`/api/v1/orders/${orderId}/status`).set("Authorization", `Bearer ${om}`).send({ status: "ready_to_print" });
    const jobs = await ProductionJob.find({ orderId });
    jobId = String(jobs[0]._id);
  }, 60_000);

  afterAll(async () => {
    await stopTestApp();
  });

  async function token(role: "admin" | "viewer" | "orderManager" = "orderManager") {
    const actor = actors[role];
    const res = await request(app).post("/api/v1/auth/login").send({ email: actor.email, password: actor.password });
    return res.body.data.accessToken as string;
  }

  it("reserves BOM on ready_to_print without consuming twice", async () => {
    const stock = await InventoryItem.findById(invId);
    expect(stock?.stockQty).toBe(100);
    expect(stock?.reservedQty).toBe(6);
    const auth = await token();
    await request(app).post(`/api/v1/orders/${orderId}/status`).set("Authorization", `Bearer ${auth}`).send({ status: "ready_to_print" });
    const again = await InventoryItem.findById(invId);
    expect(again?.reservedQty).toBe(6);
    const jobs = await ProductionJob.find({ orderId });
    expect(jobs).toHaveLength(1);
  });

  it("starts a job once, consumes reserved material, and completes quantities", async () => {
    const auth = await token();
    const start = await request(app).post(`/api/v1/production/jobs/${jobId}/start`).set("Authorization", `Bearer ${auth}`);
    expect(start.status).toBe(200);
    expect(start.body.data.status).toBe("in_production");
    expect(start.body.data.materialsConsumed).toBe(true);
    const stock = await InventoryItem.findById(invId);
    expect(stock?.stockQty).toBe(94);
    expect(stock?.reservedQty).toBe(0);

    const startAgain = await request(app).post(`/api/v1/production/jobs/${jobId}/start`).set("Authorization", `Bearer ${auth}`);
    expect(startAgain.status).toBe(200);
    const stock2 = await InventoryItem.findById(invId);
    expect(stock2?.stockQty).toBe(94);

    const done = await request(app)
      .post(`/api/v1/production/jobs/${jobId}/complete`)
      .set("Authorization", `Bearer ${auth}`)
      .send({ qtyCompleted: 2, qtyRejected: 0, wastage: 0, passed: true });
    expect(done.status).toBe(200);
    expect(done.body.data.status).toBe("completed");
    expect(done.body.data.qtyCompleted).toBe(2);
  });

  it("records delayed jobs on the dashboard and blocks viewers from starting work", async () => {
    const auth = await token();
    const machine = await request(app)
      .post("/api/v1/production/machines")
      .set("Authorization", `Bearer ${auth}`)
      .send({ name: "Test Press", code: "TP-1", type: "offset" });
    expect(machine.status).toBe(201);

    const dash = await request(app).get("/api/v1/production/dashboard").set("Authorization", `Bearer ${auth}`);
    expect(dash.status).toBe(200);
    expect(dash.body.data.completed).toBeGreaterThan(0);

    const viewer = await token("viewer");
    const blocked = await request(app).post(`/api/v1/production/jobs/${jobId}/start`).set("Authorization", `Bearer ${viewer}`);
    expect(blocked.status).toBe(403);
  });

  async function extraJob(suffix: string) {
    const catalog = await Item.create({
      organizationId: actors.orgId,
      name: `Job Banner ${suffix}`,
      sku: `JB-${suffix}`,
      salesPrice: 50,
      taxRate: 0,
      requiresDesign: false,
      active: true
    });
    await BillOfMaterials.create({
      organizationId: actors.orgId,
      itemId: catalog._id,
      wastePercent: 0,
      materials: [{ inventoryItemId: invId, quantityPerUnit: 3, unit: "sqft" }],
      active: true
    });
    const customer = await Customer.create({
      organizationId: actors.orgId,
      name: `Press Client ${suffix}`,
      phone: `90000${suffix.padStart(5, "0")}`.slice(0, 10),
      phoneDigits: `90000${suffix.padStart(5, "0")}`.slice(0, 10),
      code: `CUS-${suffix}`,
      creditLimit: 50000
    });
    const auth = await token();
    const order = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${auth}`)
      .set("Idempotency-Key", `job-order-${suffix}`)
      .send({ customerId: String(customer._id), items: [{ itemId: String(catalog._id), quantity: 2 }], submit: true });
    const oid = order.body.data._id as string;
    await request(app).post(`/api/v1/orders/${oid}/status`).set("Authorization", `Bearer ${auth}`).send({ status: "ready_to_print" });
    const jobs = await ProductionJob.find({ orderId: oid });
    return { auth, orderId: oid, jobId: String(jobs[0]._id), number: jobs[0].number as string };
  }

  it("rejects complete before start, holds, resumes, and records QC rework", async () => {
    const { auth, jobId, number } = await extraJob("QC1");
    const tooSoon = await request(app).post(`/api/v1/production/jobs/${jobId}/complete`).set("Authorization", `Bearer ${auth}`).send({ qtyCompleted: 2 });
    expect(tooSoon.status).toBe(422);

    const held = await request(app).post(`/api/v1/production/jobs/${jobId}/hold`).set("Authorization", `Bearer ${auth}`).send({ reason: "Waiting for plates" });
    expect(held.status).toBe(200);
    expect(held.body.data.status).toBe("on_hold");

    const resumed = await request(app).post(`/api/v1/production/jobs/${jobId}/resume`).set("Authorization", `Bearer ${auth}`);
    expect(resumed.status).toBe(200);
    expect(resumed.body.data.status).toBe("ready");

    await request(app).post(`/api/v1/production/jobs/${jobId}/start`).set("Authorization", `Bearer ${auth}`);
    const fail = await request(app)
      .post(`/api/v1/production/jobs/${jobId}/quality`)
      .set("Authorization", `Bearer ${auth}`)
      .send({ passed: false, notes: "color mismatch" });
    expect(fail.status).toBe(200);
    expect(fail.body.data.status).toBe("in_production");

    const pass = await request(app)
      .post(`/api/v1/production/jobs/${jobId}/quality`)
      .set("Authorization", `Bearer ${auth}`)
      .send({ passed: true, notes: "reprint ok" });
    expect(pass.status).toBe(200);
    expect(pass.body.data.status).toBe("quality_check");

    const found = await request(app).get("/api/v1/production/jobs").query({ search: number }).set("Authorization", `Bearer ${auth}`);
    expect(found.status).toBe(200);
    expect(found.body.data.some((j: { _id: string }) => j._id === jobId)).toBe(true);
  });

  it("blocks a second in-production job on the same machine", async () => {
    const a = await extraJob("M1");
    const b = await extraJob("M2");
    const machine = await request(app)
      .post("/api/v1/production/machines")
      .set("Authorization", `Bearer ${a.auth}`)
      .send({ name: "Busy Press", code: "TP-BUSY", type: "offset" });
    expect(machine.status).toBe(201);
    const machineId = machine.body.data._id as string;

    await request(app).patch(`/api/v1/production/jobs/${a.jobId}`).set("Authorization", `Bearer ${a.auth}`).send({ machineId });
    await request(app).patch(`/api/v1/production/jobs/${b.jobId}`).set("Authorization", `Bearer ${b.auth}`).send({ machineId });

    const startA = await request(app).post(`/api/v1/production/jobs/${a.jobId}/start`).set("Authorization", `Bearer ${a.auth}`);
    expect(startA.status).toBe(200);

    const startB = await request(app).post(`/api/v1/production/jobs/${b.jobId}/start`).set("Authorization", `Bearer ${b.auth}`);
    expect(startB.status).toBe(409);

    const dash = await request(app).get("/api/v1/production/dashboard").set("Authorization", `Bearer ${a.auth}`);
    expect(dash.body.data.onHold).toBeGreaterThanOrEqual(0);
  });
}, 60_000);
