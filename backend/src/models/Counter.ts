import mongoose, { Schema } from "mongoose";

const schema = new Schema(
  {
    organizationId: { type: Schema.Types.ObjectId, ref: "Organization", required: true, index: true },
    key: { type: String, required: true },
    seq: { type: Number, default: 0 }
  },
  { timestamps: true }
);

schema.index({ organizationId: 1, key: 1 }, { unique: true });

export const Counter = mongoose.model("Counter", schema);
