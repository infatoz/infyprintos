import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApp, stopTestApp, type TestActors } from "../../test/harness";
import { Customer, CustomerTier } from "../../models/Customer";
import type { Express } from "express";

describe("Catalog items, variants and tier prices", () => {
  let app: Express;
  let actors: TestActors;
  let corporateId = "";
  let customerId = "";

  beforeAll(async () => {
    const started = await startTestApp();
    app = started.app;
    actors = started.actors;
    const tier = await CustomerTier.create({
      organizationId: actors.orgId,
      name: "Corporate",
      slug: "corporate",
      discountPercent: 10,
      active: true
    });
    corporateId = String(tier._id);
    const customer = await Customer.create({
      organizationId: actors.orgId,
      name: "Tier Co",
      phone: "9000099900",
      phoneDigits: "9000099900",
      code: "CUS-TIER-1",
      tierId: tier._id,
      creditLimit: 50_000
    });
    customerId = String(customer._id);
  }, 60_000);

  afterAll(async () => {
    await stopTestApp();
  });

  async function token(role: "admin" | "orderManager" | "viewer" = "orderManager") {
    const actor = actors[role];
    const res = await request(app).post("/api/v1/auth/login").send({ email: actor.email, password: actor.password });
    return res.body.data.accessToken as string;
  }

  it("lets an order manager create an item with variants and a locked corporate price", async () => {
    const auth = await token("orderManager");
    const res = await request(app)
      .post("/api/v1/catalog/items")
      .set("Authorization", `Bearer ${auth}`)
      .send({
        name: "Visiting Cards",
        sku: "VC-POS-1",
        salesPrice: 400,
        taxRate: 18,
        unit: "pack",
        requiresDesign: true,
        variants: [
          { name: "500 / Matte", sku: "VC-500-M", salesPrice: 650 },
          { name: "1000 / Gloss", sku: "VC-1000-G", salesPrice: 1100 }
        ],
        prices: [{ variantIndex: 0, tierId: corporateId, price: 560 }]
      });
    expect(res.status).toBe(201);
    expect(res.body.data.item.sku).toBe("VC-POS-1");
    expect(res.body.data.variants).toHaveLength(2);
    expect(res.body.data.prices).toHaveLength(1);
    expect(res.body.data.prices[0].price).toBe(560);

    const matteId = res.body.data.variants.find((v: { sku: string }) => v.sku === "VC-500-M")._id as string;
    const priced = await request(app)
      .get("/api/v1/catalog/price")
      .set("Authorization", `Bearer ${auth}`)
      .query({ itemId: res.body.data.item._id, variantId: matteId, tierId: corporateId, qty: 1 });
    expect(priced.status).toBe(200);
    expect(priced.body.data.price).toBe(560);

    const glossId = res.body.data.variants.find((v: { sku: string }) => v.sku === "VC-1000-G")._id as string;
    const gloss = await request(app)
      .get("/api/v1/catalog/price")
      .set("Authorization", `Bearer ${auth}`)
      .query({ itemId: res.body.data.item._id, variantId: glossId, tierId: corporateId, qty: 1 });
    expect(gloss.body.data.price).toBe(990);

    const listed = await request(app)
      .get("/api/v1/catalog/items")
      .set("Authorization", `Bearer ${auth}`)
      .query({ search: "VC-POS-1", tierId: corporateId });
    const row = listed.body.data.find((i: { sku: string }) => i.sku === "VC-POS-1");
    expect(row.resolvedPrice).toBe(360);
    const matte = row.variants.find((v: { sku: string }) => v.sku === "VC-500-M");
    expect(matte.resolvedPrice).toBe(560);
  });

  it("uses the locked variant price on POS preview for a corporate customer", async () => {
    const auth = await token("orderManager");
    const created = await request(app)
      .post("/api/v1/catalog/items")
      .set("Authorization", `Bearer ${auth}`)
      .send({
        name: "Flex Banner",
        sku: "BN-POS-1",
        salesPrice: 40,
        variants: [{ name: "Star flex", sku: "BN-STAR", salesPrice: 55 }],
        prices: [{ variantIndex: 0, tierId: corporateId, price: 48 }]
      });
    const variantId = created.body.data.variants[0]._id;
    const preview = await request(app)
      .post("/api/v1/orders/preview")
      .set("Authorization", `Bearer ${auth}`)
      .send({
        customerId,
        items: [{ itemId: created.body.data.item._id, variantId, quantity: 10 }]
      });
    expect(preview.status).toBe(200);
    expect(preview.body.data.items[0].unitPrice).toBe(48);
    expect(preview.body.data.totals.subtotal).toBe(480);
  });

  it("rejects a duplicate SKU", async () => {
    const auth = await token("admin");
    await request(app)
      .post("/api/v1/catalog/items")
      .set("Authorization", `Bearer ${auth}`)
      .send({ name: "Mug", sku: "MUG-DUP", salesPrice: 200 });
    const res = await request(app)
      .post("/api/v1/catalog/items")
      .set("Authorization", `Bearer ${auth}`)
      .send({ name: "Mug 2", sku: "MUG-DUP", salesPrice: 220 });
    expect(res.status).toBe(409);
  });

  it("forbids catalog writes for a viewer", async () => {
    const auth = await token("viewer");
    const res = await request(app)
      .post("/api/v1/catalog/items")
      .set("Authorization", `Bearer ${auth}`)
      .send({ name: "Nope", sku: "NOPE-1", salesPrice: 10 });
    expect(res.status).toBe(403);
  });

  it("lets owner and admin CRUD categories and types; order manager cannot delete", async () => {
    const admin = await token("admin");
    const om = await token("orderManager");
    const types = await request(app).get("/api/v1/catalog/types").set("Authorization", `Bearer ${admin}`);
    expect(types.status).toBe(200);
    expect(types.body.data.some((t: { slug: string }) => t.slug === "custom_print")).toBe(true);

    const type = await request(app)
      .post("/api/v1/catalog/types")
      .set("Authorization", `Bearer ${admin}`)
      .send({ name: "Finishing", defaultUnit: "pcs", requiresDesign: false });
    expect(type.status).toBe(201);
    expect(type.body.data.slug).toBe("finishing");

    const omType = await request(app)
      .post("/api/v1/catalog/types")
      .set("Authorization", `Bearer ${om}`)
      .send({ name: "Nope type" });
    expect(omType.status).toBe(403);

    const cat = await request(app)
      .post("/api/v1/catalog/categories")
      .set("Authorization", `Bearer ${admin}`)
      .send({ name: "Stickers", type: "product", description: "Die-cut labels" });
    expect(cat.status).toBe(201);

    const patched = await request(app)
      .patch(`/api/v1/catalog/categories/${cat.body.data._id}`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ name: "Vinyl stickers", type: "product" });
    expect(patched.status).toBe(200);
    expect(patched.body.data.name).toBe("Vinyl stickers");

    const omPatch = await request(app)
      .patch(`/api/v1/catalog/categories/${cat.body.data._id}`)
      .set("Authorization", `Bearer ${om}`)
      .send({ name: "Hijack", type: "product" });
    expect(omPatch.status).toBe(403);

    const item = await request(app)
      .post("/api/v1/catalog/items")
      .set("Authorization", `Bearer ${om}`)
      .send({ name: "Die cut sticker", sku: "STK-1", salesPrice: 25, categoryId: cat.body.data._id, itemType: "product" });
    expect(item.status).toBe(201);

    const omDelete = await request(app)
      .delete(`/api/v1/catalog/items/${item.body.data.item._id}`)
      .set("Authorization", `Bearer ${om}`);
    expect(omDelete.status).toBe(403);

    const blockedCat = await request(app)
      .delete(`/api/v1/catalog/categories/${cat.body.data._id}`)
      .set("Authorization", `Bearer ${admin}`);
    expect(blockedCat.status).toBe(409);

    const deletedItem = await request(app)
      .delete(`/api/v1/catalog/items/${item.body.data.item._id}`)
      .set("Authorization", `Bearer ${admin}`);
    expect(deletedItem.status).toBe(200);

    const deletedCat = await request(app)
      .delete(`/api/v1/catalog/categories/${cat.body.data._id}`)
      .set("Authorization", `Bearer ${admin}`);
    expect(deletedCat.status).toBe(200);
  });

  it("rejects invalid HSN and stores an optional catalog image", async () => {
    const auth = await token("admin");
    const bad = await request(app)
      .post("/api/v1/catalog/items")
      .set("Authorization", `Bearer ${auth}`)
      .send({ name: "Bad HSN", sku: "HSN-BAD", salesPrice: 10, hsn: "12" });
    expect(bad.status).toBe(422);

    const created = await request(app)
      .post("/api/v1/catalog/items")
      .set("Authorization", `Bearer ${auth}`)
      .send({ name: "Photo mug", sku: "MUG-IMG", salesPrice: 180, hsn: "6912" });
    expect(created.status).toBe(201);
    const id = created.body.data.item._id as string;
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const uploaded = await request(app)
      .post(`/api/v1/catalog/items/${id}/image`)
      .set("Authorization", `Bearer ${auth}`)
      .attach("file", png, "cover.png");
    expect(uploaded.status).toBe(200);
    expect(uploaded.body.data.imageUrl).toMatch(/^\/uploads\/catalog\//);

    const gallery = await request(app)
      .post(`/api/v1/catalog/items/${id}/gallery`)
      .set("Authorization", `Bearer ${auth}`)
      .attach("files", png, "extra.png");
    expect(gallery.status).toBe(200);
    expect(gallery.body.data.gallery).toHaveLength(1);
  });
});
