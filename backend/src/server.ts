import { createApp } from "./app";
import { connectDb } from "./config/db";
import { env } from "./config/env";
import { logger } from "./config/logger";

async function main() {
  await connectDb();
  const app = createApp();
  app.listen(env.port, () => {
    logger.info({ port: env.port }, "api_listening");
  });
}

main().catch((err) => {
  logger.fatal({ err }, "api_boot_failed");
  process.exit(1);
});
