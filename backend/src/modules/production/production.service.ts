import mongoose from "mongoose";
import { z } from "zod";
import { ApiError } from "../../common/errors";
import { nextNumber } from "../../common/numbering";
import { withOptionalTransaction } from "../../common/transaction";
import { moveStock } from "../../common/inventory";
import { assertStatusChange, canTransition } from "../../common/workflow";
import { Organization } from "../../models/Organization";
import { Order, OrderStatus, OrderStatusHistory } from "../../models/Order";
import { Item } from "../../models/Catalog";
import { InventoryItem } from "../../models/Inventory";
import { Machine, ProductionJob } from "../../models/Production";
import type { AuthUser } from "../../middleware/auth";
import { consumeMaterials, explodeBom, reserveMaterials } from "../inventory/inventory.service";

export const JOB_STATUSES = ["pending", "ready", "in_production", "quality_check", "completed", "rejected", "delayed", "on_hold"] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];

export const MACHINE_TYPES = [
  { code: "offset", name: "Offset" },
  { code: "digital", name: "Digital" },
  { code: "wide_format", name: "Wide format" },
  { code: "screen", name: "Screen" },
  { code: "3d_printer", name: "3D printer" },
  { code: "finishing", name: "Finishing" },
  { code: "cutter", name: "Cutter" },
  { code: "other", name: "Other" }
] as const;

export const JOB_TRANSITIONS: Record<JobStatus, JobStatus[]> = {
  pending: ["ready", "delayed", "on_hold"],
  ready: ["in_production", "delayed", "on_hold", "pending"],
  in_production: ["quality_check", "completed", "delayed", "on_hold"],
  quality_check: ["completed", "in_production", "rejected"],
  delayed: ["ready", "in_production", "on_hold"],
  on_hold: ["ready", "in_production", "delayed"],
  rejected: ["ready", "in_production"],
  completed: []
};

export const jobPatchSchema = z.object({
  department: z.string().optional(),
  machineId: z.string().nullable().optional(),
  assignedTo: z.string().nullable().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  scheduledStart: z.string().optional(),
  scheduledEnd: z.string().optional(),
  notes: z.string().optional(),
  status: z.enum(JOB_STATUSES).optional()
});

type JobDoc = mongoose.Document & {
  _id: mongoose.Types.ObjectId;
  number: string;
  status: JobStatus;
  orderId: mongoose.Types.ObjectId;
  orderItemId?: mongoose.Types.ObjectId;
  machineId?: mongoose.Types.ObjectId | null;
  materialsConsumed?: boolean;
  actualStart?: Date;
  actualEnd?: Date;
  scheduledStart?: Date;
  scheduledEnd?: Date;
  qtyPlanned?: number;
  qtyCompleted?: number;
  qtyRejected?: number;
  wastage?: number;
  delayReason?: string;
  holdReason?: string;
  qualityNotes?: string;
  qualityCheck?: { passed?: boolean; notes?: string; inspectorId?: string; checkedAt?: Date };
  events?: Array<{ at?: Date; userId?: string; action?: string; fromStatus?: string; toStatus?: string; note?: string }>;
};

function asStatus(value: string): JobStatus {
  return (JOB_STATUSES.includes(value as JobStatus) ? value : "pending") as JobStatus;
}

function appendEvent(
  job: JobDoc,
  user: AuthUser,
  action: string,
  toStatus: string,
  note?: string
) {
  if (!Array.isArray(job.events)) job.events = [];
  job.events.push({
    at: new Date(),
    userId: user.id,
    action,
    fromStatus: job.status,
    toStatus,
    note
  });
}

export function assertSchedule(start?: Date | string | null, end?: Date | string | null) {
  if (!start || !end) return;
  const a = new Date(start);
  const b = new Date(end);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) throw ApiError.unprocessable("Invalid schedule");
  if (b < a) throw ApiError.unprocessable("Scheduled end must be after start");
}

