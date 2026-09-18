import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler";
import { ok, created } from "../../common/response";
import { NotificationTemplate, NotificationLog } from "../../models/Settings";
import { ensureDefaultTemplates, queueNotification, shareFromLog } from "../../common/notify";
import { authenticate, type AuthedRequest } from "../../middleware/auth";
import { requireAny, requirePermission } from "../../middleware/rbac";
import { ApiError } from "../../common/errors";

const router = Router();
router.use(authenticate);

const shareRead = requireAny("orders.view", "quotations.view", "customers.view", "settings.manage");
const shareWrite = requireAny("orders.create", "orders.change_status", "quotations.send", "customers.create", "customers.update", "finance.payments", "settings.manage");

router.get(
  "/templates",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    await ensureDefaultTemplates(user.organizationId);
    return ok(res, await NotificationTemplate.find({ organizationId: user.organizationId, deletedAt: null }).sort("event"));
  })
);

router.post(
  "/templates",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const tpl = await NotificationTemplate.create({ ...req.body, organizationId: user.organizationId });
    return created(res, tpl);
  })
);

router.patch(
  "/templates/:id",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const tpl = await NotificationTemplate.findOneAndUpdate(
      { _id: req.params.id, organizationId: user.organizationId, deletedAt: null },
      req.body,
      { new: true }
    );
    if (!tpl) throw ApiError.notFound("Template not found");
    return ok(res, tpl);
  })
);

router.delete(
  "/templates/:id",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const tpl = await NotificationTemplate.findOneAndUpdate(
      { _id: req.params.id, organizationId: user.organizationId, deletedAt: null },
      { deletedAt: new Date(), enabled: false },
      { new: true }
    );
    if (!tpl) throw ApiError.notFound("Template not found");
    return ok(res, { deleted: true, id: String(tpl._id) });
  })
);

router.get(
  "/logs",
  shareRead,
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const filter: Record<string, unknown> = { organizationId: user.organizationId };
    if (req.query.referenceType) filter.referenceType = req.query.referenceType;
    if (req.query.referenceId) filter.referenceId = req.query.referenceId;
    const logs = await NotificationLog.find(filter).sort("-createdAt").limit(100);
    return ok(
      res,
      logs.map((log) => ({ ...log.toObject(), whatsapp: shareFromLog(log) }))
    );
  })
);

router.post(
  "/test",
  requirePermission("settings.manage"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const log = await queueNotification({
      organizationId: user.organizationId,
      event: req.body.event || "test",
      channel: req.body.channel,
      to: req.body.to,
      vars: req.body.vars ?? { customer_name: "Test", business_name: "Infy PrintOS" }
    });
    return ok(res, { ...log.toObject(), whatsapp: shareFromLog(log) });
  })
);

router.post(
  "/logs/:id/mark-sent",
  shareWrite,
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const log = await NotificationLog.findOneAndUpdate(
      { _id: req.params.id, organizationId: user.organizationId },
      { status: "sent" },
      { new: true }
    );
    if (!log) throw ApiError.notFound("Share not found");
    return ok(res, { ...log.toObject(), whatsapp: shareFromLog(log) });
  })
);

export default router;
