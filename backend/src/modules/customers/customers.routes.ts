import fs from "fs";
import path from "path";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/asyncHandler";
import { ok, created, paginated } from "../../common/response";
import { ApiError } from "../../common/errors";
import { sha256 } from "../../common/crypto";
import {
  Customer,
  CustomerAddress,
  CustomerDocument,
  CustomerTier,
  CreditTerm,
  CustomerContact,
  CustomerCreditEvent
} from "../../models/Customer";
import { FileAsset } from "../../models/Settings";
import { authenticate, type AuthedRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { writeAudit } from "../../middleware/audit";
import { kycDir, kycUpload, photoUpload } from "../../middleware/upload";
import { COUNTRIES, CUSTOMER_SOURCES, lookupIndianPincode } from "../../common/geo";
import {
  ADDRESS_TYPES,
  BUSINESS_CATEGORIES,
  BUSINESS_SIZES,
  GST_STATES,
  PINCODE_FORMAT,
  activityPayloadSchema,
  addressFields,
  contactPayloadSchema,
  customerPatchSchema,
  customerPayloadSchema,
  ensureSingleDefaultAddress,
  findDuplicateCustomers,
  routeId
} from "./customer.helpers";
import {
  addActivity,
  archiveCustomer,
  clearCustomerPhoto,
  createCustomer,
  customerMetrics,
  customerStatement,
  getCustomerDetail,
  getHistory,
  listAssignees,
  listCustomers,
  mergeCustomers,
  recalcCustomerBalances,
  reissueMembership,
  restoreCustomer,
  setCreditHold,
  setCustomerPhoto,
  updateCustomer,
  upsertContact,
  composeCustomerWhatsapp
} from "./customer.service";

const router = Router();
router.use(authenticate);

router.get(
  "/tiers",
  requirePermission("customers.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    return ok(res, await CustomerTier.find({ organizationId: user.organizationId, deletedAt: null, active: { $ne: false } }).sort("sortOrder"));
  })
);

router.get(
  "/credit-terms",
  requirePermission("customers.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    return ok(res, await CreditTerm.find({ organizationId: user.organizationId, deletedAt: null, active: { $ne: false } }));
  })
);

router.get(
  "/gst-states",
  requirePermission("customers.view"),
  asyncHandler(async (_req, res) => {
    return ok(
      res,
      Object.entries(GST_STATES).map(([code, name]) => ({ code, name }))
    );
  })
);

router.get(
  "/sources",
  requirePermission("customers.view"),
  asyncHandler(async (_req, res) => ok(res, [...CUSTOMER_SOURCES]))
);

router.get(
  "/categories",
  requirePermission("customers.view"),
  asyncHandler(async (_req, res) => ok(res, [...BUSINESS_CATEGORIES]))
);

router.get(
  "/sizes",
  requirePermission("customers.view"),
  asyncHandler(async (_req, res) => ok(res, [...BUSINESS_SIZES]))
);

router.get(
  "/countries",
  requirePermission("customers.view"),
  asyncHandler(async (_req, res) => ok(res, [...COUNTRIES]))
);

router.get(
  "/pincode/:pin",
  requirePermission("customers.view"),
  asyncHandler(async (req, res) => {
    const pin = String(req.params.pin ?? "").replace(/\D/g, "");
    if (!PINCODE_FORMAT.test(pin)) throw ApiError.unprocessable("Pincode must be a 6-digit Indian PIN code");
    const lookup = await lookupIndianPincode(pin);
    if (!lookup) throw ApiError.notFound("No locality found for this pincode");
    return ok(res, lookup);
  })
);

router.get(
  "/assignees",
  requirePermission("customers.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    return ok(res, await listAssignees(user.organizationId));
  })
);

router.get(
  "/metrics",
  requirePermission("customers.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    return ok(res, await customerMetrics(user.organizationId));
  })
);

router.get(
  "/duplicates",
  requirePermission("customers.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const matches = await findDuplicateCustomers({
      organizationId: user.organizationId,
      phone: String(req.query.phone ?? ""),
      email: String(req.query.email ?? ""),
      gstin: String(req.query.gstin ?? ""),
      excludeId: req.query.excludeId ? String(req.query.excludeId) : undefined
    });
    return ok(res, { matches, duplicate: matches.length > 0 });
  })
);

