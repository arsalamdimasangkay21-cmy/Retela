import "./env.js";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import path from "path";
import { fileURLToPath } from "url";

import authRoutes from "./routes/auth.routes.js";
import usersRoutes from "./routes/users.routes.js";
import productsRoutes from "./routes/products.routes.js";
import ordersRoutes from "./routes/orders.routes.js";
import messagesRoutes from "./routes/messages.routes.js";
import notificationsRoutes from "./routes/notifications.routes.js";
import broadcastsRoutes from "./routes/broadcasts.routes.js";
import reviewsRoutes from "./routes/reviews.routes.js";
import returnsRoutes from "./routes/returns.routes.js";
import reportsRoutes from "./routes/reports.routes.js";
import paymentsRoutes from "./routes/payments.routes.js";
import settingsRoutes from "./routes/settings.routes.js";
import cartRoutes from "./routes/cart.routes.js";
import adminRoutes from "./routes/admin.routes.js";
import chatRoutes from "./routes/chat.routes.js";
import posRoutes from "./routes/pos.routes.js";
import customerRoutes from "./routes/customer.routes.js";
import { checkDatabaseConnection, requestContextMiddleware } from "./config/db.js";
import { corsOrigin } from "./config/cors.js";

import {
  brandsRoutes,
  categoriesRoutes,
  conditionsRoutes,
  sizesRoutes,
  typesRoutes,
} from "./routes/apparel-options.routes.js";

import { errorHandler } from "./utils/errors.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function createApp(io) {
  const app = express();

  // Trust Railway / reverse proxy
  app.set("trust proxy", 1);

  app.set("io", io);
  app.use(requestContextMiddleware);
  app.use((req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - startedAt) / 1_000_000;
      const level = res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : "log";
      console[level](`[request] ${req.method} ${req.originalUrl} ${res.statusCode} ${durationMs.toFixed(1)}ms`);
    });
    next();
  });

  app.use(
    helmet({
      crossOriginResourcePolicy: {
        policy: "cross-origin",
      },
    })
  );

  app.use(
    cors({
      origin: corsOrigin,
      credentials: true,
    })
  );

  app.use(
    "/api/payments/webhook",
    express.raw({ type: "application/json" })
  );

  app.use(express.json());

  app.use(
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: Number(process.env.RATE_LIMIT_MAX || 5000),
      standardHeaders: true,
      legacyHeaders: false,
    })
  );

  app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

  app.get("/api/health", async (req, res) => {
    const database = await checkDatabaseConnection().catch((error) => ({
      connected: false,
      databaseName: process.env.DB_NAME || "retela_db",
      checkedAt: new Date().toISOString(),
      error: error.code || "database_unavailable"
    }));
    res.status(database.connected ? 200 : 503).json({
      success: database.connected,
      status: "ok",
      database: database.connected ? "connected" : "unavailable",
      checkedAt: database.checkedAt
    });
  });

  app.use("/api", (req, res, next) => {
    const json = res.json.bind(res);
    res.json = (body) => {
      if (body && typeof body === "object" && Object.prototype.hasOwnProperty.call(body, "success")) {
        return json(body);
      }
      if (res.statusCode >= 400) {
        return json({
          success: false,
          message: body?.message || body?.error || "Request failed",
          error: body?.error || body?.code || "request_failed",
          ...(body?.errors ? { errors: body.errors } : {}),
        });
      }
      return json({
        success: true,
        data: body,
      });
    };
    next();
  });

  app.use("/api/auth", authRoutes);
  app.use("/api/brands", brandsRoutes);
  app.use("/api/categories", categoriesRoutes);
  app.use("/api/types", typesRoutes);
  app.use("/api/sizes", sizesRoutes);
  app.use("/api/conditions", conditionsRoutes);
  app.use("/api/users", usersRoutes);
  app.use("/api/customer", customerRoutes);
  app.use("/api/apparel", productsRoutes);
  app.use("/api/products", productsRoutes);
  app.use("/api/orders", ordersRoutes);
  app.use("/api/messages", messagesRoutes);
  app.use("/api/notifications", notificationsRoutes);
  app.use("/api/broadcasts", broadcastsRoutes);
  app.use("/api/reviews", reviewsRoutes);
  app.use("/api/returns", returnsRoutes);
  app.use("/api/analytics", reportsRoutes);
  app.use("/api/reports", reportsRoutes);
  app.use("/api/payments", paymentsRoutes);
  app.use("/api/settings", settingsRoutes);
  app.use("/api/cart", cartRoutes);
  app.use("/api/admin", adminRoutes);
  app.use("/api/chat", chatRoutes);
  app.use("/api/pos", posRoutes);

  app.use("/api", (req, res) =>
    res.status(404).json({
      success: false,
      message: "API route not found",
    })
  );

  app.use(errorHandler);

  return app;
}
