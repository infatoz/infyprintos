import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { env } from "../../config/env";
import { ApiError } from "../../common/errors";
import { parsePagination, escapeRegex, safeSort } from "../../common/pagination";
import {
  ACCESS_MODULES,
  DEFAULT_ROLES,
  PERMISSION_GROUPS,
  PERMISSION_LABELS,
  PERMISSIONS,
  modulesForPermissions,
  permissionsNotHeld,
  resolvePermissions,
  sanitizePermissions,
  slugifyRole,
  type Permission
} from "../../common/permissions";
import type { AuthUser } from "../../middleware/auth";
import { Role, Session, User } from "../../models/User";
import type { Request } from "express";

const RESERVED_SLUGS = new Set(Object.keys(DEFAULT_ROLES));
const USER_SECRET = "-passwordHash -passwordResetToken -passwordResetExpires";

export type RoleInput = {
  name: string;
  slug?: string;
  description?: string;
  permissions?: string[];
  active?: boolean;
};

export type RolePatch = Partial<RoleInput>;

export type OverridesInput = {
  grant?: string[];
  revoke?: string[];
};

export type UserInput = {
  name: string;
  email: string;
  password: string;
  phone?: string;
  roleId: string;
  branchId?: string;
  department?: string;
  permissionOverrides?: OverridesInput;
};

export type UserPatch = {
  name?: string;
  email?: string;
  password?: string;
  phone?: string;
  roleId?: string;
  branchId?: string;
  department?: string;
  active?: boolean;
  permissionOverrides?: OverridesInput;
};

function oid(id: string) {
  return new mongoose.Types.ObjectId(id);
}

function isOwnerActor(actor: AuthUser) {
  return actor.roleSlug === "owner";
}

function asObject(doc: { toObject?: () => Record<string, unknown> } | Record<string, unknown> | null) {
  if (!doc) return doc;
  return typeof (doc as { toObject?: () => Record<string, unknown> }).toObject === "function"
    ? (doc as { toObject: () => Record<string, unknown> }).toObject()
    : (doc as Record<string, unknown>);
}

function publicUser(doc: unknown) {
  const row = asObject(doc as { toObject?: () => Record<string, unknown> }) as Record<string, unknown> | null;
  if (!row) return row;
  delete row.passwordHash;
  delete row.passwordResetToken;
  delete row.passwordResetExpires;
  return row;
}

async function loadRole(organizationId: string, id: string) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound("Role not found");
  const role = await Role.findOne({ _id: id, organizationId, deletedAt: null });
  if (!role) throw ApiError.notFound("Role not found");
  return role;
}

async function loadUser(organizationId: string, id: string) {
  if (!mongoose.isValidObjectId(id)) throw ApiError.notFound("User not found");
  const user = await User.findOne({ _id: id, organizationId, deletedAt: null }).select(USER_SECRET).populate("roleId");
  if (!user) throw ApiError.notFound("User not found");
  return user;
}

async function uniqueRoleSlug(organizationId: string, base: string, excludeId?: string) {
  let slug = base;
  let n = 2;
  for (;;) {
    const clash = await Role.findOne({
      organizationId,
      slug,
      ...(excludeId ? { _id: { $ne: excludeId } } : {})
    }).select("_id");
    if (!clash) return slug;
    slug = `${base}_${n++}`;
  }
}

async function memberCount(organizationId: string, roleId: unknown) {
  return User.countDocuments({ organizationId, roleId, deletedAt: null });
}

type RoleView = Record<string, unknown> & {
  _id: unknown;
  memberCount: number;
  permissionCount: number;
};

type StaffView = Record<string, unknown> & { _id: unknown };

async function decorateRole(organizationId: string, role: { toObject?: () => Record<string, unknown> } | Record<string, unknown>): Promise<RoleView> {
  const row = asObject(role) as Record<string, unknown>;
  const permissions = Array.isArray(row.permissions) ? (row.permissions as string[]) : [];
  return {
    ...row,
    _id: row._id,
    memberCount: await memberCount(organizationId, row._id),
    permissionCount: permissions.length,
    modules: modulesForPermissions(permissions, typeof row.slug === "string" ? row.slug : undefined)
  };
}

async function activeOwnerCount(organizationId: string, excludeUserId?: string) {
  const ownerRole = await Role.findOne({ organizationId, slug: "owner", deletedAt: null }).select("_id");
  if (!ownerRole) return 0;
  return User.countDocuments({
    organizationId,
    roleId: ownerRole._id,
    deletedAt: null,
    active: true,
    ...(excludeUserId ? { _id: { $ne: excludeUserId } } : {})
  });
}