async function assertMachineAvailable(
  user: AuthUser,
  machineId: string | undefined | null,
  excludeJobId: string,
  session?: mongoose.ClientSession
) {
  if (!machineId) return;
  const machine = await Machine.findOne({
    _id: machineId,
    organizationId: user.organizationId,
    deletedAt: null
  }).session(session ?? null);
  if (!machine) throw ApiError.notFound("Machine not found");
  if (machine.status === "maintenance" || machine.status === "offline") {
    throw ApiError.conflict(`${machine.name} is ${machine.status}`);
  }
  const busy = await ProductionJob.countDocuments({
    organizationId: user.organizationId,
    machineId,
    status: "in_production",
    deletedAt: null,
    _id: { $ne: excludeJobId }
  }).session(session ?? null);
  if (busy) throw ApiError.conflict("Machine is already running another job");
}

async function occupyMachine(user: AuthUser, machineId: unknown, session?: mongoose.ClientSession) {
  if (!machineId) return;
  await Machine.updateOne(
    { _id: machineId, organizationId: user.organizationId, status: { $nin: ["maintenance", "offline"] } },
    { status: "busy" },
    { session }
  );
}

async function releaseMachine(user: AuthUser, machineId: unknown, excludeJobId: string, session?: mongoose.ClientSession) {
  if (!machineId) return;
  const busy = await ProductionJob.countDocuments({
    organizationId: user.organizationId,
    machineId,
    status: "in_production",
    deletedAt: null,
    _id: { $ne: excludeJobId }
  }).session(session ?? null);
  if (busy) return;
  await Machine.updateOne(
    { _id: machineId, organizationId: user.organizationId, status: { $nin: ["maintenance", "offline"] } },
    { status: "available" },
    { session }
  );
}

async function maybeAdvanceOrder(
  user: AuthUser,
  orderId: unknown,
  session?: mongoose.ClientSession
) {
  const order = await Order.findById(orderId).session(session ?? null);
  if (!order || order.deletedAt || order.status === "cancelled") return;
  const jobs = await ProductionJob.find({
    organizationId: user.organizationId,
    orderId: order._id,
    deletedAt: null
  }).session(session ?? null);
  if (!jobs.length) return;

  const isOwner = user.roleSlug === "owner" || user.permissions.includes("settings.owner");
  const canChange = isOwner || user.permissions.includes("orders.change_status");
  if (!canChange) return;

  const current = await OrderStatus.findOne({ organizationId: user.organizationId, code: order.status }).session(session ?? null);
  const allClosed = jobs.every((j) => ["completed", "rejected"].includes(j.status));
  const anyRunning = jobs.some((j) => j.status === "in_production" || j.actualStart || j.materialsConsumed);

  let next = "";
  if (allClosed && ["ready_to_print", "in_production"].includes(order.status)) {
    next = "quality_check";
  } else if (anyRunning && order.status === "ready_to_print") {
    next = "in_production";
  }
  if (!next || next === order.status) return;
  if (!canTransition(current?.allowedTransitions, next, isOwner)) return;

  assertStatusChange({
    locked: order.locked,
    isOwner,
    fromStatus: order.status,
    toStatus: next,
    allowedTransitions: current?.allowedTransitions
  });
  const from = order.status;
  order.status = next;
  await order.save({ session });
  await OrderStatusHistory.create(
    [
      {
        organizationId: user.organizationId,
        orderId: order._id,
        fromStatus: from,
        toStatus: next,
        reason: "Production floor",
        userId: user.id
      }
    ],
    { session }
  );
}