router.get(
  "/",
  requirePermission("customers.view"),
  asyncHandler(async (req, res) => {
    const { rows, page, limit, total } = await listCustomers(req as AuthedRequest);
    return paginated(res, rows, { page, limit, total });
  })
);

router.get(
  "/:id/history",
  requirePermission("customers.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const id = routeId(req.params.id, "Customer not found");
    return ok(res, await getHistory(user.organizationId, id));
  })
);

router.get(
  "/:id/statement",
  requirePermission("customers.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const id = routeId(req.params.id, "Customer not found");
    return ok(res, await customerStatement(user.organizationId, id));
  })
);

router.get(
  "/:id/contacts",
  requirePermission("customers.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const id = routeId(req.params.id, "Customer not found");
    await getCustomerDetail(user.organizationId, id);
    const contacts = await CustomerContact.find({ customerId: id, organizationId: user.organizationId, deletedAt: null }).sort("-isPrimary name");
    return ok(res, contacts);
  })
);

router.get(
  "/:id/activities",
  requirePermission("customers.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const id = routeId(req.params.id, "Customer not found");
    const detail = await getCustomerDetail(user.organizationId, id);
    return ok(res, detail.activities);
  })
);

router.get(
  "/:id/credit-events",
  requirePermission("customers.credit"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const id = routeId(req.params.id, "Customer not found");
    const events = await CustomerCreditEvent.find({ customerId: id, organizationId: user.organizationId, deletedAt: null })
      .populate("createdBy", "name email")
      .sort("-createdAt")
      .limit(100);
    return ok(res, events);
  })
);

router.get(
  "/:id",
  requirePermission("customers.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const id = routeId(req.params.id, "Customer not found");
    const includeDeleted = String(req.query.includeDeleted) === "true";
    if (includeDeleted && !user.permissions.includes("customers.delete") && user.roleSlug !== "owner") {
      throw ApiError.forbidden();
    }
    return ok(res, await getCustomerDetail(user.organizationId, id, includeDeleted));
  })
);

router.post(
  "/",
  requirePermission("customers.create"),
  validate(customerPayloadSchema),
  asyncHandler(async (req, res) => {
    const result = await createCustomer(req as AuthedRequest, req.body);
    return created(res, result);
  })
);

router.patch(
  "/:id",
  requirePermission("customers.update"),
  validate(customerPatchSchema),
  asyncHandler(async (req, res) => {
    const id = routeId(req.params.id, "Customer not found");
    return ok(res, await updateCustomer(req as AuthedRequest, id, req.body));
  })
);

router.post(
  "/:id/photo",
  requirePermission("customers.update"),
  photoUpload.single("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) throw ApiError.unprocessable("Choose a profile photo");
    const id = routeId(req.params.id, "Customer not found");
    const customer = await setCustomerPhoto(req as AuthedRequest, id, req.file);
    await writeAudit(req as AuthedRequest, "customer.photo.update", "Customer", id);
    return ok(res, { photoUrl: customer.photoUrl });
  })
);

router.delete(
  "/:id/photo",
  requirePermission("customers.update"),
  asyncHandler(async (req, res) => {
    const id = routeId(req.params.id, "Customer not found");
    await clearCustomerPhoto(req as AuthedRequest, id);
    await writeAudit(req as AuthedRequest, "customer.photo.remove", "Customer", id);
    return ok(res, { photoUrl: null });
  })
);

router.delete(
  "/:id",
  requirePermission("customers.delete"),
  asyncHandler(async (req, res) => {
    const id = routeId(req.params.id, "Customer not found");
    return ok(res, await archiveCustomer(req as AuthedRequest, id));
  })
);

router.post(
  "/:id/restore",
  requirePermission("customers.delete"),
  asyncHandler(async (req, res) => {
    const id = routeId(req.params.id, "Customer not found");
    return ok(res, await restoreCustomer(req as AuthedRequest, id));
  })
);

router.post(
  "/:id/merge",
  requirePermission("customers.delete"),
  validate(z.object({ sourceId: z.string().min(1), reason: z.string().min(3) })),
  asyncHandler(async (req, res) => {
    const id = routeId(req.params.id, "Customer not found");
    const sourceId = routeId(req.body.sourceId, "Source customer not found");
    return ok(res, await mergeCustomers(req as AuthedRequest, id, sourceId, req.body.reason));
  })
);

