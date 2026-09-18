import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { asyncHandler } from "../../common/asyncHandler";
import { ok } from "../../common/response";
import { ApiError } from "../../common/errors";
import { Quotation } from "../../models/Quotation";
import { DesignFile, DesignApproval } from "../../models/Design";
import { Order, OrderStatusHistory } from "../../models/Order";
import { MembershipCard, Customer } from "../../models/Customer";
import { Organization } from "../../models/Organization";
import { queueNotification } from "../../common/notify";
import { validate } from "../../middleware/validate";

const limiter = rateLimit({
  windowMs: 60_000,
  limit: 40,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === "test"
});
const router = Router();
router.use(limiter);

router.get(
  "/quotations/:token",
  asyncHandler(async (req, res) => {
    const quotation = await Quotation.findOne({
      publicToken: req.params.token,
      publicTokenExpiresAt: { $gt: new Date() },
      deletedAt: null
    });
    if (!quotation) throw ApiError.notFound("Link expired or invalid");
    if (quotation.status === "sent") {
      quotation.status = "viewed";
      quotation.viewedAt = new Date();
      await quotation.save();
    }
    const org = await Organization.findById(quotation.organizationId).select(
      "name legalName gstin pan logoUrl phone email website address invoiceFooter invoiceNotes"
    );
    return ok(res, {
      number: quotation.number,
      status: quotation.status,
      customer: quotation.customerSnapshot,
      items: quotation.items.map(
        (i: { name?: string; variantName?: string; sku?: string; quantity?: number; unit?: string; unitPrice?: number; taxRate?: number; lineTotal?: number }) => ({
          name: i.name,
          variantName: i.variantName,
          sku: i.sku,
          quantity: i.quantity,
          unit: i.unit,
          unitPrice: i.unitPrice,
          taxRate: i.taxRate,
          lineTotal: i.lineTotal
        })
      ),
      totals: quotation.totals,
      notes: quotation.notes,
      terms: quotation.terms,
      validUntil: quotation.validUntil,
      createdAt: quotation.createdAt,
      business: org
    });
  })
);

router.post(
  "/quotations/:token/approve",
  validate(z.object({ message: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const quotation = await Quotation.findOne({ publicToken: req.params.token, publicTokenExpiresAt: { $gt: new Date() } });
    if (!quotation) throw ApiError.notFound("Link expired or invalid");
    if (!["sent", "viewed", "awaiting_approval"].includes(quotation.status)) {
      throw ApiError.unprocessable("Quotation cannot be approved in its current state");
    }
    quotation.status = "approved";
    quotation.approvedAt = new Date();
    quotation.approvalIp = req.ip;
    quotation.approvalUserAgent = req.get("user-agent");
    quotation.approvalMessage = req.body.message;
    await quotation.save();
    return ok(res, { status: "approved" });
  })
);

router.post(
  "/quotations/:token/reject",
  validate(z.object({ reason: z.string().min(3) })),
  asyncHandler(async (req, res) => {
    const quotation = await Quotation.findOne({ publicToken: req.params.token, publicTokenExpiresAt: { $gt: new Date() } });
    if (!quotation) throw ApiError.notFound("Link expired or invalid");
    quotation.status = "rejected";
    quotation.rejectedAt = new Date();
    quotation.rejectionReason = req.body.reason;
    quotation.approvalIp = req.ip;
    quotation.approvalUserAgent = req.get("user-agent");
    await quotation.save();
    return ok(res, { status: "rejected" });
  })
);

router.get(
  "/designs/:token",
  asyncHandler(async (req, res) => {
    const design = await DesignFile.findOne({ publicToken: req.params.token, deletedAt: null });
    if (!design) throw ApiError.notFound("Link expired or invalid");
    const order = await Order.findById(design.orderId).select("number customerSnapshot status");
    const org = await Organization.findById(design.organizationId).select("name logoUrl");
    return ok(res, {
      version: design.version,
      fileName: design.fileName,
      url: design.url,
      mimeType: design.mimeType,
      status: design.status,
      orderNumber: order?.number,
      customer: order?.customerSnapshot,
      business: org
    });
  })
);

router.post(
  "/designs/:token/approve",
  validate(z.object({ message: z.string().optional(), name: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const design = await DesignFile.findOne({ publicToken: req.params.token });
    if (!design) throw ApiError.notFound("Invalid link");
    if (design.status === "locked" || design.status === "approved") throw ApiError.unprocessable("Design already locked");
    const order = await Order.findById(design.orderId);
    if (!order) throw ApiError.notFound();
    design.status = "locked";
    await design.save();
    const item = order.items.id(design.orderItemId);
    if (item) {
      item.designStatus = "approved";
      item.approvedDesignId = design._id;
    }
    const remaining = order.items.some((i: { requiresDesign?: boolean; designStatus?: string }) => i.requiresDesign && i.designStatus !== "approved");
    order.status = remaining ? "awaiting_design_approval" : "ready_to_print";
    await order.save();
    await DesignApproval.create({
      organizationId: order.organizationId,
      orderId: order._id,
      orderItemId: design.orderItemId,
      designFileId: design._id,
      action: "approved",
      approvedByName: req.body.name || order.customerSnapshot?.name,
      approvedByCustomerId: order.customerId,
      message: req.body.message,
      ip: req.ip,
      userAgent: req.get("user-agent"),
      previewHash: design.hash,
      revisionNumber: design.version,
      immutable: true
    });
    await OrderStatusHistory.create({
      organizationId: order.organizationId,
      orderId: order._id,
      fromStatus: "awaiting_design_approval",
      toStatus: order.status
    });
    return ok(res, { status: "approved", orderStatus: order.status });
  })
);

router.post(
  "/designs/:token/reject",
  validate(z.object({ reason: z.string().min(3), name: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const design = await DesignFile.findOne({ publicToken: req.params.token });
    if (!design) throw ApiError.notFound("Invalid link");
    design.status = "rejected";
    await design.save();
    const order = await Order.findById(design.orderId);
    if (order) {
      const item = order.items.id(design.orderItemId);
      if (item) item.designStatus = "rejected";
      order.status = "design_rejected";
      await order.save();
    }
    await DesignApproval.create({
      organizationId: design.organizationId,
      orderId: design.orderId,
      orderItemId: design.orderItemId,
      designFileId: design._id,
      action: "rejected",
      reason: req.body.reason,
      approvedByName: req.body.name,
      ip: req.ip,
      userAgent: req.get("user-agent"),
      revisionNumber: design.version
    });
    return ok(res, { status: "rejected" });
  })
);

router.get(
  "/membership/:token",
  asyncHandler(async (req, res) => {
    const card = await MembershipCard.findOne({ qrToken: req.params.token, status: "active" });
    if (!card) throw ApiError.notFound("Card not found or inactive");
    const customer = await Customer.findById(card.customerId).select("name code phone photoUrl");
    const org = await Organization.findById(card.organizationId).select("name logoUrl phone");
    return ok(res, {
      membershipId: card.membershipId,
      tierName: card.tierName,
      issuedAt: card.issuedAt,
      status: card.status,
      customer: { name: customer?.name, code: customer?.code, photoUrl: customer?.photoUrl },
      business: org
    });
  })
);

export default router;
