import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../../config/env";
import { asyncHandler } from "../../common/asyncHandler";
import { ok } from "../../common/response";
import { ApiError } from "../../common/errors";
import { sha256, randomToken } from "../../common/crypto";
import { resolvePermissions } from "../../common/permissions";
import { User, Session, Role } from "../../models/User";
import { Organization, Branch } from "../../models/Organization";
import { authenticate, signAccessToken, signRefreshToken, type AuthedRequest } from "../../middleware/auth";
import { validate } from "../../middleware/validate";
import { writeAudit } from "../../middleware/audit";
import rateLimit from "express-rate-limit";

const router = Router();

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: env.isTest ? 1000 : 40,
  standardHeaders: true,
  legacyHeaders: false
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6)
});

router.post(
  "/login",
  authLimiter,
  validate(loginSchema),
  asyncHandler(async (req, res) => {
    const { email, password } = req.body as z.infer<typeof loginSchema>;
    const user = await User.findOne({ email: email.toLowerCase(), deletedAt: null });
    if (!user || !user.active) throw ApiError.unauthorized("Invalid credentials");
    const match = await bcrypt.compare(password, user.passwordHash);
    if (!match) throw ApiError.unauthorized("Invalid credentials");
    const role = await Role.findById(user.roleId);
    if (!role) throw ApiError.unauthorized("Role missing");
    const permissions = resolvePermissions(role, user.permissionOverrides);
    const accessToken = signAccessToken({
      sub: String(user._id),
      org: String(user.organizationId),
      branchId: user.branchId ? String(user.branchId) : undefined,
      role: role.slug
    });
    const refreshToken = signRefreshToken({ sub: String(user._id), jti: randomToken(16) });
    const days = 7;
    await Session.create({
      organizationId: user.organizationId,
      branchId: user.branchId,
      userId: user._id,
      refreshTokenHash: sha256(refreshToken),
      userAgent: req.get("user-agent"),
      ip: req.ip,
      expiresAt: new Date(Date.now() + days * 86400000)
    });
    user.lastLoginAt = new Date();
    await user.save();
    const [organization, branch] = await Promise.all([
      Organization.findById(user.organizationId).select("name timezone"),
      user.branchId ? Branch.findById(user.branchId).select("name code") : null
    ]);
    return ok(res, {
      accessToken,
      refreshToken,
      expiresIn: env.jwtAccessExpires,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        avatarUrl: user.avatarUrl,
        organizationId: user.organizationId,
        branchId: user.branchId,
        organization,
        branch,
        permissions,
        role: { id: role._id, name: role.name, slug: role.slug, permissions }
      }
    });
  })
);

router.post(
  "/refresh",
  asyncHandler(async (req, res) => {
    const token = String(req.body?.refreshToken ?? "");
    if (!token) throw ApiError.unauthorized();
    let decoded: jwt.JwtPayload;
    try {
      decoded = jwt.verify(token, env.jwtRefreshSecret) as jwt.JwtPayload;
    } catch {
      throw ApiError.unauthorized("Invalid refresh token");
    }
    const session = await Session.findOne({
      userId: decoded.sub,
      refreshTokenHash: sha256(token),
      revokedAt: null
    });
    if (!session || session.expiresAt < new Date()) throw ApiError.unauthorized("Session revoked");
    const user = await User.findById(decoded.sub);
    if (!user || !user.active) throw ApiError.unauthorized();
    session.revokedAt = new Date();
    await session.save();
    const refreshToken = signRefreshToken({ sub: String(user._id), jti: randomToken(16) });
    await Session.create({
      organizationId: user.organizationId,
      branchId: user.branchId,
      userId: user._id,
      refreshTokenHash: sha256(refreshToken),
      userAgent: req.get("user-agent"),
      ip: req.ip,
      expiresAt: new Date(Date.now() + 7 * 86400000)
    });
    const accessToken = signAccessToken({
      sub: String(user._id),
      org: String(user.organizationId),
      branchId: user.branchId ? String(user.branchId) : undefined
    });
    return ok(res, { accessToken, refreshToken });
  })
);

router.post(
  "/logout",
  authenticate,
  asyncHandler(async (req, res) => {
    await Session.updateMany({ userId: (req as AuthedRequest).user.id, revokedAt: null }, { revokedAt: new Date() });
    return ok(res, { loggedOut: true });
  })
);

router.get(
  "/me",
  authenticate,
  asyncHandler(async (req, res) => {
    const { user } = req as AuthedRequest;
    const dbUser = await User.findById(user.id).select("-passwordHash -passwordResetToken");
    const role = await Role.findById(user.roleId);
    const [organization, branch] = await Promise.all([
      Organization.findById(user.organizationId).select("name timezone"),
      user.branchId ? Branch.findById(user.branchId).select("name code") : null
    ]);
    return ok(res, { ...dbUser?.toObject(), role, permissions: user.permissions, organization, branch });
  })
);

router.post(
  "/forgot-password",
  authLimiter,
  validate(z.object({ email: z.string().email() })),
  asyncHandler(async (req, res) => {
    const user = await User.findOne({ email: req.body.email.toLowerCase(), deletedAt: null });
    if (user) {
      user.passwordResetToken = sha256(`${user.email}:${Date.now()}`);
      user.passwordResetExpires = new Date(Date.now() + 3600000);
      await user.save();
    }
    return ok(res, { queued: true }, "If the account exists, a reset link will be sent");
  })
);

router.post(
  "/reset-password",
  authLimiter,
  validate(z.object({ token: z.string(), password: z.string().min(8) })),
  asyncHandler(async (req, res) => {
    const user = await User.findOne({
      passwordResetToken: req.body.token,
      passwordResetExpires: { $gt: new Date() }
    });
    if (!user) throw ApiError.badRequest("Invalid or expired token");
    user.passwordHash = await bcrypt.hash(req.body.password, env.bcryptRounds);
    user.passwordResetToken = undefined;
    user.passwordResetExpires = undefined;
    await user.save();
    await Session.updateMany({ userId: user._id }, { revokedAt: new Date() });
    return ok(res, { reset: true });
  })
);

router.patch(
  "/me",
  authenticate,
  validate(z.object({ name: z.string().min(2).optional(), phone: z.string().optional(), avatarUrl: z.string().optional() })),
  asyncHandler(async (req, res) => {
    const user = await User.findByIdAndUpdate((req as AuthedRequest).user.id, req.body, { new: true }).select("-passwordHash");
    await writeAudit(req as AuthedRequest, "user.profile.update", "User", String(user?._id), null, user);
    return ok(res, user);
  })
);

export default router;
