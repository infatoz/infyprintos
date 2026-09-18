import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { ok, created, paginated } from "../../common/response";
import { parsePagination, escapeRegex, safeSort } from "../../common/pagination";
import { ApiError } from "../../common/errors";
import { nextNumber } from "../../common/numbering";
import { randomToken } from "../../common/crypto";
import { env } from "../../config/env";
import { customerSnapshot } from "../../common/pricing";
import { queueNotification, publicUrl, shareFromLog } from "../../common/notify";
import { Quotation, QuotationVersion } from "../../models/Quotation";
import { Customer } from "../../models/Customer";
import { Organization } from "../../models/Organization";
import { authenticate, type AuthedRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { writeAudit } from "../../middleware/audit";
import { writeDocumentPdf, businessFromOrg, linesFromItems, partyFromSnapshot } from "../../common/pdf";
import { documentSchema, priceForCustomer } from "../orders/order.service";

const router = Router();
router.use(authenticate);

function paramId(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? "";
}

router.get(
  "/",
  requirePermission("quotations.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const { page, limit, skip, search, sort } = parsePagination(req);
    const filter: Record<string, unknown> = { organizationId: user.organizationId, deletedAt: null };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.customerId) filter.customerId = req.query.customerId;
    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ number: rx }, { "customerSnapshot.name": rx }, { "customerSnapshot.phone": rx }];
    }
    const [rows, total] = await Promise.all([
      Quotation.find(filter).populate("customerId").skip(skip).limit(limit).sort(safeSort(sort, ["createdAt", "updatedAt", "number", "status"])),
      Quotation.countDocuments(filter)
    ]);
    return paginated(res, rows, { page, limit, total });
  })
);

router.get(
  "/:id",
  requirePermission("quotations.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const quotation = await Quotation.findOne({ _id: paramId(req.params.id), organizationId: user.organizationId }).populate("customerId");
    if (!quotation) throw ApiError.notFound("Quotation not found");
    const versions = await QuotationVersion.find({ quotationId: quotation._id }).sort("revisionNumber");
    return ok(res, { ...quotation.toObject(), versions });
  })
);

router.get(
  "/:id/pdf",
  requirePermission("quotations.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const quotation = await Quotation.findOne({ _id: paramId(req.params.id), organizationId: user.organizationId });
    if (!quotation) throw ApiError.notFound("Quotation not found");
    const org = await Organization.findById(user.organizationId);
    const pdf = await writeDocumentPdf({
      kind: "quotation",
      number: quotation.number,
      business: businessFromOrg(org),
      customer: partyFromSnapshot(quotation.customerSnapshot),
      items: linesFromItems(quotation.items),
      totals: quotation.totals,
      notes: quotation.notes,
      terms: quotation.terms,
      footer: org?.invoiceFooter || org?.invoiceNotes || undefined,
      meta: {
        date: quotation.createdAt,
        validUntil: quotation.validUntil,
        taxInclusive: quotation.taxInclusive,
        placeOfSupply: org?.address?.state
      },
      filename: `${quotation.number}.pdf`
    });
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `inline; filename="${quotation.number}.pdf"`);
    return res.sendFile(pdf.filePath);
  })
);

router.patch(
  "/:id",
  requirePermission("quotations.update"),
  validate(documentSchema),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const quotation = await Quotation.findOne({ _id: paramId(req.params.id), organizationId: user.organizationId, deletedAt: null });
    if (!quotation) throw ApiError.notFound("Quotation not found");
    if (["converted", "cancelled"].includes(quotation.status)) throw ApiError.unprocessable("This quotation cannot be revised");
    const { customer, priced } = await priceForCustomer(user, req.body);
    quotation.customerId = customer._id;
    quotation.customerSnapshot = customerSnapshot(customer);
    quotation.items = priced.items;
    quotation.charges = req.body.charges ?? [];
    quotation.discountType = req.body.discountType ?? "none";
    quotation.discountValue = req.body.discountValue ?? 0;
    quotation.couponCode = req.body.couponCode;
    quotation.deliveryCharges = req.body.deliveryCharges ?? 0;
    quotation.roundOff = priced.totals.roundOff;
    quotation.taxInclusive = req.body.taxInclusive ?? false;
    quotation.interstate = req.body.interstate ?? false;
    quotation.totals = priced.totals;
    quotation.notes = req.body.notes;
    quotation.terms = req.body.terms;
    quotation.revisionNumber = (quotation.revisionNumber ?? 1) + 1;
    quotation.status = quotation.status === "rejected" ? "revision_requested" : "draft";
    await quotation.save();
    await QuotationVersion.create({
      organizationId: user.organizationId,
      quotationId: quotation._id,
      revisionNumber: quotation.revisionNumber,
      snapshot: quotation.toObject(),
      createdBy: user.id
    });
    await writeAudit(req as AuthedRequest, "quotation.revise", "Quotation", String(quotation._id));
    return ok(res, quotation);
  })
);

