import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/asyncHandler";
import { ok, created, paginated } from "../../common/response";
import { parsePagination, escapeRegex, safeSort } from "../../common/pagination";
import { ApiError } from "../../common/errors";
import { Organization, Branch } from "../../models/Organization";
import { Printer, PaymentMethod, Coupon, AuditLog, TaxRate } from "../../models/Settings";
import { OrderStatus } from "../../models/Order";
import { CustomerTier, CreditTerm } from "../../models/Customer";
import { authenticate, type AuthedRequest } from "../../middleware/auth";
import { requireAny, requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { writeAudit } from "../../middleware/audit";
import {
  createBranch,
  createCoupon,
  createCreditTerm,
  createPrinter,
  createStatus,
  createTaxRate,
  createTier,
  deleteBranch,
  deleteCoupon,
  deleteCreditTerm,
  deletePrinter,
  deleteStatus,
  deleteTaxRate,
  deleteTier,
  ensureTaxRates,
  listTaxRates,
  operationsPayload,
  ownerOrgPayload,
  updateBranch,
  updateCoupon,
  updateCreditTerm,
  updateOrganisation,
  updatePrinter,
  updateStatus,
  updateTaxRate,
  updateTier
} from "./settings.service";
import {
  createPaymentMethod,
  deletePaymentMethod,
  ensurePaymentMethods,
  listPaymentMethods,
  paymentMethodInputSchema,
  updatePaymentMethod
} from "../finance/finance.service";

const router = Router();
router.use(authenticate);

const manage = requirePermission("settings.manage");

function paramId(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? "";
}

router.get(
  "/business",
  manage,
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    await Promise.all([ensurePaymentMethods(user.organizationId, user.branchId), ensureTaxRates(user.organizationId, user.branchId)]);
    const [org, branches, printers, methods, statuses, tiers, terms, coupons, taxRates] = await Promise.all([
      Organization.findById(user.organizationId),
      Branch.find({ organizationId: user.organizationId, deletedAt: null }).sort("name"),
      Printer.find({ organizationId: user.organizationId, deletedAt: null }).sort("name"),
      PaymentMethod.find({ organizationId: user.organizationId, deletedAt: null }).sort("sortOrder name"),
      OrderStatus.find({ organizationId: user.organizationId, deletedAt: null }).sort("sortOrder"),
      CustomerTier.find({ organizationId: user.organizationId, deletedAt: null }).sort("sortOrder"),
      CreditTerm.find({ organizationId: user.organizationId, deletedAt: null }),
      Coupon.find({ organizationId: user.organizationId, deletedAt: null }).sort("code"),
      TaxRate.find({ organizationId: user.organizationId, deletedAt: null }).sort("sortOrder name")
    ]);
    return ok(res, { org, branches, printers, methods, statuses, tiers, terms, coupons, taxRates });
  })
);

router.get(
  "/payment-methods",
  requireAny("orders.create", "orders.view", "finance.payments", "finance.view", "finance.create_expense", "settings.manage"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    await ensurePaymentMethods(user.organizationId, user.branchId);
    return ok(res, await listPaymentMethods(user, { activeOnly: true }));
  })
);

router.get(
  "/tax-rates",
  requireAny("orders.create", "quotations.create", "catalog.view", "settings.manage"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    return ok(res, await listTaxRates(user.organizationId));
  })
);

router.get(
  "/coupons/:code",
  requireAny("orders.create", "quotations.create", "settings.manage"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const coupon = await Coupon.findOne({
      organizationId: user.organizationId,
      code: String(req.params.code).toUpperCase(),
      active: true,
      deletedAt: null
    });
    if (!coupon) throw ApiError.notFound("Coupon not found");
    if (coupon.expiresAt && coupon.expiresAt < new Date()) throw ApiError.badRequest("Coupon expired");
    return ok(res, coupon);
  })
);

router.patch(
  "/business",
  requirePermission("settings.owner"),
  asyncHandler(async (req, res) => {
    const org = await updateOrganisation((req as AuthedRequest).user, ownerOrgPayload(req.body ?? {}));
    await writeAudit(req as AuthedRequest, "settings.business.update", "Organization", String(org._id));
    return ok(res, org);
  })
);

