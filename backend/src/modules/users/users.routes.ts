import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../../common/asyncHandler";
import { ok, created, paginated } from "../../common/response";
import { authenticate, type AuthedRequest } from "../../middleware/auth";
import { requireAny, requirePermission } from "../../middleware/rbac";
import { validate } from "../../middleware/validate";
import { writeAudit } from "../../middleware/audit";
import {
  permissionCatalog,
  listRoles,
  getRole,
  createRole,
  updateRole,
  resetRole,
  duplicateRole,
  deleteRole,
  listUsers,
  getUser,
  createUser,
  updateUser,
  deleteUser,
  revokeSessions
} from "./users.service";

const router = Router();
router.use(authenticate);

const overridesSchema = z
  .object({
    grant: z.array(z.string()).optional(),
    revoke: z.array(z.string()).optional()
  })
  .optional();

router.get(
  "/permissions",
  requireAny("users.view", "roles.manage"),
  asyncHandler(async (_req, res) => ok(res, permissionCatalog()))
);

router.get(
  "/roles",
  requireAny("users.view", "roles.manage"),
  asyncHandler(async (req, res) => ok(res, await listRoles((req as AuthedRequest).user)))
);

router.get(
  "/roles/:id",
  requireAny("users.view", "roles.manage"),
  asyncHandler(async (req, res) => ok(res, await getRole((req as AuthedRequest).user, String(req.params.id))))
);

router.post(
  "/roles",
  requirePermission("roles.manage"),
  validate(
    z.object({
      name: z.string().min(2).max(80),
      slug: z.string().min(2).max(80).optional(),
      description: z.string().max(240).optional(),
      permissions: z.array(z.string()).default([]),
      active: z.boolean().optional()
    })
  ),
  asyncHandler(async (req, res) => {
    const role = await createRole((req as AuthedRequest).user, req.body);
    await writeAudit(req as AuthedRequest, "role.create", "Role", String(role._id), null, role);
    return created(res, role);
  })
);

router.patch(
  "/roles/:id",
  requirePermission("roles.manage"),
  validate(
    z.object({
      name: z.string().min(2).max(80).optional(),
      slug: z.string().min(2).max(80).optional(),
      description: z.string().max(240).optional(),
      permissions: z.array(z.string()).optional(),
      active: z.boolean().optional()
    })
  ),
  asyncHandler(async (req, res) => {
    const before = await getRole((req as AuthedRequest).user, String(req.params.id));
    const role = await updateRole((req as AuthedRequest).user, String(req.params.id), req.body);
    await writeAudit(req as AuthedRequest, "role.update", "Role", String(role._id), before, role);
    return ok(res, role);
  })
);

router.post(
  "/roles/:id/reset",
  requirePermission("roles.manage"),
  asyncHandler(async (req, res) => {
    const role = await resetRole((req as AuthedRequest).user, String(req.params.id));
    await writeAudit(req as AuthedRequest, "role.reset", "Role", String(role._id), null, role);
    return ok(res, role);
  })
);

router.post(
  "/roles/:id/duplicate",
  requirePermission("roles.manage"),
  validate(z.object({ name: z.string().min(2).max(80).optional() })),
  asyncHandler(async (req, res) => {
    const role = await duplicateRole((req as AuthedRequest).user, String(req.params.id), req.body.name);
    await writeAudit(req as AuthedRequest, "role.duplicate", "Role", String(role._id), null, role);
    return created(res, role);
  })
);

router.delete(
  "/roles/:id",
  requirePermission("roles.manage"),
  asyncHandler(async (req, res) => {
    const before = await getRole((req as AuthedRequest).user, String(req.params.id));
    const result = await deleteRole((req as AuthedRequest).user, String(req.params.id));
    await writeAudit(req as AuthedRequest, "role.delete", "Role", result.id, before, null);
    return ok(res, result);
  })
);

router.get(
  "/",
  requirePermission("users.view"),
  asyncHandler(async (req, res) => {
    const { rows, meta } = await listUsers((req as AuthedRequest).user, req);
    return paginated(res, rows, meta);
  })
);

router.get(
  "/:id",
  requirePermission("users.view"),
  asyncHandler(async (req, res) => ok(res, await getUser((req as AuthedRequest).user, String(req.params.id))))
);

router.post(
  "/",
  requirePermission("users.manage"),
  validate(
    z.object({
      name: z.string().min(2).max(80),
      email: z.string().email(),
      password: z.string().min(8).max(72),
      phone: z.string().max(32).optional(),
      roleId: z.string().min(1),
      branchId: z.string().optional(),
      department: z.string().max(80).optional(),
      permissionOverrides: overridesSchema
    })
  ),
  asyncHandler(async (req, res) => {
    const createdUser = await createUser((req as AuthedRequest).user, req.body);
    await writeAudit(req as AuthedRequest, "user.create", "User", String(createdUser._id), null, createdUser);
    return created(res, createdUser);
  })
);

router.patch(
  "/:id",
  requirePermission("users.manage"),
  validate(
    z.object({
      name: z.string().min(2).max(80).optional(),
      email: z.string().email().optional(),
      password: z.string().min(8).max(72).optional(),
      phone: z.string().max(32).optional(),
      roleId: z.string().optional(),
      branchId: z.string().optional(),
      department: z.string().max(80).optional(),
      active: z.boolean().optional(),
      permissionOverrides: overridesSchema
    })
  ),
  asyncHandler(async (req, res) => {
    const before = await getUser((req as AuthedRequest).user, String(req.params.id));
    const updated = await updateUser((req as AuthedRequest).user, String(req.params.id), req.body);
    await writeAudit(req as AuthedRequest, "user.update", "User", String(updated._id), before, updated);
    return ok(res, updated);
  })
);

router.delete(
  "/:id",
  requirePermission("users.manage"),
  asyncHandler(async (req, res) => {
    const before = await getUser((req as AuthedRequest).user, String(req.params.id));
    const result = await deleteUser((req as AuthedRequest).user, String(req.params.id));
    await writeAudit(req as AuthedRequest, "user.delete", "User", result.id, before, null);
    return ok(res, result);
  })
);

router.post(
  "/:id/revoke-sessions",
  requirePermission("users.manage"),
  asyncHandler(async (req, res) => {
    const result = await revokeSessions((req as AuthedRequest).user, String(req.params.id));
    await writeAudit(req as AuthedRequest, "user.revoke_sessions", "User", String(req.params.id));
    return ok(res, result);
  })
);

export default router;
