import { Schema } from "mongoose";

export const tenantFields = {
  organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
  branchId: { type: Schema.Types.ObjectId, ref: "Branch", index: true },
  deletedAt: { type: Date, default: null, index: true }
};

export const tenantOptions = { timestamps: true } as const;

export function tenantPlugin(schema: Schema) {
  schema.add(tenantFields);
  schema.set("timestamps", true);
}