export async function provisionJobsForOrder(
  user: AuthUser,
  order: {
    _id: unknown;
    number: string;
    items: Array<{ _id?: unknown; itemId?: unknown; variantId?: unknown; name?: string; quantity?: number }>;
  }
) {
  return withOptionalTransaction(async (session) => {
    const org = await Organization.findById(user.organizationId).session(session ?? null);
    const jobs = [];
    const reserveMap = new Map<string, number>();
    const materialsByLine: Array<{ item: (typeof order.items)[number]; named: Array<{ inventoryItemId: string; name?: string; quantity: number; unit?: string }> }> = [];
    for (const item of order.items) {
      const materials = await explodeBom({
        organizationId: user.organizationId,
        itemId: String(item.itemId),
        variantId: item.variantId ? String(item.variantId) : undefined,
        quantity: item.quantity ?? 1
      });
      const named = [];
      for (const mat of materials) {
        reserveMap.set(mat.inventoryItemId, (reserveMap.get(mat.inventoryItemId) ?? 0) + mat.quantity);
        const inv = await InventoryItem.findById(mat.inventoryItemId).session(session ?? null);
        named.push({ inventoryItemId: mat.inventoryItemId, name: inv?.name, quantity: mat.quantity, unit: mat.unit ?? inv?.unit });
      }
      materialsByLine.push({ item, named });
    }
    await reserveMaterials(
      user,
      [...reserveMap.entries()].map(([inventoryItemId, quantity]) => ({ inventoryItemId, quantity })),
      { orderId: String(order._id) },
      session
    );
    for (const { item, named } of materialsByLine) {
      let job = await ProductionJob.findOne({
        organizationId: user.organizationId,
        orderId: order._id,
        orderItemId: item._id,
        deletedAt: null
      }).session(session ?? null);
      if (!job) {
        const number = await nextNumber(org!._id, "job", org?.jobPrefix ?? "JOB", 5, session);
        const [created] = await ProductionJob.create(
          [
            {
              organizationId: user.organizationId,
              branchId: user.branchId,
              number,
              orderId: order._id,
              orderItemId: item._id,
              title: item.name,
              status: "ready",
              qtyPlanned: item.quantity,
              materials: named,
              events: [{ at: new Date(), userId: user.id, action: "provisioned", fromStatus: "pending", toStatus: "ready" }]
            }
          ],
          { session }
        );
        job = created;
      }
      jobs.push(job);
    }
    return jobs;
  });
}

export async function startJob(user: AuthUser, jobId: string) {
  return withOptionalTransaction(async (session) => {
    const job = (await ProductionJob.findOne({ _id: jobId, organizationId: user.organizationId, deletedAt: null }).session(
      session ?? null
    )) as JobDoc | null;
    if (!job) throw ApiError.notFound("Job not found");
    if (["completed", "rejected"].includes(job.status)) throw ApiError.unprocessable("Job already closed");
    const order = await Order.findById(job.orderId).session(session ?? null);
    if (!order) throw ApiError.notFound("Order not found");
    if (order.status === "cancelled") throw ApiError.unprocessable("Order is cancelled");
    await assertMachineAvailable(user, job.machineId ? String(job.machineId) : undefined, String(job._id), session);
    const line = order.items.id(job.orderItemId);
    if (!job.materialsConsumed) {
      const bom = await explodeBom({
        organizationId: user.organizationId,
        itemId: String(line?.itemId ?? ""),
        variantId: line?.variantId ? String(line.variantId) : undefined,
        quantity: job.qtyPlanned ?? line?.quantity ?? 1
      });
      if (bom.length) {
        await consumeMaterials(user, bom, { orderId: String(order._id), orderItemId: String(job.orderItemId), jobId: String(job._id) }, session);
      }
      job.materialsConsumed = true;
    }
    appendEvent(job, user, "start", "in_production");
    job.status = "in_production";
    job.actualStart = job.actualStart ?? new Date();
    job.holdReason = undefined;
    await job.save({ session });
    await occupyMachine(user, job.machineId, session);
    await maybeAdvanceOrder(user, job.orderId, session);
    return job;
  });
}

