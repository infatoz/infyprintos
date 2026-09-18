import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { Organization, Branch } from "../models/Organization";
import { Role, User } from "../models/User";
import { DEFAULT_ROLES } from "../common/permissions";
import { createApp } from "../app";

let mongod: MongoMemoryServer | undefined;

export type TestActors = {
  orgId: string;
  branchId: string;
  owner: { email: string; password: string; id: string };
  admin: { email: string; password: string; id: string };
  orderManager: { email: string; password: string; id: string };
  viewer: { email: string; password: string; id: string };
  inactive: { email: string; password: string; id: string };
};

export async function startTestApp() {
  mongod = await MongoMemoryServer.create();
  await mongoose.connect(mongod.getUri());
  const actors = await seedFoundationActors();
  return { app: createApp(), actors };
}

export async function stopTestApp() {
  await mongoose.disconnect();
  await mongod?.stop();
  mongod = undefined;
}

async function seedFoundationActors(): Promise<TestActors> {
  const password = "TestPass123!";
  const passwordHash = await bcrypt.hash(password, 10);
  const org = await Organization.create({ name: "Test Press" });
  const branch = await Branch.create({
    organizationId: org._id,
    name: "HQ",
    code: "HQ",
    isDefault: true
  });

  const roles: Record<string, mongoose.Types.ObjectId> = {};
  for (const [slug, def] of Object.entries(DEFAULT_ROLES)) {
    const role = await Role.create({
      organizationId: org._id,
      branchId: branch._id,
      slug,
      name: def.name,
      description: def.description,
      permissions: def.permissions,
      system: def.system
    });
    roles[slug] = role._id;
  }

  async function makeUser(email: string, roleSlug: keyof typeof roles, active = true) {
    const user = await User.create({
      organizationId: org._id,
      branchId: branch._id,
      name: email.split("@")[0],
      email,
      passwordHash,
      roleId: roles[roleSlug],
      active
    });
    return { email, password, id: String(user._id) };
  }

  return {
    orgId: String(org._id),
    branchId: String(branch._id),
    owner: await makeUser("owner@test.local", "owner"),
    admin: await makeUser("admin@test.local", "administrator"),
    orderManager: await makeUser("orders@test.local", "order_manager"),
    viewer: await makeUser("viewer@test.local", "viewer"),
    inactive: await makeUser("inactive@test.local", "viewer", false)
  };
}
