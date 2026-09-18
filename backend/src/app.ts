import express from "express";
import cors from "cors";
import helmet from "helmet";
import compression from "compression";
import pinoHttp from "pino-http";
import mongoose from "mongoose";
import fs from "fs";
import path from "path";
import rateLimit from "express-rate-limit";
import { env } from "./config/env";
import { logger } from "./config/logger";
import { errorHandler, notFound } from "./middleware/errorHandler";
import authRoutes from "./modules/auth/auth.routes";
import usersRoutes from "./modules/users/users.routes";
import customersRoutes from "./modules/customers/customers.routes";
import catalogRoutes from "./modules/catalog/catalog.routes";
import quotationsRoutes from "./modules/quotations/quotations.routes";
import ordersRoutes from "./modules/orders/orders.routes";
import productionRoutes from "./modules/production/production.routes";
import inventoryRoutes from "./modules/inventory/inventory.routes";
import financeRoutes from "./modules/finance/finance.routes";
import notificationsRoutes from "./modules/notifications/notifications.routes";
import reportsRoutes from "./modules/reports/reports.routes";
import settingsRoutes from "./modules/settings/settings.routes";
import publicRoutes from "./modules/public/public.routes";

function webRoot() {
  const dir = path.resolve(process.env.WEB_DIR || path.join(process.cwd(), "web"));
  return fs.existsSync(path.join(dir, "index.html")) ? dir : null;
}

function isApiPath(pathname: string) {
  return (
    pathname.startsWith(env.apiPrefix) ||
    pathname.startsWith("/api") ||
    pathname.startsWith("/public") ||
    pathname.startsWith("/uploads") ||
    pathname === "/health" ||
    pathname.startsWith("/health/")
  );
}

export function createApp() {
  const app = express();
  const webDir = webRoot();
  app.set("trust proxy", 1);
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: "cross-origin" },
      contentSecurityPolicy: webDir ? false : undefined
    })
  );
  app.use(compression());
  app.use(cors({ origin: env.corsOrigin.split(","), credentials: true }));
  app.use(express.json({ limit: "10mb" }));
  app.use(express.urlencoded({ extended: true }));
  app.use(
    pinoHttp({
      logger,
      autoLogging: !env.isTest
    })
  );
  app.use("/uploads", express.static(path.resolve(env.uploadDir)));

  if (!webDir) {
    app.get("/", (_req, res) => {
      res.json({
        success: true,
        message: "Infy PrintOS API",
        data: {
          service: "infy-printos-api",
          health: "/health",
          api: env.apiPrefix,
          app: env.appUrl
        }
      });
    });
  }

  app.get("/health", (_req, res) => {
    const mongoUp = mongoose.connection.readyState === 1;
    res.status(mongoUp || env.nodeEnv === "test" ? 200 : 503).json({
      ok: mongoUp || env.nodeEnv === "test",
      service: "infy-printos-api",
      time: new Date().toISOString(),
      mongo: mongoUp ? "up" : "down"
    });
  });

  const apiLimiter = rateLimit({
    windowMs: 60_000,
    limit: env.isTest ? 10_000 : 300,
    standardHeaders: true,
    legacyHeaders: false,
    skip: () => env.isTest
  });
  app.use(env.apiPrefix, apiLimiter);
  app.use(`${env.apiPrefix}/auth`, authRoutes);
  app.use(`${env.apiPrefix}/users`, usersRoutes);
  app.use(`${env.apiPrefix}/customers`, customersRoutes);
  app.use(`${env.apiPrefix}/catalog`, catalogRoutes);
  app.use(`${env.apiPrefix}/quotations`, quotationsRoutes);
  app.use(`${env.apiPrefix}/orders`, ordersRoutes);
  app.use(`${env.apiPrefix}/production`, productionRoutes);
  app.use(`${env.apiPrefix}/inventory`, inventoryRoutes);
  app.use(`${env.apiPrefix}/finance`, financeRoutes);
  app.use(`${env.apiPrefix}/notifications`, notificationsRoutes);
  app.use(`${env.apiPrefix}/reports`, reportsRoutes);
  app.use(`${env.apiPrefix}/settings`, settingsRoutes);
  app.use("/public", publicRoutes);

  if (webDir) {
    app.use(express.static(webDir, { index: false, maxAge: env.isProd ? "7d" : 0 }));
    app.get("*", (req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      if (isApiPath(req.path)) return next();
      res.sendFile(path.join(webDir, "index.html"), (err) => {
        if (err) next(err);
      });
    });
  }

  app.use(notFound);
  app.use(errorHandler);
  return app;
}
