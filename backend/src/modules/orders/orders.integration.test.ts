import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApp, stopTestApp, type TestActors } from "../../test/harness";
import { Item } from "../../models/Catalog";
import { Customer } from "../../models/Customer";
import { AuditLog, Coupon, PaymentMethod } from "../../models/Settings";
import type { Express } from "express";

describe("POS / orders", () => {
  let app: Express;
  let actors: TestActors;
  let itemId = "";
  let customerId = "";
  let orderId = "";

  beforeAll(async () => {
    const started = await startTestApp();
    app = started.app;
    actors = started.actors;
    const item = await Item.create({
      organizationId: actors.orgId,
      name: "Flex Banner",
      sku: "FLEX-TEST",
      salesPrice: 100,
      taxRate: 18,
      taxInclusive: false,
      requiresDesign: false,
      active: true
    });
    itemId = String(item._id);
    const customer = await Customer.create({
      organizationId: actors.orgId,
      name: "Walk In",
      phone: "9000011122",
      phoneDigits: "9000011122",
      code: "CUS-TEST-1",
      creditLimit: 5000
    });
    customerId = String(customer._id);
    await PaymentMethod.create({ organizationId: actors.orgId, name: "Cash", code: "cash", active: true });
    await PaymentMethod.create({ organizationId: actors.orgId, name: "UPI", code: "upi", active: true });
  }, 60_000);

  afterAll(async () => {
    await stopTestApp();
  });

  async function token(role: "admin" | "viewer" | "orderManager" | "owner" = "orderManager") {
    const actor = actors[role];
    const res = await request(app).post("/api/v1/auth/login").send({ email: actor.email, password: actor.password });
    return res.body.data.accessToken as string;
  }

  it("recalculates totals on the server and ignores client grand totals", async () => {
    const auth = await token();
    const res = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${auth}`)
      .set("Idempotency-Key", "order-key-alpha-1")
      .send({
        customerId,
        items: [{ itemId, quantity: 2, unitPrice: 1 }],
        submit: true,
        paymentMethod: "cash",
        paymentAmount: 50,
        source: "pos"
      });
    expect(res.status).toBe(201);
    expect(res.body.data.totals.subtotal).toBe(200);
    expect(res.body.data.totals.taxTotal).toBe(36);
    expect(res.body.data.totals.grandTotal).toBe(236);
    expect(res.body.data.totals.paidAmount).toBe(50);
    expect(res.body.data.totals.balanceDue).toBe(186);
    expect(res.body.data.items[0].unitPrice).toBe(100);
    orderId = res.body.data._id;
    expect(res.body.data.whatsapp.waMe).toMatch(/^https:\/\/wa\.me\/91/);
    expect(res.body.data.whatsapp.body).toContain("order");
  });

  it("writes a payment receipt PDF", async () => {
    const auth = await token();
    const detail = await request(app).get(`/api/v1/orders/${orderId}`).set("Authorization", `Bearer ${auth}`);
    expect(detail.status).toBe(200);
    const payId = detail.body.data.payments?.[0]?._id;
    expect(payId).toBeTruthy();
    const pdf = await request(app).get(`/api/v1/finance/payments/${payId}/receipt.pdf`).set("Authorization", `Bearer ${auth}`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toMatch(/pdf/);
    expect(pdf.body.length).toBeGreaterThan(500);
  });

  it("replays duplicate order creates with the same idempotency key", async () => {
    const auth = await token();
    const res = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${auth}`)
      .set("Idempotency-Key", "order-key-alpha-1")
      .send({
        customerId,
        items: [{ itemId, quantity: 9 }],
        submit: true
      });
    expect(res.status).toBe(201);
    expect(res.body.data._id).toBe(orderId);
    expect(res.body.data.items[0].quantity).toBe(2);
  });

  it("blocks overpayment and duplicate payment references", async () => {
    const auth = await token();
    const over = await request(app)
      .post(`/api/v1/orders/${orderId}/payments`)
      .set("Authorization", `Bearer ${auth}`)
      .send({ amount: 9999, method: "upi", reference: "UPI-1" });
    expect(over.status).toBe(422);

    const first = await request(app)
      .post(`/api/v1/orders/${orderId}/payments`)
      .set("Authorization", `Bearer ${auth}`)
      .send({ amount: 10, method: "upi", reference: "UPI-1" });
    expect(first.status).toBe(201);
    expect(first.body.data.whatsapp.event).toBe("payment_received");

    const marked = await request(app)
      .post(`/api/v1/notifications/logs/${first.body.data.whatsapp.logId}/mark-sent`)
      .set("Authorization", `Bearer ${auth}`);
    expect(marked.status).toBe(200);
    expect(marked.body.data.status).toBe("sent");

    const dup = await request(app)
      .post(`/api/v1/orders/${orderId}/payments`)
      .set("Authorization", `Bearer ${auth}`)
      .send({ amount: 10, method: "upi", reference: "UPI-1" });
    expect(dup.status).toBe(201);
    expect(dup.body.data.replayed).toBe(true);
  });

  it("blocks viewers from creating orders and generating invoices", async () => {
    const auth = await token("viewer");
    const res = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${auth}`)
      .send({ customerId, items: [{ itemId, quantity: 1 }] });
    expect(res.status).toBe(403);
  });

  it("enforces credit hold", async () => {
    const auth = await token();
    await Customer.findByIdAndUpdate(customerId, { creditHold: true });
    const res = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${auth}`)
      .send({ customerId, items: [{ itemId, quantity: 1 }], submit: true });
    expect(res.status).toBe(422);
    await Customer.findByIdAndUpdate(customerId, { creditHold: false });
  });

  it("previews server prices and writes a quotation PDF", async () => {
    const auth = await token();
    const preview = await request(app)
      .post("/api/v1/orders/preview")
      .set("Authorization", `Bearer ${auth}`)
      .send({ customerId, items: [{ itemId, quantity: 1 }], autoRound: true });
    expect(preview.status).toBe(200);
    expect(preview.body.data.totals.grandTotal).toBeGreaterThan(0);

    const quote = await request(app)
      .post("/api/v1/quotations")
      .set("Authorization", `Bearer ${auth}`)
      .send({ customerId, items: [{ itemId, quantity: 1 }] });
    expect(quote.status).toBe(201);
    const pdf = await request(app)
      .get(`/api/v1/quotations/${quote.body.data._id}/pdf`)
      .set("Authorization", `Bearer ${auth}`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toMatch(/pdf/);
  });

  it("applies coupons on top of order discounts and ignores unauthorised price overrides", async () => {
    const auth = await token();
    await Coupon.create({ organizationId: actors.orgId, code: "SAVE10", type: "percent", value: 10, active: true });
    const res = await request(app)
      .post("/api/v1/orders/preview")
      .set("Authorization", `Bearer ${auth}`)
      .send({
        customerId,
        items: [{ itemId, quantity: 1, unitPrice: 1 }],
        discountType: "percent",
        discountValue: 5,
        couponCode: "SAVE10"
      });
    expect(res.status).toBe(200);
    expect(res.body.data.items[0].unitPrice).toBe(100);
    expect(res.body.data.totals.orderDiscount).toBeGreaterThan(10);
    expect(res.body.data.totals.grandTotal).toBeLessThan(118);
  });

  it("lets an administrator override unit price", async () => {
    const auth = await token("admin");
    const res = await request(app)
      .post("/api/v1/orders/preview")
      .set("Authorization", `Bearer ${auth}`)
      .send({ customerId, items: [{ itemId, quantity: 1, unitPrice: 50 }] });
    expect(res.status).toBe(200);
    expect(res.body.data.items[0].unitPrice).toBe(50);
    expect(res.body.data.totals.grandTotal).toBe(59);
  });

  it("rejects unknown payment methods and credit limit breaches", async () => {
    const auth = await token();
    const badMethod = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${auth}`)
      .send({ customerId, items: [{ itemId, quantity: 1 }], submit: true, paymentAmount: 10, paymentMethod: "bitcoin" });
    expect(badMethod.status).toBe(400);

    await Customer.findByIdAndUpdate(customerId, { creditLimit: 1, creditHold: false });
    const overLimit = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${auth}`)
      .set("Idempotency-Key", "credit-limit-key-1")
      .send({ customerId, items: [{ itemId, quantity: 1 }], submit: true });
    expect(overLimit.status).toBe(422);
    await Customer.findByIdAndUpdate(customerId, { creditLimit: 50000 });
  });

  it("recalculates draft edits and writes an invoice PDF", async () => {
    const auth = await token();
    const created = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${auth}`)
      .set("Idempotency-Key", "draft-edit-key-1")
      .send({ customerId, items: [{ itemId, quantity: 1 }], submit: false });
    expect(created.status).toBe(201);
    expect(created.body.data.status).toBe("draft");

    const patched = await request(app)
      .patch(`/api/v1/orders/${created.body.data._id}`)
      .set("Authorization", `Bearer ${auth}`)
      .send({ items: [{ itemId, quantity: 3 }] });
    expect(patched.status).toBe(200);
    expect(patched.body.data.totals.subtotal).toBe(300);
    expect(patched.body.data.totals.grandTotal).toBe(354);

    const pdf = await request(app)
      .get(`/api/v1/orders/${created.body.data._id}/invoice.pdf`)
      .set("Authorization", `Bearer ${auth}`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toMatch(/pdf/);
  });

  it("blocks print until design approval and records cancel history", async () => {
    const auth = await token();
    const designItem = await Item.create({
      organizationId: actors.orgId,
      name: "Visiting Card",
      sku: "VC-TEST",
      salesPrice: 20,
      taxRate: 0,
      taxInclusive: false,
      requiresDesign: true,
      active: true
    });
    const created = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${auth}`)
      .set("Idempotency-Key", "design-block-key-1")
      .send({ customerId, items: [{ itemId: String(designItem._id), quantity: 1 }], submit: true });
    expect(created.body.data.status).toBe("design_pending");

    const print = await request(app)
      .post(`/api/v1/orders/${created.body.data._id}/status`)
      .set("Authorization", `Bearer ${auth}`)
      .send({ status: "ready_to_print" });
    expect(print.status).toBe(422);

    const cancelled = await request(app)
      .post(`/api/v1/orders/${created.body.data._id}/cancel`)
      .set("Authorization", `Bearer ${auth}`)
      .send({ reason: "Customer dropped the job" });
    expect(cancelled.status).toBe(200);
    expect(cancelled.body.data.cancelReason).toBe("Customer dropped the job");
    expect(cancelled.body.data.whatsapp.event).toBe("order_cancelled");
    expect(cancelled.body.data.whatsapp.waMe).toMatch(/wa\.me\/919000011122/);

    const timeline = await request(app)
      .get(`/api/v1/orders/${created.body.data._id}/timeline`)
      .set("Authorization", `Bearer ${auth}`);
    expect(timeline.body.data.some((h: { fromStatus?: string; toStatus: string }) => h.fromStatus === "design_pending" && h.toStatus === "cancelled")).toBe(true);
  });

  it("issues a secure quotation link, accepts approval, and converts once", async () => {
    const auth = await token();
    const quote = await request(app)
      .post("/api/v1/quotations")
      .set("Authorization", `Bearer ${auth}`)
      .send({ customerId, items: [{ itemId, quantity: 1 }] });
    const sent = await request(app)
      .post(`/api/v1/quotations/${quote.body.data._id}/send`)
      .set("Authorization", `Bearer ${auth}`);
    expect(sent.status).toBe(200);
    const tokenValue = sent.body.data.quotation.publicToken as string;
    expect(sent.body.data.whatsapp.waMe).toMatch(/^https:\/\/wa\.me\/91/);
    expect(sent.body.data.whatsapp.body).toContain("quotation");

    const viewed = await request(app).get(`/public/quotations/${tokenValue}`);
    expect(viewed.status).toBe(200);

    const approved = await request(app).post(`/public/quotations/${tokenValue}/approve`).send({});
    expect(approved.status).toBe(200);

    const first = await request(app)
      .post(`/api/v1/orders/from-quotation/${quote.body.data._id}`)
      .set("Authorization", `Bearer ${auth}`);
    expect(first.status).toBe(201);
    const second = await request(app)
      .post(`/api/v1/orders/from-quotation/${quote.body.data._id}`)
      .set("Authorization", `Bearer ${auth}`);
    expect(second.status).toBe(201);
    expect(second.body.data._id).toBe(first.body.data._id);

    const audits = await AuditLog.find({ organizationId: actors.orgId, action: "quotation.convert" });
    expect(audits.length).toBeGreaterThan(0);
  });

  it("lets owner, admin and order manager record offline design approval", async () => {
    const auth = await token();
    const designItem = await Item.create({
      organizationId: actors.orgId,
      name: "Letterhead",
      sku: "LH-OFFLINE",
      salesPrice: 40,
      taxRate: 0,
      taxInclusive: false,
      requiresDesign: true,
      active: true
    });
    const created = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${auth}`)
      .set("Idempotency-Key", "offline-design-key-1")
      .send({ customerId, items: [{ itemId: String(designItem._id), quantity: 1 }], submit: true });
    expect(created.status).toBe(201);
    const lineId = created.body.data.items[0]._id as string;
    expect(created.body.data.items[0].designStatus).toBe("pending");

    const patched = await request(app)
      .patch(`/api/v1/orders/${created.body.data._id}/items/${lineId}/design-status`)
      .set("Authorization", `Bearer ${auth}`)
      .send({ status: "approved", note: "Customer approved on WhatsApp" });
    expect(patched.status).toBe(200);
    expect(patched.body.data.items[0].designStatus).toBe("approved");

    const viewerAuth = await token("viewer");
    const blocked = await request(app)
      .patch(`/api/v1/orders/${created.body.data._id}/items/${lineId}/design-status`)
      .set("Authorization", `Bearer ${viewerAuth}`)
      .send({ status: "rejected" });
    expect(blocked.status).toBe(403);
  });

  it("issues an e-bill PDF when the order is delivered", async () => {
    const ownerAuth = await token("owner");
    const created = await request(app)
      .post("/api/v1/orders")
      .set("Authorization", `Bearer ${ownerAuth}`)
      .set("Idempotency-Key", "ebill-deliver-key-1")
      .send({ customerId, items: [{ itemId, quantity: 1 }], submit: true });
    expect(created.status).toBe(201);

    const moved = await request(app)
      .post(`/api/v1/orders/${created.body.data._id}/status`)
      .set("Authorization", `Bearer ${ownerAuth}`)
      .send({ status: "delivered" });
    expect(moved.status).toBe(200);
    expect(moved.body.data.status).toBe("delivered");
    expect(moved.body.data.eBillIssued).toBe(true);

    const pdf = await request(app)
      .get(`/api/v1/orders/${created.body.data._id}/ebill.pdf`)
      .set("Authorization", `Bearer ${ownerAuth}`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toMatch(/pdf/);
    expect(pdf.body.length).toBeGreaterThan(400);

    const early = await request(app)
      .get(`/api/v1/orders/${orderId}/ebill.pdf`)
      .set("Authorization", `Bearer ${ownerAuth}`);
    expect(early.status).toBe(422);
  });
});
