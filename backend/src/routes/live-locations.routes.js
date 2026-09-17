import { Router } from "express";
import { z } from "zod";
import { query } from "../config/db.js";
import { requireAuth, requireApproved, requireRole } from "../middleware/auth.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { validCoordinates } from "../utils/shippingCalculator.js";

const router = Router();
let liveLocationTableReady;

const activeTrackingStatuses = new Set(["approved", "processing", "ready", "paid"]);
const terminalStatuses = new Set(["completed", "cancelled", "payment_failed", "rejected"]);

export async function ensureLiveLocationTable() {
  liveLocationTableReady ||= query(`
    CREATE TABLE IF NOT EXISTS order_live_locations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      user_id INT NOT NULL,
      source_type ENUM('rider','customer') NOT NULL DEFAULT 'rider',
      latitude DECIMAL(10,7) NOT NULL,
      longitude DECIMAL(10,7) NOT NULL,
      heading DECIMAL(6,2) NULL,
      speed DECIMAL(8,3) NULL,
      accuracy DECIMAL(8,2) NULL,
      is_live BOOLEAN NOT NULL DEFAULT TRUE,
      shared_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      stopped_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_order_live_source (order_id, user_id, source_type),
      INDEX idx_order_live_order (order_id, source_type, is_live, shared_at),
      INDEX idx_order_live_user (user_id, is_live)
    )
  `).catch((error) => {
    liveLocationTableReady = undefined;
    throw error;
  });
  return liveLocationTableReady;
}

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase().replace(/[\s-]+/g, "_");
}

function normalizeSourceType(req, value) {
  const sourceType = String(value || "").trim().toLowerCase();
  if (sourceType === "customer") return "customer";
  if (sourceType === "rider") return "rider";
  return req.user.role === "customer" ? "customer" : "rider";
}

function serializeLiveLocation(row) {
  if (!row) return null;
  return {
    order_id: Number(row.order_id),
    user_id: Number(row.user_id),
    source_type: row.source_type,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    heading: row.heading === null || row.heading === undefined ? null : Number(row.heading),
    speed: row.speed === null || row.speed === undefined ? null : Number(row.speed),
    accuracy: row.accuracy === null || row.accuracy === undefined ? null : Number(row.accuracy),
    is_live: Boolean(Number(row.is_live)),
    shared_at: row.shared_at,
    stopped_at: row.stopped_at || null,
    status: row.is_live ? "live" : "stopped"
  };
}

async function loadOrderForLiveLocation(orderId, user) {
  const rows = await query(
    `SELECT id, user_id, status, fulfillment_method, delivery_address, delivery_latitude, delivery_longitude
     FROM orders
     WHERE id = :orderId
     LIMIT 1`,
    { orderId }
  );
  const order = rows[0];
  if (!order) throw new HttpError(404, "Order not found");
  if (user.role === "customer" && Number(order.user_id) !== Number(user.id)) {
    throw new HttpError(404, "Order not found");
  }
  return order;
}

function assertTrackableOrder(order) {
  const status = normalizeStatus(order.status);
  if (terminalStatuses.has(status)) throw new HttpError(409, "Live route tracking is stopped for this order status.");
  if (!activeTrackingStatuses.has(status)) throw new HttpError(409, "Live route tracking is available after the order is accepted or out for delivery.");
  if (String(order.fulfillment_method || "delivery").toLowerCase() !== "delivery") {
    throw new HttpError(409, "Live route tracking is only available for delivery orders.");
  }
  if (!validCoordinates(order.delivery_latitude, order.delivery_longitude)) {
    throw new HttpError(409, "Customer delivery coordinates are unavailable for this order.");
  }
}

router.get("/orders/:id", requireAuth, requireApproved, asyncHandler(async (req, res) => {
  await ensureLiveLocationTable();
  const orderId = Number(req.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) throw new HttpError(400, "A valid order ID is required.");
  const order = await loadOrderForLiveLocation(orderId, req.user);
  if (req.user.role !== "customer" && !["admin", "staff"].includes(req.user.role)) throw new HttpError(403, "Not authorized.");
  const rows = await query(
    `SELECT *
     FROM order_live_locations
     WHERE order_id = :orderId
       AND is_live = TRUE
     ORDER BY
       CASE source_type WHEN 'rider' THEN 0 ELSE 1 END,
       shared_at DESC
     LIMIT 5`,
    { orderId }
  );
  res.json({
    order: {
      id: Number(order.id),
      status: order.status,
      delivery_latitude: order.delivery_latitude === null ? null : Number(order.delivery_latitude),
      delivery_longitude: order.delivery_longitude === null ? null : Number(order.delivery_longitude),
      delivery_address: order.delivery_address || ""
    },
    locations: rows.map(serializeLiveLocation)
  });
}));

