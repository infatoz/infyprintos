import dotenv from "dotenv";
import path from "path";
import { z } from "zod";

dotenv.config({ path: path.resolve(process.cwd(), "../.env") });
dotenv.config();

const envSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    APP_URL: z.string().default("http://localhost:5173"),
    API_PREFIX: z.string().default("/api/v1"),
    PORT: z.coerce.number().default(8080),
    MONGODB_URI: z.string().min(1),
    JWT_ACCESS_SECRET: z.string().min(16),
    JWT_REFRESH_SECRET: z.string().min(16),
    JWT_ACCESS_EXPIRES: z.string().default("15m"),
    JWT_REFRESH_EXPIRES: z.string().default("7d"),
    BCRYPT_ROUNDS: z.coerce.number().min(10).max(15).default(12),
    PUBLIC_LINK_EXPIRES_DAYS: z.coerce.number().min(1).max(90).default(14),
    UPLOAD_DIR: z.string().default("./uploads"),
    MAX_FILE_SIZE_MB: z.coerce.number().min(1).max(100).default(25),
    CORS_ORIGIN: z.string().default("http://localhost:5173"),
    LOG_LEVEL: z.string().optional(),
    SEED_OWNER_EMAIL: z.string().email().default("owner@infatoz.com"),
    SEED_OWNER_PASSWORD: z.string().min(8).default("Owner@12345"),
    SEED_OWNER_NAME: z.string().default("Infatoz Owner")
  })
  .superRefine((value, ctx) => {
    if (value.NODE_ENV !== "production") return;
    const weak = (secret: string, name: string) => {
      if (secret.length < 32 || /change-me|dev-/i.test(secret)) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${name} must be a unique 32+ character secret in production`, path: [name] });
      }
    };
    weak(value.JWT_ACCESS_SECRET, "JWT_ACCESS_SECRET");
    weak(value.JWT_REFRESH_SECRET, "JWT_REFRESH_SECRET");
  });

const parsed = envSchema.safeParse({
  NODE_ENV: process.env.NODE_ENV,
  APP_URL: process.env.APP_URL,
  API_PREFIX: process.env.API_PREFIX,
  PORT: process.env.PORT,
    MONGODB_URI:
      process.env.MONGODB_URI ??
      process.env.MONGO_URL ??
      process.env.DATABASE_URL ??
      "mongodb://localhost:27018/printing_erp",
  JWT_ACCESS_SECRET: process.env.JWT_ACCESS_SECRET ?? "dev-access-secret-change-me-please-32",
  JWT_REFRESH_SECRET: process.env.JWT_REFRESH_SECRET ?? "dev-refresh-secret-change-me-please-32",
  JWT_ACCESS_EXPIRES: process.env.JWT_ACCESS_EXPIRES,
  JWT_REFRESH_EXPIRES: process.env.JWT_REFRESH_EXPIRES,
  BCRYPT_ROUNDS: process.env.BCRYPT_ROUNDS,
  PUBLIC_LINK_EXPIRES_DAYS: process.env.PUBLIC_LINK_EXPIRES_DAYS,
  UPLOAD_DIR: process.env.UPLOAD_DIR,
  MAX_FILE_SIZE_MB: process.env.MAX_FILE_SIZE_MB,
  CORS_ORIGIN: process.env.CORS_ORIGIN,
  LOG_LEVEL: process.env.LOG_LEVEL,
  SEED_OWNER_EMAIL: process.env.SEED_OWNER_EMAIL,
  SEED_OWNER_PASSWORD: process.env.SEED_OWNER_PASSWORD,
  SEED_OWNER_NAME: process.env.SEED_OWNER_NAME
});

if (!parsed.success) {
  const details = parsed.error.flatten();
  console.error("Invalid environment configuration", JSON.stringify(details));
  throw new Error(`Invalid environment configuration: ${JSON.stringify(details.fieldErrors)}`);
}

const raw = parsed.data;

function withDatabaseName(uri: string) {
  try {
    const parsedUri = new URL(uri);
    if (!parsedUri.pathname || parsedUri.pathname === "/") parsedUri.pathname = "/printing_erp";
    return parsedUri.toString();
  } catch {
    return uri;
  }
}

export const env = {
  nodeEnv: raw.NODE_ENV,
  isProd: raw.NODE_ENV === "production",
  isTest: raw.NODE_ENV === "test",
  port: raw.PORT,
  appUrl: raw.APP_URL,
  apiPrefix: raw.API_PREFIX,
  mongoUri: withDatabaseName(raw.MONGODB_URI),
  jwtAccessSecret: raw.JWT_ACCESS_SECRET,
  jwtRefreshSecret: raw.JWT_REFRESH_SECRET,
  jwtAccessExpires: raw.JWT_ACCESS_EXPIRES,
  jwtRefreshExpires: raw.JWT_REFRESH_EXPIRES,
  bcryptRounds: raw.BCRYPT_ROUNDS,
  publicLinkExpiresDays: raw.PUBLIC_LINK_EXPIRES_DAYS,
  uploadDir: raw.UPLOAD_DIR,
  maxFileSizeMb: raw.MAX_FILE_SIZE_MB,
  corsOrigin: raw.CORS_ORIGIN,
  logLevel: raw.LOG_LEVEL ?? (raw.NODE_ENV === "production" ? "info" : "debug"),
  seedOwnerEmail: raw.SEED_OWNER_EMAIL,
  seedOwnerPassword: raw.SEED_OWNER_PASSWORD,
  seedOwnerName: raw.SEED_OWNER_NAME
};
