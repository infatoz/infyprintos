import { createApp } from "./app";
import { connectDb } from "./config/db";
import { env } from "./config/env";
import { logger } from "./config/logger";

async function main() {
  const app = createApp();
  await new Promise<void>((resolve, reject) => {
    const server = app.listen(env.port, "0.0.0.0", () => {
      logger.info({ host: "0.0.0.0", port: env.port }, "api_listening");
      resolve();
    });
    server.on("error", reject);
  });
  connectDb().catch((err) => {
    logger.fatal({ err }, "mongo_connect_failed");
  });
}

main().catch((err) => {
  logger.fatal({ err }, "api_boot_failed");
  process.exit(1);
});
