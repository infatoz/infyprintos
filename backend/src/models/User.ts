import mongoose, { Schema } from "mongoose";
import { tenantFields, tenantOptions } from "./plugins";

const roleSchema = new Schema({
  ...tenantFields,
  name: { type: String, required: true },
  slug: { type: String, required: true },
  description: String,
  permissions: [{ type: String }],
  system: { type: Boolean, default: false },
  active: { type: Boolean, default: true }
}, tenantOptions);
roleSchema.index({ organizationId: 1, slug: 1 }, { unique: true });

const userSchema = new Schema({
  ...tenantFields,
  name: { type: String, required: true },
  email: { type: String, required: true, lowercase: true, trim: true },
  phone: String,
  passwordHash: { type: String, required: true },
  avatarUrl: String,
  roleId: { type: Schema.Types.ObjectId, ref: "Role", required: true },
  permissionOverrides: {
    grant: [{ type: String }],
    revoke: [{ type: String }]
  },
  department: String,
  active: { type: Boolean, default: true },
  emailVerifiedAt: Date,
  lastLoginAt: Date,
  passwordResetToken: String,
  passwordResetExpires: Date,
  twoFactorEnabled: { type: Boolean, default: false }
}, tenantOptions);
userSchema.index({ organizationId: 1, email: 1 }, { unique: true });

const sessionSchema = new Schema({
  ...tenantFields,
  userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
  refreshTokenHash: { type: String, required: true },
  userAgent: String,
  ip: String,
  revokedAt: Date,
  expiresAt: { type: Date, required: true }
}, tenantOptions);

export const Role = mongoose.model("Role", roleSchema) as mongoose.Model<any>;
export const User = mongoose.model("User", userSchema) as mongoose.Model<any>;
export const Session = mongoose.model("Session", sessionSchema) as mongoose.Model<any>;
