import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/asyncHandler";
import { ok, created, paginated } from "../../common/response";
import { parsePagination, escapeRegex, safeSort } from "../../common/pagination";
import { ApiError } from "../../common/errors";
import { nextNumber } from "../../common/numbering";
import { Department, Machine, ProductionJob } from "../../models/Production";
import { Organization } from "../../models/Organization";
import { User } from "../../models/User";
import { authenticate, type AuthedRequest } from "../../middleware/auth";
import { requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { writeAudit } from "../../middleware/audit";
import {
  MACHINE_TYPES,
  assertSchedule,
  completeJob,
  delayJob,
  holdJob,
  jobPatchSchema,
  patchJobFields,
  progressJob,
  provisionJobsForOrder,
  qualityJob,
  resumeJob,
  startJob
} from "./production.service";
import { Order } from "../../models/Order";

const router = Router();
router.use(authenticate);

function paramId(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value ?? "";
}

router.get(
  "/machine-types",
  requirePermission("production.view"),
  asyncHandler(async (_req, res) => ok(res, MACHINE_TYPES))
);

router.get(
  "/departments",
  requirePermission("production.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    return ok(res, await Department.find({ organizationId: user.organizationId, deletedAt: null }).sort("name"));
  })
);

router.post(
  "/departments",
  requirePermission("production.manage"),
  validate(z.object({ name: z.string().min(2), code: z.string().min(2) })),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const dept = await Department.create({
      ...req.body,
      code: String(req.body.code).toUpperCase(),
      organizationId: user.organizationId,
      branchId: user.branchId
    });
    return created(res, dept);
  })
);

router.patch(
  "/departments/:id",
  requirePermission("production.manage"),
  validate(z.object({ name: z.string().min(2).optional(), code: z.string().min(2).optional(), active: z.boolean().optional() })),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const patch = { ...req.body };
    if (patch.code) patch.code = String(patch.code).toUpperCase();
    const dept = await Department.findOneAndUpdate(
      { _id: paramId(req.params.id), organizationId: user.organizationId, deletedAt: null },
      patch,
      { new: true }
    );
    if (!dept) throw ApiError.notFound("Department not found");
    return ok(res, dept);
  })
);

router.get(
  "/machines",
  requirePermission("production.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    return ok(res, await Machine.find({ organizationId: user.organizationId, deletedAt: null }).sort("name"));
  })
);

router.post(
  "/machines",
  requirePermission("production.manage"),
  validate(
    z.object({
      name: z.string().min(2),
      code: z.string().min(2),
      type: z.string().optional(),
      department: z.string().optional(),
      capacity: z.string().optional(),
      costPerHour: z.number().optional(),
      notes: z.string().optional()
    })
  ),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const machine = await Machine.create({
      ...req.body,
      code: String(req.body.code).toUpperCase(),
      organizationId: user.organizationId,
      branchId: user.branchId
    });
    await writeAudit(req as AuthedRequest, "machine.create", "Machine", String(machine._id));
    return created(res, machine);
  })
);

router.patch(
  "/machines/:id",
  requirePermission("production.manage"),
  validate(
    z.object({
      name: z.string().min(2).optional(),
      type: z.string().optional(),
      department: z.string().optional(),
      capacity: z.string().optional(),
      costPerHour: z.number().optional(),
      status: z.enum(["available", "busy", "maintenance", "offline"]).optional(),
      notes: z.string().optional(),
      nextMaintenanceAt: z.string().optional(),
      active: z.boolean().optional()
    })
  ),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const patch = { ...req.body };
    if (patch.nextMaintenanceAt) patch.nextMaintenanceAt = new Date(patch.nextMaintenanceAt);
    const machine = await Machine.findOneAndUpdate(
      { _id: paramId(req.params.id), organizationId: user.organizationId, deletedAt: null },
      patch,
      { new: true }
    );
    if (!machine) throw ApiError.notFound("Machine not found");
    return ok(res, machine);
  })
);

router.get(
  "/staff",
  requirePermission("production.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const staff = await User.find({ organizationId: user.organizationId, deletedAt: null, active: true })
      .select("name email department roleId")
      .populate("roleId", "name slug")
      .sort("name");
    return ok(res, staff);
  })
);