async function assertNotLastOwner(organizationId: string, target: { _id: unknown; roleId?: { slug?: string } | unknown }, next: { roleId?: string; active?: boolean; deleting?: boolean }) {
  const populated = target.roleId && typeof target.roleId === "object" && "slug" in (target.roleId as object)
    ? (target.roleId as { slug: string; _id: unknown })
    : await Role.findById(target.roleId as string).select("slug");
  if (populated?.slug !== "owner") return;
  const leavingOwner = Boolean(next.deleting) || next.active === false || (next.roleId && String(next.roleId) !== String(populated._id));
  if (!leavingOwner) return;
  const remaining = await activeOwnerCount(organizationId, String(target._id));
  if (remaining < 1) throw ApiError.conflict("The organisation must keep at least one active owner");
}

function cleanOverrides(input?: OverridesInput | null): { grant: Permission[]; revoke: Permission[] } {
  const grant = sanitizePermissions(input?.grant);
  const revoke = new Set(sanitizePermissions(input?.revoke));
  return {
    grant: grant.filter((p) => !revoke.has(p)),
    revoke: [...revoke]
  };
}

function assertCanGrant(actor: AuthUser, requested: readonly string[]) {
  const missing = permissionsNotHeld(actor, requested);
  if (missing.length) {
    throw ApiError.forbidden(`You cannot assign permissions you do not hold: ${missing.join(", ")}`);
  }
}

async function revokeSessionsForUsers(userIds: unknown[]) {
  if (!userIds.length) return;
  await Session.updateMany({ userId: { $in: userIds }, revokedAt: null }, { revokedAt: new Date() });
}

async function revokeSessionsForRole(roleId: unknown) {
  const members = await User.find({ roleId, deletedAt: null }).select("_id");
  await revokeSessionsForUsers(members.map((m) => m._id));
}

async function assertAssignableRole(actor: AuthUser, role: { slug: string }) {
  if (role.slug === "owner" && !isOwnerActor(actor)) {
    throw ApiError.forbidden("Only an owner can assign the Owner role");
  }
  if (role.slug === "customer") {
    throw ApiError.badRequest("The Customer role is reserved for the customer portal");
  }
}

async function assertCanMutateUser(actor: AuthUser, target: { _id: unknown; roleId?: { slug?: string } | unknown }) {
  const slug =
    target.roleId && typeof target.roleId === "object" && "slug" in (target.roleId as object)
      ? (target.roleId as { slug: string }).slug
      : (await Role.findById(target.roleId as string).select("slug"))?.slug;
  if (slug === "owner" && !isOwnerActor(actor)) {
    throw ApiError.forbidden("Only an owner can change an owner account");
  }
}

export function permissionCatalog() {
  return {
    permissions: [...PERMISSIONS],
    labels: PERMISSION_LABELS,
    groups: PERMISSION_GROUPS,
    modules: ACCESS_MODULES
  };
}

export async function listRoles(actor: AuthUser) {
  const roles = await Role.find({ organizationId: actor.organizationId, deletedAt: null }).sort("name");
  const counts = await User.aggregate([
    { $match: { organizationId: oid(actor.organizationId), deletedAt: null } },
    { $group: { _id: "$roleId", n: { $sum: 1 } } }
  ]);
  const map = new Map(counts.map((c: { _id: unknown; n: number }) => [String(c._id), c.n]));
  return roles.map((role) => {
    const row = role.toObject();
    return {
      ...row,
      memberCount: map.get(String(role._id)) ?? 0,
      permissionCount: (row.permissions as string[] | undefined)?.length ?? 0,
      modules: modulesForPermissions((row.permissions as string[] | undefined) ?? [], role.slug)
    };
  });
}

export async function getRole(actor: AuthUser, id: string) {
  return decorateRole(actor.organizationId, await loadRole(actor.organizationId, id));
}

export async function createRole(actor: AuthUser, input: RoleInput) {
  const name = input.name.trim();
  if (!name) throw ApiError.badRequest("Role name is required");
  const requested = slugifyRole(input.slug?.trim() || name);
  if (RESERVED_SLUGS.has(requested)) {
    throw ApiError.conflict(`Slug "${requested}" is reserved for a system role`);
  }
  const permissions = sanitizePermissions(input.permissions);
  assertCanGrant(actor, permissions);
  const slug = await uniqueRoleSlug(actor.organizationId, requested);
  const role = await Role.create({
    organizationId: actor.organizationId,
    branchId: actor.branchId,
    name,
    slug,
    description: input.description?.trim() || "",
    permissions,
    system: false,
    active: input.active !== false
  });
  return decorateRole(actor.organizationId, role);
}

