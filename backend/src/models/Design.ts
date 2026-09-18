import mongoose, { Schema } from "mongoose";
import { tenantPlugin } from "./plugins";

const designFileSchema = new Schema({
  orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
  orderItemId: { type: Schema.Types.ObjectId, required: true },
  version: { type: Number, default: 1 },
  fileName: String,
  mimeType: String,
  size: Number,
  url: String,
  hash: String,
  uploadedBy: { type: Schema.Types.ObjectId, ref: "User" },
  visibility: { type: String, enum: ["internal", "customer"], default: "customer" },
  notes: String,
  status: { type: String, enum: ["draft", "sent", "approved", "rejected", "locked"], default: "draft" },
  publicToken: String
});
tenantPlugin(designFileSchema);

const designApprovalSchema = new Schema({
  orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, index: true },
  orderItemId: Schema.Types.ObjectId,
  designFileId: { type: Schema.Types.ObjectId, ref: "DesignFile", required: true },
  action: { type: String, enum: ["approved", "rejected"], required: true },
  approvedByName: String,
  approvedByCustomerId: { type: Schema.Types.ObjectId, ref: "Customer" },
  message: String,
  reason: String,
  ip: String,
  userAgent: String,
  previewHash: String,
  revisionNumber: Number,
  immutable: { type: Boolean, default: true }
});
tenantPlugin(designApprovalSchema);

export const DesignFile = mongoose.model("DesignFile", designFileSchema) as mongoose.Model<any>;
export const DesignApproval = mongoose.model("DesignApproval", designApprovalSchema) as mongoose.Model<any>;
