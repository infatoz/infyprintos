import mongoose, { Schema } from "mongoose";
import { tenantPlugin } from "./plugins";

const machineSchema = new Schema({
  name: { type: String, required: true },
  code: { type: String, required: true },
  type: String,
  department: String,
  capacity: String,
  supportedMaterials: [String],
  costPerHour: { type: Number, default: 0 },
  status: { type: String, enum: ["available", "busy", "maintenance", "offline"], default: "available" },
  nextMaintenanceAt: Date,
  notes: String,
  active: { type: Boolean, default: true }
});
tenantPlugin(machineSchema);
machineSchema.index({ organizationId: 1, code: 1 }, { unique: true });

const departmentSchema = new Schema({
  name: { type: String, required: true },
  code: { type: String, required: true },
  active: { type: Boolean, default: true }
});
tenantPlugin(departmentSchema);
departmentSchema.index({ organizationId: 1, code: 1 }, { unique: true });

const jobSchema = new Schema({
  number: { type: String, required: true },
  orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
  orderItemId: Schema.Types.ObjectId,
  title: String,
  department: String,
  machineId: { type: Schema.Types.ObjectId, ref: "Machine" },
  assignedTo: { type: Schema.Types.ObjectId, ref: "User" },
  priority: { type: String, enum: ["low", "normal", "high", "urgent"], default: "normal" },
  scheduledStart: Date,
  scheduledEnd: Date,
  actualStart: Date,
  actualEnd: Date,
  status: {
    type: String,
    enum: ["pending", "ready", "in_production", "quality_check", "completed", "rejected", "delayed", "on_hold"],
    default: "pending",
    index: true
  },
  qtyPlanned: Number,
  qtyCompleted: { type: Number, default: 0 },
  qtyRejected: { type: Number, default: 0 },
  wastage: { type: Number, default: 0 },
  materials: [
    {
      inventoryItemId: { type: Schema.Types.ObjectId, ref: "InventoryItem" },
      name: String,
      quantity: Number,
      unit: String
    }
  ],
  materialsConsumed: { type: Boolean, default: false },
  delayReason: String,
  holdReason: String,
  qualityCheck: {
    passed: Boolean,
    notes: String,
    inspectorId: { type: Schema.Types.ObjectId, ref: "User" },
    checkedAt: Date
  },
  qualityNotes: String,
  notes: String,
  events: [
    {
      at: { type: Date, default: Date.now },
      userId: { type: Schema.Types.ObjectId, ref: "User" },
      action: String,
      fromStatus: String,
      toStatus: String,
      note: String
    }
  ]
});
tenantPlugin(jobSchema);
jobSchema.index({ organizationId: 1, number: 1 }, { unique: true });
jobSchema.index(
  { organizationId: 1, orderId: 1, orderItemId: 1 },
  { unique: true, partialFilterExpression: { orderItemId: { $exists: true } } }
);

export const Machine = mongoose.model("Machine", machineSchema) as mongoose.Model<any>;
export const Department = mongoose.model("Department", departmentSchema) as mongoose.Model<any>;
export const ProductionJob = mongoose.model("ProductionJob", jobSchema) as mongoose.Model<any>;