export async function completeJob(
  user: AuthUser,
  jobId: string,
  body: { qtyCompleted?: number; qtyRejected?: number; wastage?: number; qualityNotes?: string; passed?: boolean }
) {
  return withOptionalTransaction(async (session) => {
    const job = (await ProductionJob.findOne({ _id: jobId, organizationId: user.organizationId, deletedAt: null }).session(
      session ?? null
    )) as JobDoc | null;
    if (!job) throw ApiError.notFound("Job not found");
    if (job.status === "completed") return job;
    if (!job.actualStart && !job.materialsConsumed) {
      throw ApiError.unprocessable("Start the job before completing it");
    }
    const completed = Number(body.qtyCompleted ?? job.qtyPlanned ?? 0);
    const rejected = Number(body.qtyRejected ?? 0);
    const wastage = Number(body.wastage ?? job.wastage ?? 0);
    if (completed < 0 || rejected < 0 || wastage < 0) throw ApiError.unprocessable("Quantities cannot be negative");
    job.qtyCompleted = completed;
    job.qtyRejected = rejected;
    job.wastage = wastage;
    job.qualityNotes = body.qualityNotes ?? job.qualityNotes;
    job.qualityCheck = {
      passed: body.passed ?? rejected === 0,
      notes: body.qualityNotes,
      inspectorId: user.id,
      checkedAt: new Date()
    };
    const next = rejected && !completed ? "rejected" : "completed";
    appendEvent(job, user, "complete", next, body.qualityNotes);
    job.status = next;
    job.actualEnd = new Date();
    if (!job.actualStart) job.actualStart = job.actualEnd;
    await job.save({ session });

    const order = await Order.findById(job.orderId).session(session ?? null);
    const line = order?.items.id(job.orderItemId);
    if (completed > 0 && line?.itemId) {
      const catalog = await Item.findById(line.itemId).session(session ?? null);
      if (catalog?.inventoryItemId) {
        await moveStock({
          organizationId: user.organizationId,
          branchId: user.branchId,
          inventoryItemId: String(catalog.inventoryItemId),
          type: "inward",
          quantity: completed,
          referenceType: "ProductionJob",
          referenceId: String(job._id),
          reason: `Finished goods from ${job.number}`,
          userId: user.id,
          idempotencyKey: `fg:${String(job._id)}`,
          session
        });
      }
    }
    await releaseMachine(user, job.machineId, String(job._id), session);
    await maybeAdvanceOrder(user, job.orderId, session);
    return job;
  });
}

export async function delayJob(user: AuthUser, jobId: string, reason: string, scheduledEnd?: string) {
  const job = (await ProductionJob.findOne({ _id: jobId, organizationId: user.organizationId, deletedAt: null })) as JobDoc | null;
  if (!job) throw ApiError.notFound("Job not found");
  if (["completed", "rejected"].includes(job.status)) throw ApiError.unprocessable("Job already closed");
  if (scheduledEnd) assertSchedule(job.scheduledStart, scheduledEnd);
  appendEvent(job, user, "delay", "delayed", reason);
  job.status = "delayed";
  job.delayReason = reason;
  if (scheduledEnd) job.scheduledEnd = new Date(scheduledEnd);
  await job.save();
  await releaseMachine(user, job.machineId, String(job._id));
  return job;
}

export async function holdJob(user: AuthUser, jobId: string, reason: string) {
  const job = (await ProductionJob.findOne({ _id: jobId, organizationId: user.organizationId, deletedAt: null })) as JobDoc | null;
  if (!job) throw ApiError.notFound("Job not found");
  if (["completed", "rejected"].includes(job.status)) throw ApiError.unprocessable("Job already closed");
  appendEvent(job, user, "hold", "on_hold", reason);
  job.status = "on_hold";
  job.holdReason = reason;
  await job.save();
  await releaseMachine(user, job.machineId, String(job._id));
  return job;
}

