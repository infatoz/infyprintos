import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApp, stopTestApp, type TestActors } from "../../test/harness";
import type { Express } from "express";

describe("Admin settings configuration", () => {
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

  async function auth(role: "owner" | "admin" | "orderManager" | "viewer") {
    const actor = actors[role];
    const res = await request(app).post("/api/v1/auth/login").send({ email: actor.email, password: actor.password });
    return { Authorization: `Bearer ${res.body.data.accessToken}` };
  }

  it("lets owner and admin CRUD operational masters while legal identity stays owner-only", async () => {
    const admin = await auth("admin");
    const owner = await auth("owner");

    const deniedName = await request(app).patch("/api/v1/settings/business").set(admin).send({ name: "Hijack" });
    expect(deniedName.status).toBe(403);

    const ops = await request(app).patch("/api/v1/settings/operations").set(admin).send({
      timezone: "Asia/Dubai",
      expensePrefix: "EX",
      taxInclusive: true,
      address: { city: "Bengaluru", pincode: "560001" }
    });
    expect(ops.status).toBe(200);
    expect(ops.body.data.timezone).toBe("Asia/Dubai");
    expect(ops.body.data.expensePrefix).toBe("EX");
    expect(ops.body.data.taxInclusive).toBe(true);
    expect(ops.body.data.address.city).toBe("Bengaluru");
    expect(ops.body.data.name).not.toBe("Hijack");

    const method = await request(app).post("/api/v1/settings/payment-methods").set(admin).send({ name: "Wallet Pay" });
    expect(method.status).toBe(201);
    expect(method.body.data.code).toBe("wallet-pay");

    const branch = await request(app).post("/api/v1/settings/branches").set(admin).send({ name: "Whitefield", code: "WFD" });
    expect(branch.status).toBe(201);

    const printer = await request(app).post("/api/v1/settings/printers").set(admin).send({ name: "Front desk A4", type: "a4" });
    expect(printer.status).toBe(201);

    const status = await request(app).post("/api/v1/settings/statuses").set(admin).send({
      name: "Artwork hold",
      allowedTransitions: ["cancelled"]
    });
    expect(status.status).toBe(201);
    expect(status.body.data.code).toBe("artwork_hold");

    const coupon = await request(app).post("/api/v1/settings/coupons").set(admin).send({
      code: "PRESS15",
      type: "percent",
      value: 15
    });
    expect(coupon.status).toBe(201);

    const biz = await request(app).get("/api/v1/settings/business").set(admin);
    expect(biz.status).toBe(200);
    expect(biz.body.data.taxRates.some((r: { name: string }) => r.name === "GST 18%")).toBe(true);
    expect(biz.body.data.methods.some((m: { code: string }) => m.code === "wallet-pay")).toBe(true);
    expect(biz.body.data.branches.some((b: { code: string }) => b.code === "WFD")).toBe(true);

    const tax = await request(app).post("/api/v1/settings/tax-rates").set(admin).send({ name: "GST 3%", rate: 3 });
    expect(tax.status).toBe(201);
    const taxPatch = await request(app).patch(`/api/v1/settings/tax-rates/${tax.body.data._id}`).set(admin).send({ hsn: "4901" });
    expect(taxPatch.status).toBe(200);
    expect(taxPatch.body.data.hsn).toBe("4901");

    const viewer = await auth("viewer");
    const viewerOps = await request(app).patch("/api/v1/settings/operations").set(viewer).send({ timezone: "UTC" });
    expect(viewerOps.status).toBe(403);

    const floor = await auth("orderManager");
    const floorBranch = await request(app).post("/api/v1/settings/branches").set(floor).send({ name: "Nope", code: "NOPE" });
    expect(floorBranch.status).toBe(403);

    const ownerPatch = await request(app).patch("/api/v1/settings/business").set(owner).send({ legalName: "Owner Press LLP" });
    expect(ownerPatch.status).toBe(200);
    expect(ownerPatch.body.data.legalName).toBe("Owner Press LLP");

    const deleted = await request(app).delete(`/api/v1/settings/tax-rates/${tax.body.data._id}`).set(admin);
    expect(deleted.status).toBe(200);
  });
});