router.patch(
  "/operations",
  manage,
  asyncHandler(async (req, res) => {
    const org = await updateOrganisation((req as AuthedRequest).user, operationsPayload(req.body ?? {}));
    await writeAudit(req as AuthedRequest, "settings.operations.update", "Organization", String(org._id));
    return ok(res, org);
  })
);

router.post(
  "/payment-methods",
  manage,
  validate(paymentMethodInputSchema),
  asyncHandler(async (req, res) => {
    const method = await createPaymentMethod((req as AuthedRequest).user, req.body);
    await writeAudit(req as AuthedRequest, "settings.method.create", "PaymentMethod", String(method._id));
    return created(res, method);
  })
);

router.patch(
  "/payment-methods/:id",
  manage,
  validate(paymentMethodInputSchema.partial()),
  asyncHandler(async (req, res) => {
    const method = await updatePaymentMethod((req as AuthedRequest).user, paramId(req.params.id), req.body);
    await writeAudit(req as AuthedRequest, "settings.method.update", "PaymentMethod", String(method._id));
    return ok(res, method);
  })
);

router.delete(
  "/payment-methods/:id",
  manage,
  asyncHandler(async (req, res) => {
    const result = await deletePaymentMethod((req as AuthedRequest).user, paramId(req.params.id));
    await writeAudit(req as AuthedRequest, "settings.method.delete", "PaymentMethod", result.id);
    return ok(res, result);
  })
);

const printerSchema = z.object({
  name: z.string().min(2).max(80),
  type: z.string().optional(),
  connectionType: z.string().optional(),
  paperSize: z.string().optional(),
  ip: z.string().optional(),
  port: z.coerce.number().optional(),
  copies: z.coerce.number().min(1).max(20).optional(),
  isDefault: z.boolean().optional(),
  header: z.string().optional(),
  footer: z.string().optional(),
  active: z.boolean().optional()
});

router.post(
  "/printers",
  manage,
  validate(printerSchema),
  asyncHandler(async (req, res) => {
    const printer = await createPrinter((req as AuthedRequest).user, req.body);
    await writeAudit(req as AuthedRequest, "settings.printer.create", "Printer", String(printer._id));
    return created(res, printer);
  })
);

router.patch(
  "/printers/:id",
  manage,
  validate(printerSchema.partial()),
  asyncHandler(async (req, res) => {
    const printer = await updatePrinter((req as AuthedRequest).user, paramId(req.params.id), req.body);
    await writeAudit(req as AuthedRequest, "settings.printer.update", "Printer", String(printer._id));
    return ok(res, printer);
  })
);

router.delete(
  "/printers/:id",
  manage,
  asyncHandler(async (req, res) => {
    const result = await deletePrinter((req as AuthedRequest).user, paramId(req.params.id));
    await writeAudit(req as AuthedRequest, "settings.printer.delete", "Printer", result.id);
    return ok(res, result);
  })
);

const branchSchema = z.object({
  name: z.string().min(2).max(80),
  code: z.string().min(2).max(16),
  phone: z.string().optional(),
  email: z.string().optional(),
  isDefault: z.boolean().optional(),
  active: z.boolean().optional(),
  address: z.record(z.string()).optional()
});

router.post(
  "/branches",
  manage,
  validate(branchSchema),
  asyncHandler(async (req, res) => {
    const branch = await createBranch((req as AuthedRequest).user, req.body);
    await writeAudit(req as AuthedRequest, "settings.branch.create", "Branch", String(branch._id));
    return created(res, branch);
  })
);

router.patch(
  "/branches/:id",
  manage,
  validate(branchSchema.partial()),
  asyncHandler(async (req, res) => {
    const branch = await updateBranch((req as AuthedRequest).user, paramId(req.params.id), req.body);
    await writeAudit(req as AuthedRequest, "settings.branch.update", "Branch", String(branch._id));
    return ok(res, branch);
  })
);

router.delete(
  "/branches/:id",
  manage,
  asyncHandler(async (req, res) => {
    const result = await deleteBranch((req as AuthedRequest).user, paramId(req.params.id));
    await writeAudit(req as AuthedRequest, "settings.branch.delete", "Branch", result.id);
    return ok(res, result);
  })
);

