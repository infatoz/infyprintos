import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/asyncHandler";
import { ok, created, paginated } from "../../common/response";
import { parsePagination, escapeRegex, safeSort } from "../../common/pagination";
import { ApiError } from "../../common/errors";
import { randomToken, sha256 } from "../../common/crypto";
import { queueNotification, publicUrl, notifyOrderEvent, eventForOrderStatus, withWhatsappShare, latestShareFor, shareFromLog } from "../../common/notify";
import { Order, OrderStatus, OrderStatusHistory } from "../../models/Order";
import { assertStatusChange, shouldLockOrder } from "../../common/workflow";
import { Quotation } from "../../models/Quotation";
import { Customer } from "../../models/Customer";
import { Organization } from "../../models/Organization";
import { DesignFile, DesignApproval } from "../../models/Design";
import { ProductionJob } from "../../models/Production";
import { Invoice, Payment } from "../../models/Finance";
import { authenticate, type AuthedRequest } from "../../middleware/auth";
import { requirePermission, requireAny } from "../../middleware/rbac";
import { issueOrderEBill, renderOrderBillPdf } from "./ebill";
import { hasPermission } from "../../common/permissions";
import { validate } from "../../middleware/validate";
import { writeAudit } from "../../middleware/audit";
import { upload } from "../../middleware/upload";
import { createOrderRecord, documentSchema, lineSchema, priceForCustomer, recordOrderPayment, recalcOutstanding } from "./order.service";
import { provisionJobsForOrder } from "../production/production.service";
import { releaseOrderReservations } from "../inventory/inventory.service";

const router = Router();
router.use(authenticate);

function paramId(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? "";
}

const CONFIRM_FROM = new Set(["draft", "quotation_sent", "awaiting_customer_approval"]);

function presentOrder(order: { toObject?: () => Record<string, unknown> } | Record<string, unknown> | null, user: AuthedRequest["user"]) {
  if (!order) return order;
  const row = (typeof (order as { toObject?: () => Record<string, unknown> }).toObject === "function"
    ? (order as { toObject: () => Record<string, unknown> }).toObject()
    : { ...(order as Record<string, unknown>) }) as Record<string, unknown>;
  if (hasPermission(user, "orders.view_cost")) return row;
  if (Array.isArray(row.items)) {
    row.items = (row.items as Array<Record<string, unknown>>).map((item) => {
      const next = { ...item };
      delete next.cost;
      if (next.snapshot && typeof next.snapshot === "object") {
        const snap = { ...(next.snapshot as Record<string, unknown>) };
        delete snap.cost;
        delete snap.unitCost;
        delete snap.costPerUnit;
        next.snapshot = snap;
      }
      return next;
    });
  }
  return row;
}

router.get(
  "/statuses",
  requirePermission("orders.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    return ok(res, await OrderStatus.find({ organizationId: user.organizationId, deletedAt: null }).sort("sortOrder"));
  })
);

router.get(
  "/",
  requirePermission("orders.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const { page, limit, skip, search, sort } = parsePagination(req);
    const filter: Record<string, unknown> = { organizationId: user.organizationId, deletedAt: null };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.customerId) filter.customerId = req.query.customerId;
    if (search) {
      const q = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ number: q }, { "customerSnapshot.name": q }, { "customerSnapshot.phone": q }];
    }
    if (req.query.from || req.query.to) {
      filter.createdAt = {
        ...(req.query.from ? { $gte: new Date(String(req.query.from)) } : {}),
        ...(req.query.to ? { $lte: new Date(String(req.query.to)) } : {})
      };
    }
    const [rows, total] = await Promise.all([
      Order.find(filter).populate("customerId").skip(skip).limit(limit).sort(safeSort(sort, ["createdAt", "number", "status", "updatedAt"])),
      Order.countDocuments(filter)
    ]);
    return paginated(res, rows.map((row) => presentOrder(row, user)), { page, limit, total });
  })
);

router.post(
  "/preview",
  requirePermission("orders.create"),
  validate(documentSchema),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const { customer, priced } = await priceForCustomer(user, req.body);
    return ok(res, {
      customer: { name: customer.name, creditLimit: customer.creditLimit, outstanding: customer.outstanding, creditHold: customer.creditHold },
      items: priced.items,
      totals: priced.totals
    });
  })
);

