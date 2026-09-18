import type { Request } from "express";
import jwt from "jsonwebtoken";
import { env } from "../config/env";
import { ApiError } from "../common/errors";
import { User } from "../models/User";
import { Role } from "../models/User";
import { asyncHandler } from "../common/asyncHandler";
import { resolvePermissions, type Permission } from "../common/permissions";

export type AuthUser = {
  id: string;
  organizationId: string;
  branchId?: string;
  roleId: string;
  roleSlug: string;
  permissions: Permission[];
  name: string;
  email: string;
};

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export type AuthedRequest = Request & { user: AuthUser };

export function signAccessToken(payload: object) {
  return jwt.sign(payload, env.jwtAccessSecret, { expiresIn: env.jwtAccessExpires as jwt.SignOptions["expiresIn"] });
}

export function signRefreshToken(payload: object) {
  return jwt.sign(payload, env.jwtRefreshSecret, { expiresIn: env.jwtRefreshExpires as jwt.SignOptions["expiresIn"] });
}

export const authenticate = asyncHandler(async (req: Request, _res, next) => {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!token) throw ApiError.unauthorized();
  let decoded: jwt.JwtPayload;
  try {
    decoded = jwt.verify(token, env.jwtAccessSecret) as jwt.JwtPayload;
  } catch {
    throw ApiError.unauthorized("Session expired");
  }
  const user = await User.findOne({ _id: decoded.sub, deletedAt: null, active: true });
  if (!user) throw ApiError.unauthorized("User is inactive");
  const role = await Role.findById(user.roleId);
  if (!role) throw ApiError.unauthorized("Role missing");
  (req as AuthedRequest).user = {
    id: String(user._id),
    organizationId: String(user.organizationId),
    branchId: user.branchId ? String(user.branchId) : decoded.branchId,
    roleId: String(role._id),
    roleSlug: role.slug,
    permissions: resolvePermissions(role, user.permissionOverrides),
    name: user.name,
    email: user.email
  };
  next();
});