const statusSchema = z.object({
  name: z.string().min(2).max(80),
  code: z.string().optional(),
  color: z.string().optional(),
  sortOrder: z.coerce.number().optional(),
  customerLabel: z.string().optional(),
  requiresReason: z.boolean().optional(),
  terminal: z.boolean().optional(),
  allowedTransitions: z.array(z.string()).optional(),
  active: z.boolean().optional()
});

router.post(
  "/statuses",
  manage,
  validate(statusSchema),
  asyncHandler(async (req, res) => {
    const status = await createStatus((req as AuthedRequest).user, req.body);
    await writeAudit(req as AuthedRequest, "settings.status.create", "OrderStatus", String(status._id));
    return created(res, status);
  })
);

router.patch(
  "/statuses/:id",
  manage,
  validate(statusSchema.partial()),
  asyncHandler(async (req, res) => {
    const status = await updateStatus((req as AuthedRequest).user, paramId(req.params.id), req.body);
    await writeAudit(req as AuthedRequest, "settings.status.update", "OrderStatus", String(status._id));
    return ok(res, status);
  })
);

router.delete(
  "/statuses/:id",
  manage,
  asyncHandler(async (req, res) => {
    const result = await deleteStatus((req as AuthedRequest).user, paramId(req.params.id));
    await writeAudit(req as AuthedRequest, "settings.status.delete", "OrderStatus", result.id);
    return ok(res, result);
  })
);

router.post(
  "/tiers",
  manage,
  validate(
    z.object({
      name: z.string().min(2).max(80),
      slug: z.string().min(2).max(80).optional(),
      discountPercent: z.coerce.number().min(0).max(100).optional(),
      color: z.string().max(32).optional(),
      active: z.boolean().optional(),
      sortOrder: z.coerce.number().optional()
    })
  ),
  asyncHandler(async (req, res) => {
    const tier = await createTier((req as AuthedRequest).user, req.body);
    await writeAudit(req as AuthedRequest, "settings.tier.create", "CustomerTier", String(tier._id), null, tier);
    return created(res, tier);
  })
);

router.patch(
  "/tiers/:id",
  manage,
  validate(
    z.object({
      name: z.string().min(2).max(80).optional(),
      slug: z.string().min(2).max(80).optional(),
      discountPercent: z.coerce.number().min(0).max(100).optional(),
      color: z.string().max(32).optional(),
      active: z.boolean().optional(),
      sortOrder: z.coerce.number().optional()
    })
  ),
  asyncHandler(async (req, res) => {
    const tier = await updateTier((req as AuthedRequest).user, paramId(req.params.id), req.body);
    await writeAudit(req as AuthedRequest, "settings.tier.update", "CustomerTier", String(tier._id));
    return ok(res, tier);
  })
);

router.delete(
  "/tiers/:id",
  manage,
  asyncHandler(async (req, res) => {
    const result = await deleteTier((req as AuthedRequest).user, paramId(req.params.id));
    await writeAudit(req as AuthedRequest, "settings.tier.delete", "CustomerTier", result.id);
    return ok(res, result);
  })
);

router.post(
  "/credit-terms",
  manage,
  validate(
    z.object({
      name: z.string().min(2).max(80),
      slug: z.string().min(2).max(80).optional(),
      type: z.enum(["prepaid", "due_on_billing", "net_days", "custom"]),
      netDays: z.coerce.number().min(0).max(365).optional(),
      description: z.string().max(240).optional(),
      active: z.boolean().optional()
    })
  ),
  asyncHandler(async (req, res) => {
    const term = await createCreditTerm((req as AuthedRequest).user, req.body);
    await writeAudit(req as AuthedRequest, "settings.credit_term.create", "CreditTerm", String(term._id), null, term);
    return created(res, term);
  })
);

