import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApp, stopTestApp, type TestActors } from "../../test/harness";
import type { Express } from "express";

describe("customer CRM", () => {
  let app: Express;
  let actors: TestActors;
  let createdId = "";

  beforeAll(async () => {
    const started = await startTestApp();
    app = started.app;
    actors = started.actors;
  }, 60_000);

  afterAll(async () => {
    await stopTestApp();
  });

  async function login(email: string, password: string) {
    const res = await request(app).post("/api/v1/auth/login").send({ email, password });
    return res.body.data.accessToken as string;
  }

  it("rejects unauthenticated access", async () => {
    const res = await request(app).get("/api/v1/customers");
    expect(res.status).toBe(401);
  });

  it("validates required fields on create", async () => {
    const token = await login(actors.admin.email, actors.admin.password);
    const res = await request(app).post("/api/v1/customers").set("Authorization", `Bearer ${token}`).send({ name: "A", phone: "123" });
    expect(res.status).toBe(422);
  });

  it("rejects invalid email", async () => {
    const token = await login(actors.admin.email, actors.admin.password);
    const res = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Valid Name", phone: "9000000099", email: "not-an-email" });
    expect(res.status).toBe(422);
  });

  it("creates a customer with addresses, code and membership card", async () => {
    const token = await login(actors.admin.email, actors.admin.password);
    const res = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Aarav Printers",
        phone: "9876543210",
        whatsapp: "9876543210",
        email: "aarav@press.test",
        creditLimit: 25000,
        sameAddress: true,
        business: { name: "Aarav Press", gstin: "29AABCU9603R1ZX", pan: "AABCU9603R", category: "printing" },
        addresses: {
          registered: { line1: "12 Press Road", city: "Bengaluru", state: "KA", pincode: "560001" }
        }
      });
    expect(res.status).toBe(201);
    expect(res.body.data.customer.code).toMatch(/^CUS/);
    expect(res.body.data.customer.phoneDigits).toBe("9876543210");
    expect(res.body.data.card.membershipId).toBeTruthy();
    expect(res.body.data.card.qrDataUrl).toMatch(/^data:image\/png/);
    createdId = res.body.data.customer._id;

    const detail = await request(app).get(`/api/v1/customers/${createdId}`).set("Authorization", `Bearer ${token}`);
    expect(detail.status).toBe(200);
    expect(detail.body.data.addresses.length).toBeGreaterThanOrEqual(1);
    expect(detail.body.data.customer.business.gstin).toBe("29AABCU9603R1ZX");
  });

  it("detects duplicate phone, email and GSTIN", async () => {
    const token = await login(actors.admin.email, actors.admin.password);
    const phone = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Copy Phone", phone: "+91 98765 43210" });
    expect(phone.status).toBe(409);

    const email = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Copy Email", phone: "9000001111", email: "AARAV@press.test" });
    expect(email.status).toBe(409);

    const gstin = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Copy GST",
        phone: "9000001222",
        business: { gstin: "29aabcu9603r1zx" }
      });
    expect(gstin.status).toBe(409);
  });

  it("blocks Viewer from creating and Order Manager from deleting", async () => {
    const viewer = await login(actors.viewer.email, actors.viewer.password);
    const denied = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${viewer}`)
      .send({ name: "Viewer Shop", phone: "9111111111" });
    expect(denied.status).toBe(403);

    const manager = await login(actors.orderManager.email, actors.orderManager.password);
    const created = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${manager}`)
      .send({ name: "Manager Client", phone: "9222222222" });
    expect(created.status).toBe(201);

    const del = await request(app)
      .delete(`/api/v1/customers/${created.body.data.customer._id}`)
      .set("Authorization", `Bearer ${manager}`);
    expect(del.status).toBe(403);

    const kyc = await request(app)
      .post(`/api/v1/customers/${created.body.data.customer._id}/documents`)
      .set("Authorization", `Bearer ${manager}`)
      .send({ type: "gstin", number: "x" });
    expect(kyc.status).toBe(403);
  });

  it("allows KYC metadata, verification, history and public QR lookup", async () => {
    const token = await login(actors.admin.email, actors.admin.password);
    const kyc = await request(app)
      .post(`/api/v1/customers/${createdId}/documents`)
      .set("Authorization", `Bearer ${token}`)
      .field("type", "gstin")
      .field("number", "29AABCU9603R1ZX")
      .attach("file", Buffer.from("%PDF-1.4 kyc"), { filename: "gstin.pdf", contentType: "application/pdf" });
    expect(kyc.status).toBe(201);
    expect(kyc.body.data.status).toBe("pending");

    const verify = await request(app)
      .post(`/api/v1/customers/${createdId}/documents/${kyc.body.data._id}/verify`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "verified", notes: "Matches GST portal" });
    expect(verify.status).toBe(200);
    expect(verify.body.data.status).toBe("verified");

    const file = await request(app)
      .get(`/api/v1/customers/${createdId}/documents/${kyc.body.data._id}/file`)
      .set("Authorization", `Bearer ${token}`);
    expect(file.status).toBe(200);
    expect(file.headers["content-type"]).toMatch(/pdf/);

    const history = await request(app).get(`/api/v1/customers/${createdId}/history`).set("Authorization", `Bearer ${token}`);
    expect(history.status).toBe(200);
    expect(history.body.data).toHaveProperty("orders");
    expect(history.body.data).toHaveProperty("payments");

    const detail = await request(app).get(`/api/v1/customers/${createdId}`).set("Authorization", `Bearer ${token}`);
    const qrToken = detail.body.data.card.qrToken;
    const publicCard = await request(app).get(`/public/membership/${qrToken}`);
    expect(publicCard.status).toBe(200);
    expect(publicCard.body.data.customer.name).toBe("Aarav Printers");
  });

  it("scopes list results to the authenticated organization", async () => {
    const token = await login(actors.admin.email, actors.admin.password);
    const res = await request(app).get("/api/v1/customers").query({ search: "Aarav", page: 1, limit: 10, sort: "name" }).set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(1);
    for (const row of res.body.data) {
      expect(String(row.organizationId)).toBe(actors.orgId);
    }
  });

  it("rejects invalid GSTIN and PAN, and allows registered customers without GSTIN or PAN", async () => {
    const token = await login(actors.admin.email, actors.admin.password);
    const gstin = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Bad GST", phone: "9333333333", business: { gstin: "NOTAGSTIN" } });
    expect(gstin.status).toBe(422);

    const pan = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Bad PAN", phone: "9333333334", business: { pan: "ABC" } });
    expect(pan.status).toBe(422);

    const registered = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Needs GSTIN", phone: "9333333335", taxRegistration: "registered" });
    expect(registered.status).toBe(201);
    expect(registered.body.data.customer.taxRegistration).toBe("registered");
    expect(registered.body.data.customer.business?.gstin).toBeFalsy();
  });

  it("stores place of supply and credit events, and blocks order managers from raising limits", async () => {
    const admin = await login(actors.admin.email, actors.admin.password);
    const created = await request(app).get(`/api/v1/customers/${createdId}`).set("Authorization", `Bearer ${admin}`);
    expect(created.status).toBe(200);
    expect(created.body.data.customer.taxRegistration).toBe("registered");
    expect(created.body.data.customer.gstState).toBe("Karnataka");
    expect(created.body.data.customer.business.gstinChecksumValid).toBe(false);
    expect(created.body.data.kycExpired).toBe(false);

    const manager = await login(actors.orderManager.email, actors.orderManager.password);
    const denied = await request(app)
      .patch(`/api/v1/customers/${createdId}`)
      .set("Authorization", `Bearer ${manager}`)
      .send({ creditLimit: 99_000, creditReason: "Should not work" });
    expect(denied.status).toBe(403);

    const raised = await request(app)
      .patch(`/api/v1/customers/${createdId}`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ creditLimit: 40_000, creditReason: "Approved trade credit for festival run" });
    expect(raised.status).toBe(200);
    expect(raised.body.data.creditLimit).toBe(40000);

    const noReason = await request(app)
      .post(`/api/v1/customers/${createdId}/credit-hold`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ hold: true });
    expect(noReason.status).toBe(422);

    const hold = await request(app)
      .post(`/api/v1/customers/${createdId}/credit-hold`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ hold: true, reason: "Overdue invoices past 60 days" });
    expect(hold.status).toBe(200);
    expect(hold.body.data.creditHold).toBe(true);

    const release = await request(app)
      .post(`/api/v1/customers/${createdId}/credit-hold`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ hold: false, reason: "Payment received" });
    expect(release.status).toBe(200);

    const events = await request(app).get(`/api/v1/customers/${createdId}/credit-events`).set("Authorization", `Bearer ${admin}`);
    expect(events.status).toBe(200);
    expect(events.body.data.length).toBeGreaterThanOrEqual(2);
  });

  it("supports contacts, activity, statement, membership reissue, merge and restore", async () => {
    const token = await login(actors.admin.email, actors.admin.password);
    const contact = await request(app)
      .post(`/api/v1/customers/${createdId}/contacts`)
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Priya Accounts", title: "Accounts", phone: "9888888888", isPrimary: true });
    expect(contact.status).toBe(201);

    const activity = await request(app)
      .post(`/api/v1/customers/${createdId}/activities`)
      .set("Authorization", `Bearer ${token}`)
      .send({ type: "call", body: "Confirmed GSTIN on portal" });
    expect(activity.status).toBe(201);

    const statement = await request(app).get(`/api/v1/customers/${createdId}/statement`).set("Authorization", `Bearer ${token}`);
    expect(statement.status).toBe(200);
    expect(statement.body.data.aging).toHaveProperty("current");
    expect(statement.body.data.aging).toHaveProperty("days90plus");

    const before = await request(app).get(`/api/v1/customers/${createdId}`).set("Authorization", `Bearer ${token}`);
    const oldToken = before.body.data.card.qrToken;
    const reissue = await request(app).post(`/api/v1/customers/${createdId}/membership/reissue`).set("Authorization", `Bearer ${token}`);
    expect(reissue.status).toBe(200);
    expect(reissue.body.data.qrToken).not.toBe(oldToken);
    const oldPublic = await request(app).get(`/public/membership/${oldToken}`);
    expect(oldPublic.status).toBe(404);
    const freshPublic = await request(app).get(`/public/membership/${reissue.body.data.qrToken}`);
    expect(freshPublic.status).toBe(200);

    const duplicate = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Merge Source Press", phone: "9444444444" });
    expect(duplicate.status).toBe(201);
    const sourceId = duplicate.body.data.customer._id;

    const merged = await request(app)
      .post(`/api/v1/customers/${createdId}/merge`)
      .set("Authorization", `Bearer ${token}`)
      .send({ sourceId, reason: "Duplicate walk-in created at POS" });
    expect(merged.status).toBe(200);

    const archivedList = await request(app).get("/api/v1/customers").query({ archived: "true", search: "Merge Source" }).set("Authorization", `Bearer ${token}`);
    expect(archivedList.status).toBe(200);
    expect(archivedList.body.meta.total).toBeGreaterThanOrEqual(1);

    const restored = await request(app).post(`/api/v1/customers/${sourceId}/restore`).set("Authorization", `Bearer ${token}`);
    expect(restored.status).toBe(200);
    expect(restored.body.data.deletedAt).toBeFalsy();

    const metrics = await request(app).get("/api/v1/customers/metrics").set("Authorization", `Bearer ${token}`);
    expect(metrics.status).toBe(200);
    expect(metrics.body.data.total).toBeGreaterThanOrEqual(1);

    const filtered = await request(app)
      .get("/api/v1/customers")
      .query({ lifecycleStatus: "active", taxRegistration: "registered" })
      .set("Authorization", `Bearer ${token}`);
    expect(filtered.status).toBe(200);
    expect(filtered.body.data.some((row: { _id: string }) => row._id === createdId)).toBe(true);
  });

  it("rejects a 9-digit phone and accepts +91 formatted 10-digit numbers", async () => {
    const token = await login(actors.admin.email, actors.admin.password);
    const short = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Short Phone", phone: "987654321" });
    expect(short.status).toBe(422);

    const created = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({
        name: "Pin Lookup Press",
        phone: "+91 90000 88881",
        source: "Walk-in",
        addresses: { registered: { line1: "1 MG Road", city: "Bengaluru", state: "Karnataka", pincode: "560001", country: "India" } }
      });
    expect(created.status).toBe(201);
    expect(created.body.data.customer.phoneDigits).toBe("9000088881");
    expect(created.body.data.customer.source).toBe("Walk-in");

    const detail = await request(app)
      .get(`/api/v1/customers/${created.body.data.customer._id}`)
      .set("Authorization", `Bearer ${token}`);
    expect(detail.body.data.addresses[0].country).toBe("India");
  });

  it("returns source and country catalogs and rejects invalid pincodes", async () => {
    const token = await login(actors.admin.email, actors.admin.password);
    const sources = await request(app).get("/api/v1/customers/sources").set("Authorization", `Bearer ${token}`);
    expect(sources.status).toBe(200);
    expect(sources.body.data).toContain("Walk-in");
    expect(sources.body.data).toContain("Referral");

    const categories = await request(app).get("/api/v1/customers/categories").set("Authorization", `Bearer ${token}`);
    expect(categories.status).toBe(200);
    expect(categories.body.data).toContain("Printing & packaging");

    const sizes = await request(app).get("/api/v1/customers/sizes").set("Authorization", `Bearer ${token}`);
    expect(sizes.status).toBe(200);
    expect(sizes.body.data).toContain("Small");

    const countries = await request(app).get("/api/v1/customers/countries").set("Authorization", `Bearer ${token}`);
    expect(countries.status).toBe(200);
    expect(countries.body.data[0]).toBe("India");

    const pin = await request(app).get("/api/v1/customers/pincode/12").set("Authorization", `Bearer ${token}`);
    expect(pin.status).toBe(422);
  });

  it("lets an administrator CRUD customer tiers and credit terms", async () => {
    const admin = await login(actors.admin.email, actors.admin.password);
    const orders = await login(actors.orderManager.email, actors.orderManager.password);
    const denied = await request(app)
      .post("/api/v1/settings/tiers")
      .set("Authorization", `Bearer ${orders}`)
      .send({ name: "Hack Tier", discountPercent: 5 });
    expect(denied.status).toBe(403);

    const tier = await request(app)
      .post("/api/v1/settings/tiers")
      .set("Authorization", `Bearer ${admin}`)
      .send({ name: "Agency", discountPercent: 7 });
    expect(tier.status).toBe(201);
    expect(tier.body.data.slug).toBe("agency");

    const patched = await request(app)
      .patch(`/api/v1/settings/tiers/${tier.body.data._id}`)
      .set("Authorization", `Bearer ${admin}`)
      .send({ discountPercent: 9, active: true });
    expect(patched.status).toBe(200);
    expect(patched.body.data.discountPercent).toBe(9);

    const term = await request(app)
      .post("/api/v1/settings/credit-terms")
      .set("Authorization", `Bearer ${admin}`)
      .send({ name: "Net 45", type: "net_days", netDays: 45 });
    expect(term.status).toBe(201);

    const listed = await request(app).get("/api/v1/customers/tiers").set("Authorization", `Bearer ${admin}`);
    expect(listed.body.data.some((t: { slug: string }) => t.slug === "agency")).toBe(true);

    const deleted = await request(app)
      .delete(`/api/v1/settings/tiers/${tier.body.data._id}`)
      .set("Authorization", `Bearer ${admin}`);
    expect(deleted.status).toBe(200);
  });

  it("stores an optional profile photo", async () => {
    const token = await login(actors.admin.email, actors.admin.password);
    const created = await request(app)
      .post("/api/v1/customers")
      .set("Authorization", `Bearer ${token}`)
      .send({ name: "Photo Press", phone: "9000088882" });
    expect(created.status).toBe(201);
    const id = created.body.data.customer._id as string;
    const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
    const uploaded = await request(app)
      .post(`/api/v1/customers/${id}/photo`)
      .set("Authorization", `Bearer ${token}`)
      .attach("file", png, "avatar.png");
    expect(uploaded.status).toBe(200);
    expect(uploaded.body.data.photoUrl).toMatch(/^\/uploads\/customers\//);

    const removed = await request(app).delete(`/api/v1/customers/${id}/photo`).set("Authorization", `Bearer ${token}`);
    expect(removed.status).toBe(200);
    expect(removed.body.data.photoUrl).toBeNull();
  });
}, 120_000);