router.get(
  "/jobs",
  requirePermission("production.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const { page, limit, skip, sort } = parsePagination(req);
    const filter: Record<string, unknown> = { organizationId: user.organizationId, deletedAt: null };
    if (req.query.status) filter.status = req.query.status;
    if (req.query.machineId) filter.machineId = req.query.machineId;
    if (req.query.assignedTo) filter.assignedTo = req.query.assignedTo;
    if (req.query.department) filter.department = req.query.department;
    if (req.query.priority) filter.priority = req.query.priority;
    if (req.query.orderId) filter.orderId = req.query.orderId;
    const delayed = req.query.delayed === "true";
    const search = String(req.query.search ?? "").trim();
    const extra: Record<string, unknown>[] = [];
    if (delayed) {
      extra.push({ $or: [{ status: "delayed" }, { scheduledEnd: { $lt: new Date() }, status: { $nin: ["completed", "rejected"] } }] });
    }
    if (search) {
      const rx = new RegExp(escapeRegex(search), "i");
      const orders = await Order.find({ organizationId: user.organizationId, number: rx, deletedAt: null }).select("_id");
      extra.push({ $or: [{ number: rx }, { title: rx }, { orderId: { $in: orders.map((o) => o._id) } }] });
    }
    if (extra.length === 1) Object.assign(filter, extra[0]);
    else if (extra.length > 1) filter.$and = extra;
    const [rows, total] = await Promise.all([
      ProductionJob.find(filter).populate("orderId machineId assignedTo").skip(skip).limit(limit).sort(safeSort(sort, ["createdAt", "number", "status", "priority", "updatedAt"])),
      ProductionJob.countDocuments(filter)
    ]);
    return paginated(res, rows, { page, limit, total });
  })
);

router.get(
  "/jobs/:id",
  requirePermission("production.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const job = await ProductionJob.findOne({
      _id: paramId(req.params.id),
      organizationId: user.organizationId,
      deletedAt: null
    }).populate("orderId machineId assignedTo");
    if (!job) throw ApiError.notFound("Job not found");
    return ok(res, job);
  })
);

router.post(
  "/jobs",
  requirePermission("production.manage"),
  validate(
    z.object({
      orderId: z.string(),
      orderItemId: z.string().optional(),
      title: z.string().optional(),
      department: z.string().optional(),
      machineId: z.string().optional(),
      assignedTo: z.string().optional(),
      priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
      scheduledStart: z.string().optional(),
      scheduledEnd: z.string().optional(),
      qtyPlanned: z.number().optional()
    })
  ),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const order = await Order.findOne({ _id: req.body.orderId, organizationId: user.organizationId, deletedAt: null });
    if (!order) throw ApiError.notFound("Order not found");
    assertSchedule(req.body.scheduledStart, req.body.scheduledEnd);
    if (req.body.orderItemId) {
      const existing = await ProductionJob.findOne({
        organizationId: user.organizationId,
        orderId: order._id,
        orderItemId: req.body.orderItemId,
        deletedAt: null
      });
      if (existing) return created(res, existing);
    }
    const org = await Organization.findById(user.organizationId);
    const number = await nextNumber(org!._id, "job", org?.jobPrefix ?? "JOB");
    const job = await ProductionJob.create({
      ...req.body,
      scheduledStart: req.body.scheduledStart ? new Date(req.body.scheduledStart) : undefined,
      scheduledEnd: req.body.scheduledEnd ? new Date(req.body.scheduledEnd) : undefined,
      number,
      organizationId: user.organizationId,
      branchId: user.branchId,
      events: [{ at: new Date(), userId: user.id, action: "created", toStatus: "pending" }]
    });
    await writeAudit(req as AuthedRequest, "job.create", "ProductionJob", String(job._id));
    return created(res, job);
  })
);

router.post(
  "/from-order/:orderId",
  requirePermission("production.manage"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const order = await Order.findOne({ _id: paramId(req.params.orderId), organizationId: user.organizationId, deletedAt: null });
    if (!order) throw ApiError.notFound("Order not found");
    const jobs = await provisionJobsForOrder(user, order);
    await writeAudit(req as AuthedRequest, "job.provision", "Order", String(order._id));
    return created(res, jobs);
  })
);

router.patch(
  "/jobs/:id",
  requirePermission("production.manage"),
  validate(jobPatchSchema),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const job = await ProductionJob.findOne({ _id: paramId(req.params.id), organizationId: user.organizationId, deletedAt: null });
    if (!job) throw ApiError.notFound("Job not found");
    if (req.body.status === "in_production") {
      const started = await startJob(user, String(job._id));
      return ok(res, started);
    }
    if (req.body.status === "completed") {
      const completed = await completeJob(user, String(job._id), {});
      return ok(res, completed);
    }
    if (req.body.status === "delayed") {
      throw ApiError.badRequest("Use POST /jobs/:id/delay with a reason");
    }
    if (req.body.status === "on_hold") {
      throw ApiError.badRequest("Use POST /jobs/:id/hold with a reason");
    }
    const patched = await patchJobFields(user, job, req.body);
    await writeAudit(req as AuthedRequest, "job.update", "ProductionJob", String(job._id));
    return ok(res, patched);
  })
);

