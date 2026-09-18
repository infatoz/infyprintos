import mongoose from "mongoose";
import { Counter } from "../models/Counter";

export async function nextNumber(
  organizationId: mongoose.Types.ObjectId,
  key: string,
  prefix: string,
  pad = 5,
  session?: mongoose.ClientSession
) {
  const year = new Date().getFullYear();
  const counterKey = `${key}:${year}`;
  const doc = await Counter.findOneAndUpdate(
    { organizationId, key: counterKey },
    { $inc: { seq: 1 } },
    { new: true, upsert: true, session }
  );
  return `${prefix}${year}${String(doc.seq).padStart(pad, "0")}`;
}