export async function updateRole(actor: AuthUser, id: string, input: RolePatch) {
  const role = await loadRole(actor.organizationId, id);
  const next: Record<string, unknown> = {};

  if (input.name !== undefined) {
    const name = input.name.trim();
    if (!name) throw ApiError.badRequest("Role name is required");
    next.name = name;
  }
  if (input.description !== undefined) next.description = input.description.trim();
  if (input.active !== undefined) next.active = input.active;

  if (role.slug === "owner") {
    if (!isOwnerActor(actor)) throw ApiError.forbidden("Only an owner can edit the Owner role");
    if (input.active === false) throw ApiError.conflict("The Owner role cannot be deactivated");
    next.permissions = [...PERMISSIONS];
    next.system = true;
    next.slug = "owner";
  } else {
    if (input.permissions !== undefined) {
      const permissions = sanitizePermissions(input.permissions);
      assertCanGrant(actor, permissions);
      next.permissions = permissions;
    }
    if (role.system) {
      next.system = true;
      next.slug = role.slug;
    } else if (input.slug !== undefined) {
      const requested = slugifyRole(input.slug.trim() || String(next.name ?? role.name));
      if (RESERVED_SLUGS.has(requested) && requested !== role.slug) {
        throw ApiError.conflict(`Slug "${requested}" is reserved for a system role`);
      }
      next.slug = await uniqueRoleSlug(actor.organizationId, requested, String(role._id));
    }
  }

  const updated = await Role.findOneAndUpdate(
    { _id: role._id, organizationId: actor.organizationId, deletedAt: null },
    next,
    { new: true }
  );
  if (!updated) throw ApiError.notFound("Role not found");
  if (input.permissions !== undefined) await revokeSessionsForRole(updated._id);
  return decorateRole(actor.organizationId, updated);
}

export async function resetRole(actor: AuthUser, id: string) {
  const role = await loadRole(actor.organizationId, id);
  const def = DEFAULT_ROLES[role.slug];
  if (!def) throw ApiError.badRequest("Only seeded default roles can be reset");
  if (role.slug === "owner" && !isOwnerActor(actor)) {
    throw ApiError.forbidden("Only an owner can reset the Owner role");
  }
  const permissions = role.slug === "owner" ? [...PERMISSIONS] : sanitizePermissions(def.permissions);
  assertCanGrant(actor, permissions);
  const updated = await Role.findOneAndUpdate(
    { _id: role._id, organizationId: actor.organizationId, deletedAt: null },
    {
      name: def.name,
      description: def.description,
      permissions,
      system: def.system,
      active: true
    },
    { new: true }
  );
  if (!updated) throw ApiError.notFound("Role not found");
  await revokeSessionsForRole(updated._id);
  return decorateRole(actor.organizationId, updated);
}

export async function duplicateRole(actor: AuthUser, id: string, name?: string) {
  const source = await loadRole(actor.organizationId, id);
  const copyName = (name?.trim() || `Copy of ${source.name}`).slice(0, 80);
  return createRole(actor, {
    name: copyName,
    description: source.description || "",
    permissions: source.slug === "owner" ? [...PERMISSIONS].filter((p) => p !== "settings.owner") : source.permissions
  });
}

export async function deleteRole(actor: AuthUser, id: string) {
  const role = await loadRole(actor.organizationId, id);
  if (role.system) throw ApiError.forbidden("System roles cannot be deleted");
  const members = await memberCount(actor.organizationId, role._id);
  if (members > 0) throw ApiError.conflict(`Reassign ${members} staff member${members === 1 ? "" : "s"} before deleting this role`);
  await Role.updateOne({ _id: role._id }, { deletedAt: new Date(), active: false, slug: `${role.slug}__deleted_${String(role._id).slice(-6)}` });
  return { deleted: true, id: String(role._id) };
}

function serializeStaff(user: { toObject?: () => Record<string, unknown>; roleId?: unknown; permissionOverrides?: OverridesInput }): StaffView {
  const row = publicUser(user) as Record<string, unknown>;
  const role = user.roleId && typeof user.roleId === "object" ? (user.roleId as { slug?: string; permissions?: string[] }) : null;
  const effective = role
    ? resolvePermissions({ slug: role.slug ?? "", permissions: role.permissions }, user.permissionOverrides)
    : [];
  row.effectivePermissions = effective;
  row.modules = modulesForPermissions(effective, role?.slug);
  return { ...row, _id: row._id };
}

export async function listUsers(actor: AuthUser, req: Request) {
  const { page, limit, skip, search, sort } = parsePagination(req);
  const filter: Record<string, unknown> = { organizationId: actor.organizationId, deletedAt: null };
  if (search) {
    filter.$or = [
      { name: new RegExp(escapeRegex(search), "i") },
      { email: new RegExp(escapeRegex(search), "i") },
      { department: new RegExp(escapeRegex(search), "i") }
    ];
  }
  const roleId = String(req.query.roleId ?? "").trim();
  if (roleId && mongoose.isValidObjectId(roleId)) filter.roleId = roleId;
  const status = String(req.query.status ?? "").trim();
  if (status === "active") filter.active = { $ne: false };
  if (status === "inactive") filter.active = false;

  const [rows, total] = await Promise.all([
    User.find(filter).select(USER_SECRET).populate("roleId").skip(skip).limit(limit).sort(safeSort(sort, ["createdAt", "name", "email", "lastLoginAt"])),
    User.countDocuments(filter)
  ]);
  return {
    rows: rows.map((u) => serializeStaff(u)),
    meta: { page, limit, total }
  };
}

