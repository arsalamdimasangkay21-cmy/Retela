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

  const configuredOrigins = (
    process.env.CLIENT_URL ||
    "http://localhost:5173,http://127.0.0.1:5173,http://127.0.0.1:5174,http://127.0.0.1:5175,http://127.0.0.1:5177,https://retela-ix3c.vercel.app"
  )
    .split(",")
    .map((origin) => origin.trim());

  app.set("io", io);

  app.use(
    helmet({
      crossOriginResourcePolicy: {
        policy: "cross-origin",
      },
    })
  );

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || configuredOrigins.includes(origin)) {
          return callback(null, true);
        }
        return callback(new Error("Not allowed by CORS"));
      },
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

  app.get("/api/health", (req, res) =>
    res.json({
      status: "ok",
      service: "retela-api",
    })
  );

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
      message: "API route not found",
    })
  );

  app.use(errorHandler);

  return app;
}