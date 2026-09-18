import { createRequire } from "node:module";
import pino from "pino";
import { env } from "./env";

const requireId = createRequire(__filename);

function prettyOptions() {
  if (env.isProd || env.isTest) return {};
  try {
    requireId.resolve("pino-pretty");
  } catch {
    return {};
  }
  return {
    transport: {
      target: "pino-pretty",
      options: { colorize: true, translateTime: "SYS:standard", ignore: "pid,hostname" }
    }
  };
}

export const logger = pino({
  level: env.logLevel,
  base: { service: "infy-printos-api", env: env.nodeEnv },
  timestamp: pino.stdTimeFunctions.isoTime,
  ...prettyOptions()
});