export async function getUser(actor: AuthUser, id: string) {
  return serializeStaff(await loadUser(actor.organizationId, id));
}

export async function createUser(actor: AuthUser, input: UserInput) {
  const email = input.email.trim().toLowerCase();
  const exists = await User.findOne({ organizationId: actor.organizationId, email }).select("_id");
  if (exists) throw ApiError.conflict("Email already in use");
  const role = await loadRole(actor.organizationId, input.roleId);
  await assertAssignableRole(actor, role);
  assertCanGrant(actor, role.permissions);
  const overrides = cleanOverrides(input.permissionOverrides);
  assertCanGrant(actor, overrides.grant);
  const createdUser = await User.create({
    organizationId: actor.organizationId,
    branchId: input.branchId || actor.branchId,
    name: input.name.trim(),
    email,
    phone: input.phone?.trim() || undefined,
    department: input.department?.trim() || undefined,
    roleId: role._id,
    passwordHash: await bcrypt.hash(input.password, env.bcryptRounds),
    permissionOverrides: overrides,
    active: true
  });
  const populated = await User.findById(createdUser._id).select(USER_SECRET).populate("roleId");
  return serializeStaff(populated!);
}

export async function updateUser(actor: AuthUser, id: string, input: UserPatch) {
  const target = await loadUser(actor.organizationId, id);
  await assertCanMutateUser(actor, target);

  if (input.active === false && String(target._id) === actor.id) {
    throw ApiError.badRequest("You cannot deactivate your own account");
  }

  const next: Record<string, unknown> = {};
  if (input.name !== undefined) {
    const name = input.name.trim();
    if (name.length < 2) throw ApiError.badRequest("Name is required");
    next.name = name;
  }
  if (input.email !== undefined) {
    const email = input.email.trim().toLowerCase();
    const clash = await User.findOne({ organizationId: actor.organizationId, email, _id: { $ne: target._id } }).select("_id");
    if (clash) throw ApiError.conflict("Email already in use");
    next.email = email;
  }
  if (input.phone !== undefined) next.phone = input.phone.trim();
  if (input.department !== undefined) next.department = input.department.trim();
  if (input.branchId !== undefined) next.branchId = input.branchId;
  if (input.password) next.passwordHash = await bcrypt.hash(input.password, env.bcryptRounds);
  if (input.permissionOverrides) {
    const overrides = cleanOverrides(input.permissionOverrides);
    assertCanGrant(actor, overrides.grant);
    next.permissionOverrides = overrides;
  }

  let nextRoleId: string | undefined;
  if (input.roleId) {
    const role = await loadRole(actor.organizationId, input.roleId);
    await assertAssignableRole(actor, role);
    assertCanGrant(actor, role.permissions);
    next.roleId = role._id;
    nextRoleId = String(role._id);
  }
  if (input.active !== undefined) next.active = input.active;

  await assertNotLastOwner(actor.organizationId, target, { roleId: nextRoleId, active: input.active });

  const updated = await User.findOneAndUpdate(
    { _id: target._id, organizationId: actor.organizationId, deletedAt: null },
    next,
    { new: true }
  )
    .select(USER_SECRET)
    .populate("roleId");
  if (!updated) throw ApiError.notFound("User not found");

  if (input.password || input.active === false || nextRoleId || input.permissionOverrides) {
    await revokeSessionsForUsers([updated._id]);
  }
  return serializeStaff(updated);
}

export async function deleteUser(actor: AuthUser, id: string) {
  const target = await loadUser(actor.organizationId, id);
  if (String(target._id) === actor.id) throw ApiError.badRequest("You cannot delete your own account");
  await assertCanMutateUser(actor, target);
  await assertNotLastOwner(actor.organizationId, target, { deleting: true });
  await User.updateOne({ _id: target._id }, { deletedAt: new Date(), active: false });
  await Session.updateMany({ userId: target._id, revokedAt: null }, { revokedAt: new Date() });
  return { deleted: true, id: String(target._id) };
}

export async function revokeSessions(actor: AuthUser, id: string) {
  const target = await loadUser(actor.organizationId, id);
  await assertCanMutateUser(actor, target);
  const result = await Session.updateMany({ userId: target._id, revokedAt: null }, { revokedAt: new Date() });
  return { revoked: true, count: result.modifiedCount };
}