router.patch(
  "/credit-terms/:id",
  manage,
  validate(
    z.object({
      name: z.string().min(2).max(80).optional(),
      slug: z.string().min(2).max(80).optional(),
      type: z.enum(["prepaid", "due_on_billing", "net_days", "custom"]).optional(),
      netDays: z.coerce.number().min(0).max(365).optional(),
      description: z.string().max(240).optional(),
      active: z.boolean().optional()
    })
  ),
  asyncHandler(async (req, res) => {
    const term = await updateCreditTerm((req as AuthedRequest).user, paramId(req.params.id), req.body);
    await writeAudit(req as AuthedRequest, "settings.credit_term.update", "CreditTerm", String(term._id));
    return ok(res, term);
  })
);

router.delete(
  "/credit-terms/:id",
  manage,
  asyncHandler(async (req, res) => {
    const result = await deleteCreditTerm((req as AuthedRequest).user, paramId(req.params.id));
    await writeAudit(req as AuthedRequest, "settings.credit_term.delete", "CreditTerm", result.id);
    return ok(res, result);
  })
);

const couponSchema = z.object({
  code: z.string().min(2).max(32),
  type: z.enum(["fixed", "percent"]),
  value: z.coerce.number().positive(),
  minOrder: z.coerce.number().min(0).optional(),
  maxDiscount: z.coerce.number().min(0).optional(),
  expiresAt: z.string().optional(),
  active: z.boolean().optional()
});

router.post(
  "/coupons",
  manage,
  validate(couponSchema),
  asyncHandler(async (req, res) => {
    const coupon = await createCoupon((req as AuthedRequest).user, req.body);
    await writeAudit(req as AuthedRequest, "settings.coupon.create", "Coupon", String(coupon._id));
    return created(res, coupon);
  })
);

router.patch(
  "/coupons/:id",
  manage,
  validate(couponSchema.partial()),
  asyncHandler(async (req, res) => {
    const coupon = await updateCoupon((req as AuthedRequest).user, paramId(req.params.id), req.body);
    await writeAudit(req as AuthedRequest, "settings.coupon.update", "Coupon", String(coupon._id));
    return ok(res, coupon);
  })
);

router.delete(
  "/coupons/:id",
  manage,
  asyncHandler(async (req, res) => {
    const result = await deleteCoupon((req as AuthedRequest).user, paramId(req.params.id));
    await writeAudit(req as AuthedRequest, "settings.coupon.delete", "Coupon", result.id);
    return ok(res, result);
  })
);

const taxSchema = z.object({
  name: z.string().min(2).max(80),
  rate: z.coerce.number().min(0).max(100),
  hsn: z.string().optional(),
  description: z.string().optional(),
  sortOrder: z.coerce.number().optional(),
  active: z.boolean().optional()
});

router.post(
  "/tax-rates",
  manage,
  validate(taxSchema),
  asyncHandler(async (req, res) => {
    const rate = await createTaxRate((req as AuthedRequest).user, req.body);
    await writeAudit(req as AuthedRequest, "settings.tax.create", "TaxRate", String(rate._id));
    return created(res, rate);
  })
);

router.patch(
  "/tax-rates/:id",
  manage,
  validate(taxSchema.partial()),
  asyncHandler(async (req, res) => {
    const rate = await updateTaxRate((req as AuthedRequest).user, paramId(req.params.id), req.body);
    await writeAudit(req as AuthedRequest, "settings.tax.update", "TaxRate", String(rate._id));
    return ok(res, rate);
  })
);

router.delete(
  "/tax-rates/:id",
  manage,
  asyncHandler(async (req, res) => {
    const result = await deleteTaxRate((req as AuthedRequest).user, paramId(req.params.id));
    await writeAudit(req as AuthedRequest, "settings.tax.delete", "TaxRate", result.id);
    return ok(res, result);
  })
);

router.get(
  "/audit",
  requirePermission("audit.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const { page, limit, skip, search, sort } = parsePagination(req);
    const filter: Record<string, unknown> = { organizationId: user.organizationId };
    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      filter.$or = [{ action: rx }, { entityType: rx }];
    }
    const [logs, total] = await Promise.all([
      AuditLog.find(filter).populate("actorId", "name email").skip(skip).limit(limit).sort(safeSort(sort, ["createdAt", "action"], "-createdAt")),
      AuditLog.countDocuments(filter)
    ]);
    return paginated(res, logs, { page, limit, total });
  })
);

export default router;