router.post(
  "/jobs/:id/start",
  requirePermission("production.manage"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const job = await startJob(user, paramId(req.params.id));
    await writeAudit(req as AuthedRequest, "job.start", "ProductionJob", String(job._id));
    return ok(res, job);
  })
);

router.post(
  "/jobs/:id/complete",
  requirePermission("production.manage"),
  validate(
    z.object({
      qtyCompleted: z.number().optional(),
      qtyRejected: z.number().optional(),
      wastage: z.number().optional(),
      qualityNotes: z.string().optional(),
      passed: z.boolean().optional()
    })
  ),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const job = await completeJob(user, paramId(req.params.id), req.body);
    await writeAudit(req as AuthedRequest, "job.complete", "ProductionJob", String(job._id));
    return ok(res, job);
  })
);

router.post(
  "/jobs/:id/quality",
  requirePermission("production.manage"),
  validate(z.object({ passed: z.boolean(), notes: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const job = await qualityJob(user, paramId(req.params.id), req.body);
    await writeAudit(req as AuthedRequest, "job.quality", "ProductionJob", String(job._id));
    return ok(res, job);
  })
);

router.post(
  "/jobs/:id/delay",
  requirePermission("production.manage"),
  validate(z.object({ reason: z.string().min(3), scheduledEnd: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const job = await delayJob(user, paramId(req.params.id), req.body.reason, req.body.scheduledEnd);
    await writeAudit(req as AuthedRequest, "job.delay", "ProductionJob", String(job._id));
    return ok(res, job);
  })
);

router.post(
  "/jobs/:id/hold",
  requirePermission("production.manage"),
  validate(z.object({ reason: z.string().min(3) })),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const job = await holdJob(user, paramId(req.params.id), req.body.reason);
    await writeAudit(req as AuthedRequest, "job.hold", "ProductionJob", String(job._id));
    return ok(res, job);
  })
);

router.post(
  "/jobs/:id/resume",
  requirePermission("production.manage"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const job = await resumeJob(user, paramId(req.params.id));
    await writeAudit(req as AuthedRequest, "job.resume", "ProductionJob", String(job._id));
    return ok(res, job);
  })
);

router.post(
  "/jobs/:id/progress",
  requirePermission("production.manage"),
  validate(z.object({ qtyCompleted: z.number() })),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const job = await progressJob(user, paramId(req.params.id), req.body.qtyCompleted);
    await writeAudit(req as AuthedRequest, "job.progress", "ProductionJob", String(job._id));
    return ok(res, job);
  })
);

router.get(
  "/dashboard",
  requirePermission("production.view"),
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const orgId = user.organizationId;
    const now = new Date();
    const base = { organizationId: orgId, deletedAt: null };
    const [pending, ready, inProd, delayed, quality, completed, overdue, onHold, rejected, machines] = await Promise.all([
      ProductionJob.countDocuments({ ...base, status: "pending" }),
      ProductionJob.countDocuments({ ...base, status: "ready" }),
      ProductionJob.countDocuments({ ...base, status: "in_production" }),
      ProductionJob.countDocuments({ ...base, status: "delayed" }),
      ProductionJob.countDocuments({ ...base, status: "quality_check" }),
      ProductionJob.countDocuments({ ...base, status: "completed" }),
      ProductionJob.countDocuments({
        ...base,
        scheduledEnd: { $lt: now },
        status: { $nin: ["completed", "rejected"] }
      }),
      ProductionJob.countDocuments({ ...base, status: "on_hold" }),
      ProductionJob.countDocuments({ ...base, status: "rejected" }),
      Machine.find(base).select("status")
    ]);
    const delayedJobs = await ProductionJob.find({
      ...base,
      $or: [{ status: "delayed" }, { scheduledEnd: { $lt: now }, status: { $nin: ["completed", "rejected"] } }]
    })
      .populate("orderId", "number")
      .populate("assignedTo", "name")
      .sort("scheduledEnd")
      .limit(20);
    const machineList = machines as Array<{ status: string }>;
    return ok(res, {
      pending,
      ready,
      inProduction: inProd,
      delayed,
      qualityCheck: quality,
      completed,
      overdue,
      onHold,
      rejected,
      busyMachines: machineList.filter((m) => m.status === "busy").length,
      machineCount: machineList.length,
      delayedJobs
    });
  })
);

export default router;
