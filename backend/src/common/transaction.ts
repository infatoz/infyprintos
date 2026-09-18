import mongoose from "mongoose";
import { logger } from "../config/logger";

export async function withOptionalTransaction<T>(fn: (session?: mongoose.ClientSession) => Promise<T>): Promise<T> {
  let session: mongoose.ClientSession | undefined;
  try {
    session = await mongoose.startSession();
    let result: T | undefined;
    await session.withTransaction(async () => {
      result = await fn(session);
    });
    return result as T;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/replica set|Transaction numbers|not supported/i.test(message)) {
      logger.debug({ err }, "mongo_transactions_unavailable_falling_back");
      return fn(undefined);
    }
    throw err;
  } finally {
    if (session) await session.endSession();
  }
}