router.post("/orders/:id", requireAuth, requireApproved, asyncHandler(async (req, res) => {
  await ensureLiveLocationTable();
  const orderId = Number(req.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) throw new HttpError(400, "A valid order ID is required.");
  const input = z.object({
    source_type: z.enum(["rider", "customer"]).optional(),
    latitude: z.coerce.number().min(-90).max(90),
    longitude: z.coerce.number().min(-180).max(180),
    heading: z.coerce.number().min(0).max(360).nullable().optional(),
    speed: z.coerce.number().min(0).max(120).nullable().optional(),
    accuracy: z.coerce.number().min(0).max(10000).nullable().optional()
  }).parse(req.body);
  if (!validCoordinates(input.latitude, input.longitude)) throw new HttpError(400, "A valid live location is required.");
  const sourceType = normalizeSourceType(req, input.source_type);
  if (sourceType === "rider" && !["admin", "staff"].includes(req.user.role)) throw new HttpError(403, "Only staff can publish rider live location.");
  if (sourceType === "customer" && req.user.role !== "customer") throw new HttpError(403, "Only the customer can publish customer live location.");
  const order = await loadOrderForLiveLocation(orderId, req.user);
  assertTrackableOrder(order);

  await query(
    `UPDATE order_live_locations
     SET is_live = FALSE, stopped_at = NOW()
     WHERE order_id = :orderId
       AND source_type = :sourceType
       AND user_id <> :userId
       AND is_live = TRUE`,
    { orderId, userId: req.user.id, sourceType }
  );
  await query(
    `INSERT INTO order_live_locations
       (order_id, user_id, source_type, latitude, longitude, heading, speed, accuracy, is_live, shared_at, stopped_at)
     VALUES
       (:orderId, :userId, :sourceType, :latitude, :longitude, :heading, :speed, :accuracy, TRUE, NOW(), NULL)
     ON DUPLICATE KEY UPDATE
       latitude = VALUES(latitude),
       longitude = VALUES(longitude),
       heading = VALUES(heading),
       speed = VALUES(speed),
       accuracy = VALUES(accuracy),
       is_live = TRUE,
       shared_at = NOW(),
       stopped_at = NULL`,
    {
      orderId,
      userId: req.user.id,
      sourceType,
      latitude: input.latitude,
      longitude: input.longitude,
      heading: input.heading ?? null,
      speed: input.speed ?? null,
      accuracy: input.accuracy ?? null
    }
  );
  const payload = serializeLiveLocation({
    order_id: orderId,
    user_id: req.user.id,
    source_type: sourceType,
    latitude: input.latitude,
    longitude: input.longitude,
    heading: input.heading ?? null,
    speed: input.speed ?? null,
    accuracy: input.accuracy ?? null,
    is_live: 1,
    shared_at: new Date().toISOString(),
    stopped_at: null
  });
  req.app.get("io")?.to(`order-live:${orderId}`).emit("live-location:update", payload);
  req.app.get("io")?.to("admin").emit("live-location:update", payload);
  res.status(201).json(payload);
}));

router.delete("/orders/:id", requireAuth, requireApproved, asyncHandler(async (req, res) => {
  await ensureLiveLocationTable();
  const orderId = Number(req.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) throw new HttpError(400, "A valid order ID is required.");
  const sourceType = normalizeSourceType(req, req.query.source_type);
  await loadOrderForLiveLocation(orderId, req.user);
  if (sourceType === "rider" && !["admin", "staff"].includes(req.user.role)) throw new HttpError(403, "Only staff can stop rider live location.");
  if (sourceType === "customer" && req.user.role !== "customer") throw new HttpError(403, "Only the customer can stop customer live location.");
  await query(
    `UPDATE order_live_locations
     SET is_live = FALSE, stopped_at = NOW()
     WHERE order_id = :orderId
       AND user_id = :userId
       AND source_type = :sourceType`,
    { orderId, userId: req.user.id, sourceType }
  );
  const payload = { order_id: orderId, user_id: Number(req.user.id), source_type: sourceType, is_live: false, status: "stopped", stopped_at: new Date().toISOString() };
  req.app.get("io")?.to(`order-live:${orderId}`).emit("live-location:stopped", payload);
  req.app.get("io")?.to("admin").emit("live-location:stopped", payload);
  res.json(payload);
}));

router.delete("/orders/:id/all", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req, res) => {
  await ensureLiveLocationTable();
  const orderId = Number(req.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) throw new HttpError(400, "A valid order ID is required.");
  await query("UPDATE order_live_locations SET is_live = FALSE, stopped_at = NOW() WHERE order_id = :orderId", { orderId });
  const payload = { order_id: orderId, is_live: false, status: "stopped", stopped_at: new Date().toISOString() };
  req.app.get("io")?.to(`order-live:${orderId}`).emit("live-location:stopped", payload);
  req.app.get("io")?.to("admin").emit("live-location:stopped", payload);
  res.json(payload);
}));

export default router;