router.post(
  "/:id/recalc-balances",
  requirePermission("customers.update"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const id = routeId(req.params.id, "Customer not found");
    await getCustomerDetail(user.organizationId, id);
    return ok(res, await recalcCustomerBalances(id));
  })
);

router.post(
  "/:id/membership/reissue",
  requirePermission("customers.update"),
  asyncHandler(async (req, res) => {
    const id = routeId(req.params.id, "Customer not found");
    return ok(res, await reissueMembership(req as AuthedRequest, id));
  })
);

router.post(
  "/:id/addresses",
  requirePermission("customers.update"),
  validate(addressFields.extend({ type: z.enum(ADDRESS_TYPES).optional(), isDefault: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const id = routeId(req.params.id, "Customer not found");
    const owner = await Customer.findOne({ _id: id, organizationId: user.organizationId, deletedAt: null });
    if (!owner) throw ApiError.notFound("Customer not found");
    const address = await CustomerAddress.create({
      ...req.body,
      organizationId: user.organizationId,
      customerId: id,
      type: req.body.type ?? "billing",
      isDefault: req.body.isDefault ?? true
    });
    if (address.isDefault) await ensureSingleDefaultAddress(user.organizationId, id, address.type, String(address._id));
    await writeAudit(req as AuthedRequest, "customer.address.create", "CustomerAddress", String(address._id));
    return created(res, address);
  })
);

router.patch(
  "/:id/addresses/:addressId",
  requirePermission("customers.update"),
  validate(addressFields.partial().extend({ type: z.enum(ADDRESS_TYPES).optional(), isDefault: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const id = routeId(req.params.id, "Customer not found");
    const addressId = routeId(req.params.addressId, "Address not found");
    const address = await CustomerAddress.findOneAndUpdate(
      { _id: addressId, customerId: id, organizationId: user.organizationId, deletedAt: null },
      req.body,
      { new: true }
    );
    if (!address) throw ApiError.notFound("Address not found");
    if (address.isDefault) await ensureSingleDefaultAddress(user.organizationId, id, address.type, String(address._id));
    await writeAudit(req as AuthedRequest, "customer.address.update", "CustomerAddress", String(address._id));
    return ok(res, address);
  })
);

router.delete(
  "/:id/addresses/:addressId",
  requirePermission("customers.update"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const id = routeId(req.params.id, "Customer not found");
    const addressId = routeId(req.params.addressId, "Address not found");
    const address = await CustomerAddress.findOneAndUpdate(
      { _id: addressId, customerId: id, organizationId: user.organizationId, deletedAt: null },
      { deletedAt: new Date() },
      { new: true }
    );
    if (!address) throw ApiError.notFound("Address not found");
    await writeAudit(req as AuthedRequest, "customer.address.delete", "CustomerAddress", String(address._id));
    return ok(res, { archived: true });
  })
);

router.post(
  "/:id/contacts",
  requirePermission("customers.update"),
  validate(contactPayloadSchema),
  asyncHandler(async (req, res) => {
    const id = routeId(req.params.id, "Customer not found");
    return created(res, await upsertContact(req as AuthedRequest, id, req.body));
  })
);

router.patch(
  "/:id/contacts/:contactId",
  requirePermission("customers.update"),
  validate(contactPayloadSchema.partial().extend({ name: z.string().min(2).optional() })),
  asyncHandler(async (req, res) => {
    const id = routeId(req.params.id, "Customer not found");
    const contactId = routeId(req.params.contactId, "Contact not found");
    return ok(res, await upsertContact(req as AuthedRequest, id, req.body, contactId));
  })
);

router.delete(
  "/:id/contacts/:contactId",
  requirePermission("customers.update"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const id = routeId(req.params.id, "Customer not found");
    const contactId = routeId(req.params.contactId, "Contact not found");
    const contact = await CustomerContact.findOneAndUpdate(
      { _id: contactId, customerId: id, organizationId: user.organizationId, deletedAt: null },
      { deletedAt: new Date() },
      { new: true }
    );
    if (!contact) throw ApiError.notFound("Contact not found");
    await writeAudit(req as AuthedRequest, "customer.contact.delete", "CustomerContact", contactId);
    return ok(res, { archived: true });
  })
);

