import pino from "pino";
import { env } from "./env";

export const logger = pino({
  level: env.logLevel,
  base: { service: "infy-printos-api", env: env.nodeEnv },
  timestamp: pino.stdTimeFunctions.isoTime
});