router.post(
  "/",
  requirePermission("quotations.create"),
  validate(documentSchema),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const customer = await Customer.findOne({ _id: req.body.customerId, organizationId: user.organizationId });
    if (!customer) throw ApiError.notFound("Customer not found");
    const { priced } = await priceForCustomer(user, req.body);
    const org = await Organization.findById(user.organizationId);
    const number = await nextNumber(org!._id, "quotation", org?.quotationPrefix ?? "QT");
    const quotation = await Quotation.create({
      organizationId: user.organizationId,
      branchId: user.branchId,
      number,
      customerId: customer._id,
      customerSnapshot: customerSnapshot(customer),
      status: "draft",
      items: priced.items,
      charges: req.body.charges ?? [],
      discountType: req.body.discountType ?? "none",
      discountValue: req.body.discountValue ?? 0,
      couponCode: req.body.couponCode,
      deliveryCharges: req.body.deliveryCharges ?? 0,
      roundOff: priced.totals.roundOff,
      taxInclusive: req.body.taxInclusive ?? false,
      interstate: req.body.interstate ?? false,
      totals: priced.totals,
      notes: req.body.notes,
      terms: req.body.terms,
      validUntil: req.body.validUntil ? new Date(req.body.validUntil) : new Date(Date.now() + 7 * 86400000),
      createdBy: user.id
    });
    await QuotationVersion.create({
      organizationId: user.organizationId,
      quotationId: quotation._id,
      revisionNumber: 1,
      snapshot: quotation.toObject(),
      createdBy: user.id
    });
    await writeAudit(req as AuthedRequest, "quotation.create", "Quotation", String(quotation._id));
    return created(res, quotation);
  })
);

router.post(
  "/:id/send",
  requirePermission("quotations.send"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const quotation = await Quotation.findOne({ _id: paramId(req.params.id), organizationId: user.organizationId }).populate("customerId");
    if (!quotation) throw ApiError.notFound("Quotation not found");
    quotation.publicToken = randomToken();
    quotation.publicTokenExpiresAt = new Date(Date.now() + env.publicLinkExpiresDays * 86400000);
    quotation.status = "awaiting_approval";
    quotation.sentAt = new Date();
    await quotation.save();
    const link = publicUrl(`/approve/quotation/${quotation.publicToken}`);
    const customer = quotation.customerId as unknown as { name: string; phone: string; whatsapp?: string };
    const org = await Organization.findById(user.organizationId);
    const log = await queueNotification({
      organizationId: user.organizationId,
      event: "quotation_sent",
      to: (customer as { whatsapp?: string }).whatsapp || customer.phone,
      vars: {
        customer_name: quotation.customerSnapshot?.name ?? customer.name,
        quotation_number: quotation.number,
        business_name: org?.name,
        grand_total: quotation.totals?.grandTotal,
        approval_link: link
      },
      referenceType: "Quotation",
      referenceId: String(quotation._id)
    });
    await writeAudit(req as AuthedRequest, "quotation.send", "Quotation", String(quotation._id));
    const whatsapp = shareFromLog(log);
    return ok(res, { quotation, share: log.payload, whatsapp, approvalLink: link });
  })
);

router.post(
  "/:id/cancel",
  requirePermission("quotations.update"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const quotation = await Quotation.findOneAndUpdate(
      { _id: paramId(req.params.id), organizationId: user.organizationId, status: { $nin: ["converted"] } },
      { status: "cancelled" },
      { new: true }
    );
    if (!quotation) throw ApiError.notFound("Quotation not found");
    await writeAudit(req as AuthedRequest, "quotation.cancel", "Quotation", String(quotation._id));
    return ok(res, quotation);
  })
);

router.delete(
  "/:id",
  requirePermission("quotations.delete"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const quotation = await Quotation.findOneAndUpdate(
      { _id: paramId(req.params.id), organizationId: user.organizationId, status: { $in: ["draft", "cancelled", "rejected"] }, deletedAt: null },
      { deletedAt: new Date() },
      { new: true }
    );
    if (!quotation) throw ApiError.conflict("Only draft, rejected or cancelled quotations can be deleted");
    await writeAudit(req as AuthedRequest, "quotation.delete", "Quotation", String(quotation._id));
    return ok(res, { deleted: true, id: String(quotation._id) });
  })
);

export default router;