export async function resumeJob(user: AuthUser, jobId: string) {
  return withOptionalTransaction(async (session) => {
    const job = (await ProductionJob.findOne({ _id: jobId, organizationId: user.organizationId, deletedAt: null }).session(
      session ?? null
    )) as JobDoc | null;
    if (!job) throw ApiError.notFound("Job not found");
    if (!["on_hold", "delayed"].includes(job.status)) throw ApiError.unprocessable("Job is not on hold or delayed");
    const started = Boolean(job.actualStart || job.materialsConsumed);
    if (started) {
      await assertMachineAvailable(user, job.machineId ? String(job.machineId) : undefined, String(job._id), session);
      appendEvent(job, user, "resume", "in_production");
      job.status = "in_production";
      await job.save({ session });
      await occupyMachine(user, job.machineId, session);
      await maybeAdvanceOrder(user, job.orderId, session);
      return job;
    }
    appendEvent(job, user, "resume", "ready");
    job.status = "ready";
    await job.save({ session });
    return job;
  });
}

export async function qualityJob(user: AuthUser, jobId: string, body: { passed: boolean; notes?: string }) {
  const job = (await ProductionJob.findOne({ _id: jobId, organizationId: user.organizationId, deletedAt: null })) as JobDoc | null;
  if (!job) throw ApiError.notFound("Job not found");
  if (!["in_production", "quality_check", "delayed", "on_hold"].includes(job.status)) {
    throw ApiError.unprocessable("Job must be on the floor before quality check");
  }
  if (!body.passed && String(body.notes ?? "").trim().length < 3) {
    throw ApiError.unprocessable("Rework notes are required when QC fails");
  }
  const next = body.passed ? "quality_check" : "in_production";
  if (!body.passed) {
    await assertMachineAvailable(user, job.machineId ? String(job.machineId) : undefined, String(job._id));
  }
  appendEvent(job, user, body.passed ? "qc_pass" : "qc_fail", next, body.notes);
  job.status = next;
  job.qualityNotes = body.notes;
  job.qualityCheck = { passed: body.passed, notes: body.notes, inspectorId: user.id, checkedAt: new Date() };
  await job.save();
  if (next === "quality_check") await releaseMachine(user, job.machineId, String(job._id));
  else await occupyMachine(user, job.machineId);
  return job;
}

export async function progressJob(user: AuthUser, jobId: string, qtyCompleted: number) {
  const job = (await ProductionJob.findOne({ _id: jobId, organizationId: user.organizationId, deletedAt: null })) as JobDoc | null;
  if (!job) throw ApiError.notFound("Job not found");
  if (!["in_production", "quality_check", "delayed", "on_hold"].includes(job.status)) {
    throw ApiError.unprocessable("Record progress after the job has started");
  }
  if (qtyCompleted < 0) throw ApiError.unprocessable("Completed quantity cannot be negative");
  appendEvent(job, user, "progress", job.status, `qty ${qtyCompleted}`);
  job.qtyCompleted = qtyCompleted;
  await job.save();
  return job;
}

export async function patchJobFields(user: AuthUser, job: JobDoc, body: z.infer<typeof jobPatchSchema>) {
  if (body.scheduledStart) job.scheduledStart = new Date(body.scheduledStart);
  if (body.scheduledEnd) job.scheduledEnd = new Date(body.scheduledEnd);
  assertSchedule(job.scheduledStart, job.scheduledEnd);
  if (body.department !== undefined) (job as { department?: string }).department = body.department;
  if (body.assignedTo !== undefined) (job as { assignedTo?: string | null }).assignedTo = body.assignedTo;
  if (body.priority) (job as { priority?: string }).priority = body.priority;
  if (body.notes !== undefined) (job as { notes?: string }).notes = body.notes;
  if (body.machineId !== undefined) {
    const nextMachine = body.machineId || null;
    const prev = job.machineId ? String(job.machineId) : "";
    if (job.status === "in_production") {
      await assertMachineAvailable(user, nextMachine, String(job._id));
    }
    job.machineId = nextMachine as unknown as mongoose.Types.ObjectId;
    if (prev && prev !== String(nextMachine ?? "")) await releaseMachine(user, prev, String(job._id));
    if (job.status === "in_production" && nextMachine) await occupyMachine(user, nextMachine);
  }
  if (body.status) job.status = asStatus(body.status);
  await job.save();
  return job;
}
