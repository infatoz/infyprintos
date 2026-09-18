import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApp, stopTestApp, type TestActors } from "../../test/harness";
import { InventoryItem } from "../../models/Inventory";
import { Item } from "../../models/Catalog";
import type { Express } from "express";

describe("Inventory ledger", () => {
  let app: Express;
  let actors: TestActors;
  let itemId = "";
  let destId = "";

  beforeAll(async () => {
    const started = await startTestApp();
    app = started.app;
    actors = started.actors;
    const item = await InventoryItem.create({
      organizationId: actors.orgId,
      sku: "RM-TEST",
      name: "Test Vinyl",
      type: "raw_material",
      unit: "sqft",
      reorderLevel: 50,
      costPerUnit: 10,
      stockQty: 0
    });
    itemId = String(item._id);
    const dest = await InventoryItem.create({
      organizationId: actors.orgId,
      sku: "RM-TEST-B",
      name: "Test Vinyl B",
      type: "raw_material",
      unit: "sqft",
      costPerUnit: 10,
      stockQty: 0
    });
    destId = String(dest._id);
  }, 60_000);

  afterAll(async () => {
    await stopTestApp();
  });

  async function token(role: "admin" | "viewer" | "orderManager" = "admin") {
    const actor = actors[role];
    const res = await request(app).post("/api/v1/auth/login").send({ email: actor.email, password: actor.password });
    return res.body.data.accessToken as string;
  }

  it("posts opening stock through the ledger and ignores client stockQty on create", async () => {
    const auth = await token();
    const created = await request(app)
      .post("/api/v1/inventory/items")
      .set("Authorization", `Bearer ${auth}`)
      .send({ sku: "RM-OPEN", name: "Opening Roll", unit: "sqft", costPerUnit: 5, openingQty: 100, stockQty: 999 });
    expect(created.status).toBe(201);
    expect(created.body.data.stockQty).toBe(100);
    expect(created.body.data.availableQty).toBe(100);

    const patched = await request(app)
      .patch(`/api/v1/inventory/items/${created.body.data._id}`)
      .set("Authorization", `Bearer ${auth}`)
      .send({ stockQty: 1, name: "Opening Roll" });
    expect(patched.status).toBe(200);
    expect(patched.body.data.stockQty).toBe(100);
  });

  it("blocks insufficient stock and records inward with historical unit cost", async () => {
    const auth = await token();
    const out = await request(app)
      .post("/api/v1/inventory/move")
      .set("Authorization", `Bearer ${auth}`)
      .send({ inventoryItemId: itemId, type: "outward", quantity: 5, reason: "too soon" });
    expect(out.status).toBe(422);

    const inn = await request(app)
      .post("/api/v1/inventory/move")
      .set("Authorization", `Bearer ${auth}`)
      .set("Idempotency-Key", "inward-alpha-1")
      .send({ inventoryItemId: itemId, type: "inward", quantity: 80, unitCost: 12, reason: "Purchase" });
    expect(inn.status).toBe(200);
    expect(inn.body.data.item.stockQty).toBe(80);

    const replay = await request(app)
      .post("/api/v1/inventory/move")
      .set("Authorization", `Bearer ${auth}`)
      .set("Idempotency-Key", "inward-alpha-1")
      .send({ inventoryItemId: itemId, type: "inward", quantity: 80, unitCost: 12 });
    expect(replay.body.data.replayed).toBe(true);
    const fresh = await InventoryItem.findById(itemId);
    expect(fresh?.stockQty).toBe(80);
  });

  it("reserves, prevents double consumption, then releases remainder", async () => {
    const auth = await token();
    const catalog = await Item.create({
      organizationId: actors.orgId,
      name: "Banner",
      sku: "BN-INV",
      salesPrice: 100,
      taxRate: 0,
      active: true
    });
    const bom = await request(app)
      .post("/api/v1/inventory/bom")
      .set("Authorization", `Bearer ${auth}`)
      .send({
        itemId: String(catalog._id),
        wastePercent: 0,
        materials: [{ inventoryItemId: itemId, quantityPerUnit: 2, unit: "sqft" }]
      });
    expect(bom.status).toBe(201);

    const explode = await request(app)
      .post("/api/v1/inventory/bom/explode")
      .set("Authorization", `Bearer ${auth}`)
      .send({ itemId: String(catalog._id), quantity: 10 });
    expect(explode.body.data[0].quantity).toBe(20);

    const reserve = await request(app)
      .post("/api/v1/inventory/move")
      .set("Authorization", `Bearer ${auth}`)
      .set("Idempotency-Key", "res-1")
      .send({ inventoryItemId: itemId, type: "reservation", quantity: 20, referenceType: "Order", referenceId: catalog._id });
    expect(reserve.status).toBe(200);
    expect(reserve.body.data.item.reservedQty).toBe(20);
    expect(reserve.body.data.item.stockQty).toBe(80);
    expect(reserve.body.data.item.availableQty).toBe(60);

    const consume = await request(app)
      .post("/api/v1/inventory/move")
      .set("Authorization", `Bearer ${auth}`)
      .set("Idempotency-Key", "con-1")
      .send({
        inventoryItemId: itemId,
        type: "production_consumption",
        quantity: 20,
        referenceType: "ProductionJob",
        referenceId: catalog._id
      });
    expect(consume.status).toBe(200);
    expect(consume.body.data.item.stockQty).toBe(60);
    expect(consume.body.data.item.reservedQty).toBe(0);

    const again = await request(app)
      .post("/api/v1/inventory/move")
      .set("Authorization", `Bearer ${auth}`)
      .set("Idempotency-Key", "con-1")
      .send({
        inventoryItemId: itemId,
        type: "production_consumption",
        quantity: 20,
        referenceType: "ProductionJob",
        referenceId: catalog._id
      });
    expect(again.body.data.replayed).toBe(true);
    const after = await InventoryItem.findById(itemId);
    expect(after?.stockQty).toBe(60);
  });

  it("transfers between SKUs and values stock from moving average", async () => {
    const auth = await token();
    const xfer = await request(app)
      .post("/api/v1/inventory/move")
      .set("Authorization", `Bearer ${auth}`)
      .set("Idempotency-Key", "xfer-1")
      .send({ inventoryItemId: itemId, toInventoryItemId: destId, type: "transfer", quantity: 10, reason: "Warehouse B" });
    expect(xfer.status).toBe(200);
    const src = await InventoryItem.findById(itemId);
    const dest = await InventoryItem.findById(destId);
    expect(src?.stockQty).toBe(50);
    expect(dest?.stockQty).toBe(10);

    const analytics = await request(app).get("/api/v1/inventory/analytics").set("Authorization", `Bearer ${auth}`);
    expect(analytics.status).toBe(200);
    expect(analytics.body.data.valuation).toBeGreaterThan(0);
  });

  it("blocks viewers from mutating stock", async () => {
    const auth = await token("viewer");
    const res = await request(app)
      .post("/api/v1/inventory/move")
      .set("Authorization", `Bearer ${auth}`)
      .send({ inventoryItemId: itemId, type: "inward", quantity: 1 });
    expect(res.status).toBe(403);
  });

  it("manages dynamic types, categories, suppliers, waste and consumption", async () => {
    const auth = await token();
    const types = await request(app).get("/api/v1/inventory/types").set("Authorization", `Bearer ${auth}`);
    expect(types.status).toBe(200);
    expect(types.body.data.some((t: { slug: string }) => t.slug === "raw_material")).toBe(true);

    const custom = await request(app)
      .post("/api/v1/inventory/types")
      .set("Authorization", `Bearer ${auth}`)
      .send({ name: "Press chemical", defaultUnit: "ltr" });
    expect(custom.status).toBe(201);
    expect(custom.body.data.slug).toBe("press-chemical");

    const cat = await request(app)
      .post("/api/v1/inventory/categories")
      .set("Authorization", `Bearer ${auth}`)
      .send({ name: "Blanket wash", type: "press-chemical" });
    expect(cat.status).toBe(201);

    const sku = await request(app)
      .post("/api/v1/inventory/items")
      .set("Authorization", `Bearer ${auth}`)
      .send({
        sku: "CHEM-WASH",
        name: "Blanket Wash",
        type: "press-chemical",
        categoryId: cat.body.data._id,
        unit: "ltr",
        costPerUnit: 40,
        openingQty: 20
      });
    expect(sku.status).toBe(201);
    expect(sku.body.data.stockQty).toBe(20);
    expect(sku.body.data.type).toBe("press-chemical");

    const blockedType = await request(app).delete(`/api/v1/inventory/types/${custom.body.data._id}`).set("Authorization", `Bearer ${auth}`);
    expect(blockedType.status).toBe(409);

    const supplier = await request(app)
      .post("/api/v1/inventory/suppliers")
      .set("Authorization", `Bearer ${auth}`)
      .send({ name: "Ink Depot", phone: "9876512345", gstin: "29AABCU9603R1ZX", paymentTerms: "Net 7" });
    expect(supplier.status).toBe(201);
    expect(supplier.body.data.phoneDigits).toBe("9876512345");

    const badPhone = await request(app)
      .post("/api/v1/inventory/suppliers")
      .set("Authorization", `Bearer ${auth}`)
      .send({ name: "Bad Phone", phone: "12345" });
    expect(badPhone.status).toBe(422);

    const noReason = await request(app)
      .post("/api/v1/inventory/waste")
      .set("Authorization", `Bearer ${auth}`)
      .send({ inventoryItemId: sku.body.data._id, quantity: 1, reason: "x" });
    expect(noReason.status).toBe(422);

    const waste = await request(app)
      .post("/api/v1/inventory/waste")
      .set("Authorization", `Bearer ${auth}`)
      .set("Idempotency-Key", "waste-1")
      .send({ inventoryItemId: sku.body.data._id, quantity: 2, reason: "trim loss on press" });
    expect(waste.status).toBe(200);
    expect(waste.body.data.item.stockQty).toBe(18);

    const consume = await request(app)
      .post("/api/v1/inventory/consumption")
      .set("Authorization", `Bearer ${auth}`)
      .set("Idempotency-Key", "cons-1")
      .send({ inventoryItemId: sku.body.data._id, quantity: 3, reason: "house sample banners" });
    expect(consume.status).toBe(200);
    expect(consume.body.data.item.stockQty).toBe(15);

    const usage = await request(app).get("/api/v1/inventory/usage").query({ period: "weekly" }).set("Authorization", `Bearer ${auth}`);
    expect(usage.status).toBe(200);
    const row = usage.body.data.rows.find((r: { sku?: string }) => r.sku === "CHEM-WASH");
    expect(row.wastage).toBe(2);
    expect(row.consumption).toBe(3);

    const viewer = await token("viewer");
    const denied = await request(app).post("/api/v1/inventory/types").set("Authorization", `Bearer ${viewer}`).send({ name: "Nope" });
    expect(denied.status).toBe(403);
  });
}, 60_000);