router.post(
  "/:id/activities",
  requirePermission("customers.update"),
  validate(activityPayloadSchema),
  asyncHandler(async (req, res) => {
    const id = routeId(req.params.id, "Customer not found");
    return created(res, await addActivity(req as AuthedRequest, id, req.body));
  })
);

router.post(
  "/:id/documents",
  requirePermission("customers.kyc"),
  kycUpload.single("file"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const id = routeId(req.params.id, "Customer not found");
    const owner = await Customer.findOne({ _id: id, organizationId: user.organizationId, deletedAt: null });
    if (!owner) throw ApiError.notFound("Customer not found");
    const type = String(req.body.type ?? "").trim();
    if (!type) throw ApiError.unprocessable("Document type is required");
    let fileId;
    if (req.file) {
      const asset = await FileAsset.create({
        organizationId: user.organizationId,
        branchId: user.branchId,
        originalName: req.file.originalname,
        mimeType: req.file.mimetype,
        size: req.file.size,
        path: req.file.filename,
        url: `/api/v1/customers/${id}/documents/file/${req.file.filename}`,
        hash: sha256(req.file.filename),
        visibility: "private",
        uploadedBy: user.id
      });
      fileId = asset._id;
    } else if (req.body.fileId) {
      fileId = req.body.fileId;
    }
    const doc = await CustomerDocument.create({
      organizationId: user.organizationId,
      customerId: id,
      type,
      number: req.body.number || undefined,
      notes: req.body.notes || undefined,
      expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : undefined,
      fileId,
      status: "pending"
    });
    await writeAudit(req as AuthedRequest, "customer.kyc.upload", "CustomerDocument", String(doc._id), null, { type, hasFile: Boolean(req.file) });
    return created(res, doc);
  })
);

router.get(
  "/:id/documents/:docId/file",
  requirePermission("customers.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const id = routeId(req.params.id, "Customer not found");
    const docId = routeId(req.params.docId, "File not found");
    const doc = await CustomerDocument.findOne({
      _id: docId,
      customerId: id,
      organizationId: user.organizationId,
      deletedAt: null
    }).populate("fileId");
    if (!doc?.fileId) throw ApiError.notFound("File not found");
    const asset = doc.fileId as { path?: string; mimeType?: string; originalName?: string; organizationId?: { toString: () => string } };
    if (String(asset.organizationId) !== user.organizationId) throw ApiError.forbidden();
    const abs = path.join(kycDir, path.basename(String(asset.path ?? "")));
    if (!fs.existsSync(abs)) throw ApiError.notFound("File missing");
    res.setHeader("Content-Type", asset.mimeType || "application/octet-stream");
    res.setHeader("Content-Disposition", `inline; filename="${encodeURIComponent(asset.originalName || "kyc")}"`);
    fs.createReadStream(abs).pipe(res);
  })
);

router.post(
  "/:id/documents/:docId/verify",
  requirePermission("customers.kyc"),
  validate(z.object({ status: z.enum(["verified", "rejected", "expired"]), notes: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const id = routeId(req.params.id, "Customer not found");
    const docId = routeId(req.params.docId, "Document not found");
    const doc = await CustomerDocument.findOneAndUpdate(
      { _id: docId, customerId: id, organizationId: user.organizationId },
      { status: req.body.status, notes: req.body.notes, verifiedBy: user.id, verifiedAt: new Date() },
      { new: true }
    );
    if (!doc) throw ApiError.notFound("Document not found");
    await writeAudit(req as AuthedRequest, "customer.kyc.verify", "CustomerDocument", String(doc._id), null, { status: req.body.status });
    return ok(res, doc);
  })
);

router.post(
  "/:id/credit-hold",
  requirePermission("customers.credit"),
  validate(z.object({ hold: z.boolean(), reason: z.string().min(3) })),
  asyncHandler(async (req, res) => {
    const id = routeId(req.params.id, "Customer not found");
    return ok(res, await setCreditHold(req as AuthedRequest, id, req.body.hold, req.body.reason));
  })
);

router.post(
  "/:id/whatsapp",
  requirePermission("customers.view"),
  validate(z.object({ event: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const id = routeId(req.params.id, "Customer not found");
    return ok(res, await composeCustomerWhatsapp(req as AuthedRequest, id, req.body.event || "customer_created"));
  })
);

export default router;
