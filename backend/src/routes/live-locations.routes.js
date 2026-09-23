import { Router } from "express";
import { z } from "zod";
import { query } from "../config/db.js";
import { requireAuth, requireApproved, requireRole } from "../middleware/auth.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { haversineDistanceKm, validCoordinates } from "../utils/shippingCalculator.js";

const router = Router();
let liveLocationTableReady;

const activeTrackingStatuses = new Set(["ready"]);
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
  const isLive = Boolean(Number(row.is_live));
  return {
    order_id: Number(row.order_id),
    orderId: Number(row.order_id),
    user_id: Number(row.user_id),
    rider_id: Number(row.user_id),
    source_type: row.source_type,
    sourceType: row.source_type,
    latitude: Number(row.latitude),
    longitude: Number(row.longitude),
    heading: row.heading === null || row.heading === undefined ? null : Number(row.heading),
    speed: row.speed === null || row.speed === undefined ? null : Number(row.speed),
    accuracy: row.accuracy === null || row.accuracy === undefined ? null : Number(row.accuracy),
    is_live: isLive,
    trackingActive: isLive,
    updatedAt: row.shared_at,
    shared_at: row.shared_at,
    timestamp: row.shared_at,
    stopped_at: row.stopped_at || null,
    status: isLive ? "live" : "stopped"
  };
}

function parseClientTimestamp(value) {
  if (value === undefined || value === null || value === "") return new Date();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, "A valid GPS timestamp is required.");
  const now = Date.now();
  if (date.getTime() > now + 5 * 60 * 1000) throw new HttpError(400, "GPS timestamp cannot be in the future.");
  return date;
}

function emitLiveLocation(req, orderId, payload) {
  const io = req.app.get("io");
  if (!io) return;
  io.to(`order-live:${orderId}`).emit("live-location:update", payload);
  io.to(`order-live:${orderId}`).emit("delivery:rider-location", payload);
  io.to(`order:${orderId}`).emit("delivery:rider-location", payload);
  io.to("admin").emit("live-location:update", payload);
  io.to("admin").emit("delivery:rider-location", payload);
  if (process.env.NODE_ENV !== "production") {
    console.info("[SOCKET] rider location emitted", {
      orderId,
      latitude: payload.latitude,
      longitude: payload.longitude,
      accuracy: payload.accuracy
    });
  }
}

function emitLiveLocationStopped(req, orderId, payload) {
  const io = req.app.get("io");
  if (!io) return;
  io.to(`order-live:${orderId}`).emit("live-location:stopped", payload);
  io.to(`order-live:${orderId}`).emit("delivery:rider-location-stopped", payload);
  io.to(`order:${orderId}`).emit("delivery:rider-location-stopped", payload);
  io.to("admin").emit("live-location:stopped", payload);
  io.to("admin").emit("delivery:rider-location-stopped", payload);
}

async function notifyCustomerOnce(req, { userId, orderId, title, body }) {
  if (!userId || !orderId || !title || !body) return null;
  const existing = await query(
    `SELECT id
     FROM notifications
     WHERE user_id = :userId
       AND type = 'order'
       AND title = :title
       AND body = :body
     LIMIT 1`,
    { userId, title, body }
  );
  if (existing.length) return null;
  const result = await query(
    "INSERT INTO notifications (user_id, type, title, body) VALUES (:userId, 'order', :title, :body)",
    { userId, title, body }
  );
  const payload = {
    id: result.insertId,
    user_id: Number(userId),
    type: "order",
    title,
    body,
    message: body,
    order_id: Number(orderId),
    is_read: false,
    created_at: new Date().toISOString()
  };
  req.app.get("io")?.to(`user:${userId}`).emit("notification:new", payload);
  return payload;
}