router.get(
  "/:id/invoice.pdf",
  requirePermission("orders.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const order = await Order.findOne({ _id: paramId(req.params.id), organizationId: user.organizationId });
    if (!order) throw ApiError.notFound("Order not found");
    const invoice = await Invoice.findOne({ orderId: order._id });
    const pdf = await renderOrderBillPdf(order, user.organizationId, "invoice", `${invoice?.number || order.number}.pdf`);
    if (invoice) {
      invoice.pdfUrl = pdf.url;
      invoice.reprintCount = (invoice.reprintCount ?? 0) + 1;
      await invoice.save();
    }
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${order.number}.pdf"`);
    return res.sendFile(pdf.filePath);
  })
);

router.get(
  "/:id/ebill.pdf",
  requirePermission("orders.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const order = await Order.findOne({ _id: paramId(req.params.id), organizationId: user.organizationId });
    if (!order) throw ApiError.notFound("Order not found");
    if (!["delivered", "completed"].includes(order.status)) {
      throw ApiError.unprocessable("E-bill is issued when the order is delivered or completed");
    }
    const invoice = await issueOrderEBill(user, order);
    const pdf = await renderOrderBillPdf(order, user.organizationId, "ebill", `ebill-${invoice?.number || order.number}.pdf`);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="ebill-${order.number}.pdf"`);
    return res.sendFile(pdf.filePath);
  })
);

router.patch(
  "/:id",
  requirePermission("orders.edit"),
  validate(documentSchema.partial().extend({ items: z.array(lineSchema).min(1).optional() })),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const order = await Order.findOne({ _id: paramId(req.params.id), organizationId: user.organizationId, deletedAt: null });
    if (!order) throw ApiError.notFound("Order not found");
    if (order.locked && user.roleSlug !== "owner") throw ApiError.forbidden("Order is locked");
    if (!["draft"].includes(order.status) && user.roleSlug !== "owner") {
      throw ApiError.unprocessable("Only draft orders can be edited");
    }
    const body = {
      customerId: String(req.body.customerId ?? order.customerId),
      items: req.body.items ?? order.items.map((i: { itemId: unknown; variantId?: unknown; quantity: number; unitPrice: number; discountType?: string; discountValue?: number }) => ({
        itemId: String(i.itemId),
        variantId: i.variantId ? String(i.variantId) : undefined,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        discountType: i.discountType,
        discountValue: i.discountValue
      })),
      discountType: req.body.discountType ?? order.discountType,
      discountValue: req.body.discountValue ?? order.discountValue,
      couponCode: req.body.couponCode ?? order.couponCode,
      charges: req.body.charges ?? order.charges,
      deliveryCharges: req.body.deliveryCharges ?? order.deliveryCharges,
      roundOff: req.body.roundOff ?? order.roundOff,
      autoRound: req.body.autoRound,
      taxInclusive: req.body.taxInclusive ?? order.taxInclusive,
      interstate: req.body.interstate ?? order.interstate,
      notes: req.body.notes ?? order.notes
    };
    const { customer, priced } = await priceForCustomer(user, body);
    const paid = Number(order.totals.paidAmount ?? 0);
    order.customerId = customer._id;
    order.customerSnapshot = { name: customer.name, phone: customer.phone, email: customer.email, code: customer.code, businessName: customer.business?.name, gstin: customer.business?.gstin };
    order.items = priced.items.map((i, idx: number) => ({
      ...i,
      designStatus: order.items[idx]?.designStatus ?? (i.requiresDesign ? "pending" : "not_required")
    }));
    order.charges = body.charges ?? [];
    order.discountType = body.discountType;
    order.discountValue = body.discountValue;
    order.couponCode = body.couponCode;
    order.deliveryCharges = body.deliveryCharges;
    order.roundOff = priced.totals.roundOff;
    order.taxInclusive = body.taxInclusive;
    order.interstate = body.interstate;
    order.notes = body.notes;
    order.totals = { ...priced.totals, paidAmount: paid, balanceDue: Math.max(0, priced.totals.grandTotal - paid) };
    await order.save();
    await recalcOutstanding(String(customer._id));
    await writeAudit(req as AuthedRequest, "order.update", "Order", String(order._id));
    return ok(res, order);
  })
);

router.get(
  "/:id",
  requirePermission("orders.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const order = await Order.findOne({ _id: paramId(req.params.id), organizationId: user.organizationId }).populate("customerId assignedDesigner");
    if (!order) throw ApiError.notFound("Order not found");
    const [history, designs, jobs, payments, invoices] = await Promise.all([
      OrderStatusHistory.find({ orderId: order._id, organizationId: user.organizationId }).sort("createdAt").populate("userId", "name"),
      DesignFile.find({ orderId: order._id, deletedAt: null }).sort("createdAt"),
      ProductionJob.find({ orderId: order._id, deletedAt: null }),
      Payment.find({ orderId: order._id, deletedAt: null }),
      Invoice.find({ orderId: order._id, deletedAt: null })
    ]);
    return ok(res, { order: presentOrder(order, user), history, designs, jobs, payments, invoices });
  })
);

router.get(
  "/:id/timeline",
  requirePermission("orders.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const order = await Order.findOne({ _id: paramId(req.params.id), organizationId: user.organizationId, deletedAt: null });
    if (!order) throw ApiError.notFound("Order not found");
    const history = await OrderStatusHistory.find({ orderId: order._id, organizationId: user.organizationId }).sort("createdAt").populate("userId", "name");
    return ok(res, history);
  })
);

router.post(
  "/",
  requirePermission("orders.create"),
  validate(documentSchema),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const idempotencyKey = String(req.get("Idempotency-Key") ?? req.body.idempotencyKey ?? "");
    const result = await createOrderRecord(user, { ...req.body, idempotencyKey: idempotencyKey || undefined });
    let log = null;
    if (!result.replayed) {
      const customer = await Customer.findById(result.order.customerId);
      const org = await Organization.findById(user.organizationId);
      await writeAudit(req as AuthedRequest, "order.create", "Order", String(result.order._id));
      log = await queueNotification({
        organizationId: user.organizationId,
        event: "order_created",
        to: customer?.whatsapp || customer?.phone || "",
        vars: {
          customer_name: customer?.name,
          order_number: result.order.number,
          grand_total: result.order.totals.grandTotal,
          business_name: org?.name
        },
        referenceType: "Order",
        referenceId: String(result.order._id)
      });
    } else {
      log = await latestShareFor(user.organizationId, "Order", String(result.order._id));
    }
    return created(res, withWhatsappShare(result.order, log));
  })
);

router.post(
  "/:id/status",
  requirePermission("orders.change_status"),
  validate(z.object({ status: z.string(), reason: z.string().optional(), expectedDate: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const order = await Order.findOne({ _id: paramId(req.params.id), organizationId: user.organizationId });
    if (!order) throw ApiError.notFound("Order not found");
    if (req.body.status === "order_created" && CONFIRM_FROM.has(order.status) && !hasPermission(user, "orders.approve")) {
      throw ApiError.forbidden("Confirming an order requires the approve permission");
    }
    const next = await OrderStatus.findOne({ organizationId: user.organizationId, code: req.body.status, active: true });
    const current = await OrderStatus.findOne({ organizationId: user.organizationId, code: order.status });
    const designBlocked = order.items.some(
      (i: { requiresDesign?: boolean; designStatus?: string }) => i.requiresDesign && i.designStatus !== "approved"
    );
    assertStatusChange({
      locked: order.locked,
      isOwner: user.roleSlug === "owner",
      fromStatus: order.status,
      toStatus: req.body.status,
      allowedTransitions: current?.allowedTransitions,
      requiresReason: next?.requiresReason,
      reason: req.body.reason,
      designBlocked
    });
    if (req.body.status === "cancelled") {
      order.cancelReason = req.body.reason;
    }
    if (req.body.status === "delayed") {
      order.delayReason = req.body.reason;
      if (req.body.expectedDate) order.expectedDate = new Date(req.body.expectedDate);
    }
    if (shouldLockOrder(req.body.status)) {
      order.locked = true;
    }
    const from = order.status;
    order.status = req.body.status;
    await order.save();
    await OrderStatusHistory.create({
      organizationId: user.organizationId,
      orderId: order._id,
      fromStatus: from,
      toStatus: req.body.status,
      reason: req.body.reason,
      userId: user.id
    });
    if (req.body.status === "ready_to_print") {
      await provisionJobsForOrder(user, order);
    }
    let invoiceNumber = "";
    if (["delivered", "completed"].includes(req.body.status)) {
      const invoice = await issueOrderEBill(user, order);
      invoiceNumber = invoice?.number || "";
    }
    await writeAudit(req as AuthedRequest, "order.status", "Order", String(order._id), { from }, { to: req.body.status });
    const log = await notifyOrderEvent(user.organizationId, order, eventForOrderStatus(req.body.status), {
      status_name: next?.name || req.body.status.replaceAll("_", " "),
      reason: req.body.reason,
      reason_suffix: req.body.reason ? `: ${req.body.reason}` : "",
      invoice_number: invoiceNumber
    });
    return ok(res, withWhatsappShare({ ...order.toObject(), eBillIssued: Boolean(invoiceNumber) }, log));
  })
);

router.post(
  "/:id/payments",
  requirePermission("finance.payments"),
  validate(z.object({ amount: z.number().positive(), method: z.string(), reference: z.string().optional(), notes: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const result = await recordOrderPayment(user, paramId(req.params.id), req.body);
    if (!result.replayed) await writeAudit(req as AuthedRequest, "order.payment", "Payment", String(result.payment._id));
    const log = result.replayed
      ? await latestShareFor(user.organizationId, "Order", String(result.order._id))
      : await notifyOrderEvent(user.organizationId, result.order, "payment_received", {
          amount: req.body.amount,
          payment_method: req.body.method
        });
    return created(res, { payment: result.payment, order: result.order, replayed: result.replayed, whatsapp: log ? shareFromLog(log) : undefined });
  })
);

router.patch(
  "/:id/items/:itemId/design-status",
  requireAny("designs.manage", "orders.change_status"),
  validate(
    z.object({
      status: z.enum(["not_required", "pending", "uploaded", "awaiting_approval", "approved", "rejected"]),
      note: z.string().max(500).optional()
    })
  ),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const order = await Order.findOne({ _id: paramId(req.params.id), organizationId: user.organizationId, deletedAt: null });
    if (!order) throw ApiError.notFound("Order not found");
    const item = order.items.id(paramId(req.params.itemId));
    if (!item) throw ApiError.notFound("Order item not found");
    const nextStatus = req.body.status as string;
    const staffRoles = new Set(["owner", "administrator", "order_manager"]);
    if (["approved", "rejected"].includes(nextStatus) && !staffRoles.has(user.roleSlug)) {
      throw ApiError.forbidden("Only owner, administrator or order manager can record offline design approval");
    }
    const from = item.designStatus;
    item.designStatus = nextStatus;
    const latest = await DesignFile.findOne({ orderId: order._id, orderItemId: item._id, deletedAt: null }).sort("-version");
    if (nextStatus === "approved") {
      if (latest) {
        latest.status = "approved";
        await latest.save();
        item.approvedDesignId = latest._id;
        await DesignApproval.create({
          organizationId: user.organizationId,
          orderId: order._id,
          orderItemId: item._id,
          designFileId: latest._id,
          action: "approved",
          approvedByName: user.name || "Staff",
          message: req.body.note || "Approved offline",
          immutable: true
        });
      }
    }
    if (nextStatus === "rejected" && latest) {
      latest.status = "rejected";
      await latest.save();
      await DesignApproval.create({
        organizationId: user.organizationId,
        orderId: order._id,
        orderItemId: item._id,
        designFileId: latest._id,
        action: "rejected",
        approvedByName: user.name || "Staff",
        reason: req.body.note || "Rejected offline",
        immutable: true
      });
    }
    await order.save();
    await writeAudit(
      req as AuthedRequest,
      "order.design_status",
      "Order",
      String(order._id),
      { itemId: String(item._id), from },
      { status: nextStatus, note: req.body.note, offline: true }
    );
    return ok(res, presentOrder(order, user));
  })
);

router.post(
  "/:id/designs",
  requirePermission("designs.manage"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const order = await Order.findOne({ _id: paramId(req.params.id), organizationId: user.organizationId });
    if (!order) throw ApiError.notFound("Order not found");
    const orderItemId = String(req.body.orderItemId);
    const item = order.items.id(orderItemId);
    if (!item) throw ApiError.notFound("Order item not found");
    const last = await DesignFile.findOne({ orderId: order._id, orderItemId }).sort("-version");
    const file = req.file;
    if (!file) throw ApiError.badRequest("File required");
    const design = await DesignFile.create({
      organizationId: user.organizationId,
      orderId: order._id,
      orderItemId,
      version: (last?.version ?? 0) + 1,
      fileName: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      url: `/uploads/${file.filename}`,
      hash: sha256(file.filename),
      uploadedBy: user.id,
      visibility: "customer",
      status: "sent",
      publicToken: randomToken()
    });
    item.designStatus = "awaiting_approval";
    order.status = "awaiting_design_approval";
    await order.save();
    const customer = await Customer.findById(order.customerId);
    const link = publicUrl(`/approve/design/${design.publicToken}`);
    const log = await queueNotification({
      organizationId: user.organizationId,
      event: "design_uploaded",
      to: customer?.whatsapp || customer?.phone || "",
      vars: {
        customer_name: customer?.name,
        order_number: order.number,
        approval_link: link,
        business_name: (await Organization.findById(user.organizationId))?.name
      },
      referenceType: "DesignFile",
      referenceId: String(design._id)
    });
    return created(res, { design, approvalLink: link, whatsapp: shareFromLog(log) });
  })
);

router.post(
  "/from-quotation/:quotationId",
  requirePermission("orders.create"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const quotation = await Quotation.findOne({
      _id: paramId(req.params.quotationId),
      organizationId: user.organizationId
    });
    if (!quotation) throw ApiError.notFound("Quotation not found");
    if (quotation.status === "converted" && quotation.convertedOrderId) {
      const existing = await Order.findById(quotation.convertedOrderId);
      if (existing) {
        const log = await latestShareFor(user.organizationId, "Order", String(existing._id));
        return created(res, withWhatsappShare(existing, log));
      }
    }
    if (quotation.status !== "approved") throw ApiError.unprocessable("Quotation must be approved");
    const result = await createOrderRecord(
      user,
      {
        customerId: String(quotation.customerId),
        items: quotation.items.map((i: { itemId: unknown; variantId?: unknown; quantity?: number; unitPrice?: number; discountType?: string; discountValue?: number }) => ({
          itemId: String(i.itemId),
          variantId: i.variantId ? String(i.variantId) : undefined,
          quantity: i.quantity ?? 1,
          unitPrice: i.unitPrice,
          discountType: i.discountType,
          discountValue: i.discountValue
        })),
        discountType: quotation.discountType,
        discountValue: quotation.discountValue,
        couponCode: quotation.couponCode,
        charges: quotation.charges,
        deliveryCharges: quotation.deliveryCharges,
        roundOff: quotation.roundOff,
        taxInclusive: quotation.taxInclusive,
        interstate: quotation.interstate,
        notes: quotation.notes,
        source: "quotation",
        submit: true,
        idempotencyKey: `quote:${String(quotation._id)}`
      },
      { quotationId: String(quotation._id) }
    );
    quotation.status = "converted";
    quotation.convertedOrderId = result.order._id;
    await quotation.save();
    await writeAudit(req as AuthedRequest, "quotation.convert", "Order", String(result.order._id));
    const log = result.replayed
      ? await latestShareFor(user.organizationId, "Order", String(result.order._id))
      : await notifyOrderEvent(user.organizationId, result.order, "order_created");
    return created(res, withWhatsappShare(result.order, log));
  })
);

router.post(
  "/:id/cancel",
  requirePermission("orders.cancel"),
  validate(z.object({ reason: z.string().min(3) })),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const order = await Order.findOne({ _id: paramId(req.params.id), organizationId: user.organizationId });
    if (!order) throw ApiError.notFound("Order not found");
    const from = order.status;
    if (["delivered", "completed"].includes(from) && user.roleSlug !== "owner") {
      throw ApiError.forbidden("Completed orders cannot be cancelled");
    }
    order.status = "cancelled";
    order.cancelReason = req.body.reason;
    await order.save();
    await OrderStatusHistory.create({
      organizationId: user.organizationId,
      orderId: order._id,
      fromStatus: from,
      toStatus: "cancelled",
      reason: req.body.reason,
      userId: user.id
    });
    await recalcOutstanding(String(order.customerId));
    await releaseOrderReservations(user, String(order._id));
    await writeAudit(req as AuthedRequest, "order.cancel", "Order", String(order._id), { from }, { reason: req.body.reason });
    const log = await notifyOrderEvent(user.organizationId, order, "order_cancelled", {
      status_name: "cancelled",
      reason: req.body.reason,
      reason_suffix: req.body.reason ? `: ${req.body.reason}` : ""
    });
    return ok(res, withWhatsappShare(order, log));
  })
);

router.post(
  "/:id/whatsapp",
  requirePermission("orders.view"),
  validate(z.object({ event: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const order = await Order.findOne({ _id: paramId(req.params.id), organizationId: user.organizationId, deletedAt: null });
    if (!order) throw ApiError.notFound("Order not found");
    const event = req.body.event || eventForOrderStatus(order.status);
    const log = await notifyOrderEvent(user.organizationId, order, event, {
      status_name: order.status.replaceAll("_", " ")
    });
    return ok(res, { order: withWhatsappShare(order, log), whatsapp: shareFromLog(log) });
  })
);

export default router;
