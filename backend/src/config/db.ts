import mongoose from "mongoose";
import { env } from "./env";
import { logger } from "./logger";

function mongoTarget(uri: string) {
  try {
    const parsed = new URL(uri);
    return `${parsed.hostname}:${parsed.port || "27017"}${parsed.pathname}`;
  } catch {
    return "unparseable";
  }
}

export async function connectDb() {
  mongoose.set("strictQuery", true);
  const target = mongoTarget(env.mongoUri);
  if (env.isProd && /localhost|127\.0\.0\.1/i.test(env.mongoUri)) {
    logger.error(
      { target },
      "mongodb_uri_points_at_localhost; set MONGODB_URI to the Dokploy Mongo service hostname"
    );
  }
  let lastErr: unknown;
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      await mongoose.connect(env.mongoUri, { serverSelectionTimeoutMS: 8000 });
      logger.info({ target, attempt }, "mongo_connected");
      return;
    } catch (err) {
      lastErr = err;
      logger.error(
        { target, attempt, err: err instanceof Error ? err.message : err },
        "mongo_connect_retry"
      );
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  }
  throw lastErr;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