async function loadOrderForLiveLocation(orderId, user) {
  const rows = await query(
    `SELECT id, user_id, rider_id, status, delivery_status, fulfillment_method, delivery_address, delivery_latitude, delivery_longitude
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
  const deliveryStatus = normalizeStatus(order.delivery_status);
  if (terminalStatuses.has(status)) throw new HttpError(409, "Live route tracking is stopped for this order status.");
  if (!activeTrackingStatuses.has(status) && deliveryStatus !== "out_for_delivery") {
    throw new HttpError(409, "Live route tracking starts when the order is Out for Delivery.");
  }
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
    accuracy: z.coerce.number().min(0).max(10000).nullable().optional(),
    timestamp: z.string().trim().optional()
  }).parse(req.body);
  if (!validCoordinates(input.latitude, input.longitude)) throw new HttpError(400, "A valid live location is required.");
  const sourceType = normalizeSourceType(req, input.source_type);
  if (sourceType === "rider" && !["admin", "staff"].includes(req.user.role)) throw new HttpError(403, "Only staff can publish rider live location.");
  if (sourceType === "customer" && req.user.role !== "customer") throw new HttpError(403, "Only the customer can publish customer live location.");
  const order = await loadOrderForLiveLocation(orderId, req.user);
  assertTrackableOrder(order);
  const sharedAt = parseClientTimestamp(input.timestamp);

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
       (:orderId, :userId, :sourceType, :latitude, :longitude, :heading, :speed, :accuracy, TRUE, :sharedAt, NULL)
     ON DUPLICATE KEY UPDATE
       latitude = VALUES(latitude),
       longitude = VALUES(longitude),
       heading = VALUES(heading),
       speed = VALUES(speed),
       accuracy = VALUES(accuracy),
       is_live = TRUE,
       shared_at = VALUES(shared_at),
       stopped_at = NULL`,
    {
      orderId,
      userId: req.user.id,
      sourceType,
      latitude: input.latitude,
      longitude: input.longitude,
      heading: input.heading ?? null,
      speed: input.speed ?? null,
      accuracy: input.accuracy ?? null,
      sharedAt
    }
  );
  if (sourceType === "rider") {
    const riderName = String(req.user.display_name || req.user.username || "Rider").trim().slice(0, 160);
    await query(
      `UPDATE orders
       SET delivery_status = 'Out for Delivery',
           rider_id = :riderId,
           rider_name = :riderName,
           rider_latitude = :latitude,
           rider_longitude = :longitude,
           customer_latitude = COALESCE(customer_latitude, delivery_latitude),
           customer_longitude = COALESCE(customer_longitude, delivery_longitude),
           location_updated_at = :sharedAt
       WHERE id = :orderId`,
      {
        orderId,
        riderId: req.user.id,
        riderName,
        latitude: input.latitude,
        longitude: input.longitude,
        sharedAt
      }
    );
  }
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
    shared_at: sharedAt.toISOString(),
    stopped_at: null
  });
  if (process.env.NODE_ENV !== "production") {
    console.info("[DELIVERY] rider location saved", {
      orderId,
      userId: req.user.id,
      latitude: payload.latitude,
      longitude: payload.longitude,
      accuracy: payload.accuracy,
      trackingActive: payload.trackingActive
    });
  }
  emitLiveLocation(req, orderId, payload);
  if (sourceType === "rider") {
    await notifyCustomerOnce(req, {
      userId: order.user_id,
      orderId,
      title: "Rider location available",
      body: `Your rider location is now available for order #${orderId}.`
    });
    const distanceKm = haversineDistanceKm(
      { latitude: input.latitude, longitude: input.longitude },
      { latitude: order.delivery_latitude, longitude: order.delivery_longitude }
    );
    if (distanceKm !== null && distanceKm <= 0.5) {
      await notifyCustomerOnce(req, {
        userId: order.user_id,
        orderId,
        title: "Rider approaching",
        body: `Your rider is approaching the delivery area for order #${orderId}.`
      });
    }
  }
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
  const payload = { order_id: orderId, orderId, user_id: Number(req.user.id), rider_id: Number(req.user.id), source_type: sourceType, sourceType, is_live: false, trackingActive: false, status: "stopped", stopped_at: new Date().toISOString(), updatedAt: new Date().toISOString(), timestamp: new Date().toISOString() };
  emitLiveLocationStopped(req, orderId, payload);
  res.json(payload);
}));

router.delete("/orders/:id/all", requireAuth, requireRole("admin", "staff"), asyncHandler(async (req, res) => {
  await ensureLiveLocationTable();
  const orderId = Number(req.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) throw new HttpError(400, "A valid order ID is required.");
  await query("UPDATE order_live_locations SET is_live = FALSE, stopped_at = NOW() WHERE order_id = :orderId", { orderId });
  const payload = { order_id: orderId, orderId, is_live: false, trackingActive: false, status: "stopped", stopped_at: new Date().toISOString(), updatedAt: new Date().toISOString(), timestamp: new Date().toISOString() };
  emitLiveLocationStopped(req, orderId, payload);
  res.json(payload);
}));

export default router;
