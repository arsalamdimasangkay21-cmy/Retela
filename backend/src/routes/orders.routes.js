import { Router } from "express";
import { z } from "zod";
import { pool, query, safeModifyColumn } from "../config/db.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { requireApproved, requireAuth, requireRole } from "../middleware/auth.js";
import { ensureProductInventoryColumns } from "../utils/productInventory.js";
import { productImageExpression } from "../utils/productImages.js";
import { calculateCheckoutPricing } from "../utils/promotions.js";
import { calculateShippingQuote, getShippingPolicy } from "../utils/shippingSettings.js";
import { createAdminNotification } from "../utils/adminNotifications.js";
import { ensureCartTable } from "./cart.routes.js";
import { loadSystemSettings } from "../utils/systemSettings.js";
import { loadCustomerDeliveryLocation } from "../utils/customerLocation.js";
import { haversineDistanceKm, normalizeMunicipality, validCoordinates } from "../utils/shippingCalculator.js";

const router = Router();
const statuses = ["pending", "awaiting_payment", "paid", "approved", "processing", "ready", "completed", "cancelled", "payment_failed"];
const customerCancellableStatuses = new Set(["pending", "awaiting_payment"]);
const allowedAdminStatusTransitions = {
  pending: new Set(["approved", "cancelled"]),
  awaiting_payment: new Set(["cancelled", "payment_failed", "paid"]),
  // `paid` is a legacy fulfillment value from older online orders. Treat it
  // as payment-confirmed pending so those orders can enter the normal flow.
  paid: new Set(["approved", "processing", "cancelled"]),
  approved: new Set(["processing", "ready", "cancelled"]),
  processing: new Set(["ready", "cancelled"]),
  ready: new Set(["completed", "cancelled"]),
  payment_failed: new Set(["cancelled"]),
  cancelled: new Set([]),
  completed: new Set([])
};
const transientOrderLockCodes = new Set(["ER_LOCK_WAIT_TIMEOUT", "ER_LOCK_DEADLOCK"]);
const maxOrderCreateAttempts = 3;
const codMunicipalityError = "Cash on Delivery is only available for nearby delivery areas. Please select an online payment method.";
let orderColumnsReady;

function normalizeAddressMunicipality(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[.,/\\-]+/g, " ")
    .replace(/\s+/g, " ");
}

function addressMatchesMunicipality(address, municipality) {
  const target = normalizeAddressMunicipality(municipality);
  const source = normalizeAddressMunicipality(address);
  if (!target || !source) return false;
  const segments = source.split(/\s*,\s*/).map((segment) => segment.trim()).filter(Boolean);
  if (segments.includes(target)) return true;
  const escaped = target.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&");
  return new RegExp(`(?:^|\\s)${escaped}(?:$|\\s)`, "i").test(source);
}

async function decorateMeetupEligibility(orders) {
  if (!orders.length) return orders;
  const [{ config }, shippingPolicy] = await Promise.all([loadSystemSettings(), getShippingPolicy()]);
  const shopMunicipality = config.general.shopMunicipality || shippingPolicy.shopMunicipality;
  const shopCoordinates = {
    latitude: shippingPolicy.shopLatitude ?? config.general.shopLatitude,
    longitude: shippingPolicy.shopLongitude ?? config.general.shopLongitude
  };
  const configuredMeetupRange = Number(shippingPolicy.freeDeliveryRadiusKm ?? config.payment.freeDeliveryRadiusKm ?? 15);
  const meetupRangeKm = Number.isFinite(configuredMeetupRange) ? Math.max(0, configuredMeetupRange) : 15;
  const acceptedStatuses = new Set(["approved", "processing", "ready", "completed"]);
  return orders.map((order) => {
    const status = normalizeOrderStatus(order.status);
    const configuredShopMunicipality = normalizeMunicipality(shopMunicipality);
    const addressMunicipality = normalizeMunicipality(order.delivery_municipality);
    const sameMunicipality = addressMunicipality
      ? addressMunicipality === configuredShopMunicipality
      : addressMatchesMunicipality(order.delivery_address || order.location, shopMunicipality);
    const hasCoordinates = validCoordinates(order.delivery_latitude, order.delivery_longitude)
      && validCoordinates(shopCoordinates.latitude, shopCoordinates.longitude);
    const distance = hasCoordinates ? haversineDistanceKm(shopCoordinates, {
      latitude: order.delivery_latitude,
      longitude: order.delivery_longitude
    }) : null;
    const distanceKm = distance === null ? null : Math.round(distance * 100) / 100;
    const localInRange = Boolean(
      order.fulfillment_method === "delivery"
        && sameMunicipality
        && distanceKm !== null
        && distanceKm <= meetupRangeKm
    );
    return {
      ...order,
      meetup_area_eligible: localInRange,
      meetup_eligible: localInRange && acceptedStatuses.has(status) && status === "approved",
      meetup_distance_km: distanceKm,
      meetup_range_km: meetupRangeKm,
      shop_municipality: shopMunicipality || null
    };
  });
}

function normalizeOrderStatus(status) {
  return String(status || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function isCustomerCancellableStatus(status) {
  return customerCancellableStatuses.has(normalizeOrderStatus(status));
}

function nullableCoordinate(min, max) {
  return z.preprocess(
    (value) => (value === "" || value === null ? null : value),
    z.coerce.number().min(min).max(max).nullable()
  ).optional();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function compactOrderItems(items = []) {
  const map = new Map();
  for (const item of items) {
    const productId = Number(item.product_id);
    const quantity = Number(item.quantity || 0);
    map.set(productId, (map.get(productId) || 0) + quantity);
  }
  return [...map.entries()]
    .map(([product_id, quantity]) => ({ product_id, quantity }))
    .sort((left, right) => left.product_id - right.product_id);
}

function isTransientOrderLockError(error) {
  return transientOrderLockCodes.has(error?.code) || [1205, 1213].includes(Number(error?.errno));
}

async function rollbackQuietly(connection, context) {
  try {
    await connection.rollback();
  } catch (rollbackError) {
    console.error("[order-transaction] rollback failed", {
      context,
      message: rollbackError?.message,
      code: rollbackError?.code
    });
  }
}

async function ensureOrderColumns() {
  orderColumnsReady ||= (async () => {
    const rows = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'orders'
         AND COLUMN_NAME IN ('tracking_number', 'fulfillment_method', 'delivery_address', 'delivery_latitude', 'delivery_longitude', 'delivery_municipality', 'delivery_province', 'delivery_region', 'delivery_postal_code', 'delivery_place_id', 'delivery_landmark', 'delivery_notes', 'meeting_place', 'meeting_latitude', 'meeting_longitude', 'meetup_date', 'meetup_time', 'meetup_confirmation_status', 'meetup_confirmed_at', 'meetup_customer_note', 'meetup_24h_reminder_sent_at', 'meetup_1h_reminder_sent_at', 'subtotal_amount', 'coupon_discount', 'sale_discount', 'shipping_fee', 'shipping_zone', 'shipping_distance_km', 'shipping_rule', 'coupon_code', 'payment_status', 'payment_reference', 'transaction_id', 'paid_at', 'payment_provider', 'checkout_session_id', 'checkout_url', 'order_channel', 'cash_received', 'change_amount', 'pos_cashier_id')`
    );
    const columns = new Set(rows.map((row) => row.COLUMN_NAME));
    await safeModifyColumn("orders", "status", "status enum update", "ALTER TABLE orders MODIFY status ENUM('pending','awaiting_payment','paid','approved','processing','ready','completed','cancelled','payment_failed') NOT NULL DEFAULT 'pending'");
    await safeModifyColumn("orders", "user_id", "user_id nullable update", "ALTER TABLE orders MODIFY user_id INT NULL");
    await safeModifyColumn("orders", "payment_method", "payment_method enum update", "ALTER TABLE orders MODIFY payment_method ENUM('cod','cash','gcash','qrph','debit','credit','maya') NOT NULL DEFAULT 'cod'");
    if (!columns.has("order_channel")) await query("ALTER TABLE orders ADD COLUMN order_channel ENUM('online','pos') NOT NULL DEFAULT 'online' AFTER user_id");
    if (!columns.has("tracking_number")) {
      await query("ALTER TABLE orders ADD COLUMN tracking_number VARCHAR(120) NULL AFTER payment_method");
    }
    if (!columns.has("fulfillment_method")) {
      await query("ALTER TABLE orders ADD COLUMN fulfillment_method ENUM('delivery','pickup') NOT NULL DEFAULT 'delivery' AFTER tracking_number");
    }
    if (!columns.has("delivery_address")) await query("ALTER TABLE orders ADD COLUMN delivery_address VARCHAR(500) NULL AFTER fulfillment_method");
    if (!columns.has("delivery_latitude")) await query("ALTER TABLE orders ADD COLUMN delivery_latitude DECIMAL(10,7) NULL AFTER delivery_address");
    if (!columns.has("delivery_longitude")) await query("ALTER TABLE orders ADD COLUMN delivery_longitude DECIMAL(10,7) NULL AFTER delivery_latitude");
    if (!columns.has("delivery_municipality")) await query("ALTER TABLE orders ADD COLUMN delivery_municipality VARCHAR(160) NULL AFTER delivery_longitude");
    if (!columns.has("delivery_province")) await query("ALTER TABLE orders ADD COLUMN delivery_province VARCHAR(160) NULL AFTER delivery_municipality");
    if (!columns.has("delivery_region")) await query("ALTER TABLE orders ADD COLUMN delivery_region VARCHAR(160) NULL AFTER delivery_province");
    if (!columns.has("delivery_postal_code")) await query("ALTER TABLE orders ADD COLUMN delivery_postal_code VARCHAR(20) NULL AFTER delivery_region");
    if (!columns.has("delivery_place_id")) await query("ALTER TABLE orders ADD COLUMN delivery_place_id VARCHAR(255) NULL AFTER delivery_postal_code");
    if (!columns.has("delivery_landmark")) await query("ALTER TABLE orders ADD COLUMN delivery_landmark VARCHAR(255) NULL AFTER delivery_longitude");
    if (!columns.has("delivery_notes")) await query("ALTER TABLE orders ADD COLUMN delivery_notes TEXT NULL AFTER delivery_landmark");
    if (!columns.has("meeting_place")) await query("ALTER TABLE orders ADD COLUMN meeting_place VARCHAR(500) NULL AFTER delivery_notes");
    if (!columns.has("meeting_latitude")) await query("ALTER TABLE orders ADD COLUMN meeting_latitude DECIMAL(10,7) NULL AFTER meeting_place");
    if (!columns.has("meeting_longitude")) await query("ALTER TABLE orders ADD COLUMN meeting_longitude DECIMAL(10,7) NULL AFTER meeting_latitude");
    if (!columns.has("meetup_date")) await query("ALTER TABLE orders ADD COLUMN meetup_date DATE NULL AFTER meeting_place");
    if (!columns.has("meetup_time")) await query("ALTER TABLE orders ADD COLUMN meetup_time TIME NULL AFTER meetup_date");
    if (!columns.has("meetup_confirmation_status")) await query("ALTER TABLE orders ADD COLUMN meetup_confirmation_status ENUM('pending','agreed','disagreed') NOT NULL DEFAULT 'pending' AFTER meetup_time");
    if (!columns.has("meetup_confirmed_at")) await query("ALTER TABLE orders ADD COLUMN meetup_confirmed_at DATETIME NULL AFTER meetup_confirmation_status");
    if (!columns.has("meetup_customer_note")) await query("ALTER TABLE orders ADD COLUMN meetup_customer_note VARCHAR(500) NULL AFTER meetup_confirmed_at");
    if (!columns.has("meetup_24h_reminder_sent_at")) await query("ALTER TABLE orders ADD COLUMN meetup_24h_reminder_sent_at DATETIME NULL AFTER meetup_customer_note");
    if (!columns.has("meetup_1h_reminder_sent_at")) await query("ALTER TABLE orders ADD COLUMN meetup_1h_reminder_sent_at DATETIME NULL AFTER meetup_24h_reminder_sent_at");
    if (!columns.has("subtotal_amount")) await query("ALTER TABLE orders ADD COLUMN subtotal_amount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER fulfillment_method");
    if (!columns.has("coupon_discount")) await query("ALTER TABLE orders ADD COLUMN coupon_discount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER subtotal_amount");
    if (!columns.has("sale_discount")) await query("ALTER TABLE orders ADD COLUMN sale_discount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER coupon_discount");
    if (!columns.has("shipping_fee")) await query("ALTER TABLE orders ADD COLUMN shipping_fee DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER sale_discount");
    if (!columns.has("shipping_zone")) await query("ALTER TABLE orders ADD COLUMN shipping_zone VARCHAR(20) NULL AFTER shipping_fee");
    if (!columns.has("shipping_distance_km")) await query("ALTER TABLE orders ADD COLUMN shipping_distance_km DECIMAL(10,2) NULL AFTER shipping_zone");
    if (!columns.has("shipping_rule")) await query("ALTER TABLE orders ADD COLUMN shipping_rule VARCHAR(40) NULL AFTER shipping_distance_km");
    if (!columns.has("coupon_code")) await query("ALTER TABLE orders ADD COLUMN coupon_code VARCHAR(40) NULL AFTER shipping_fee");
    if (!columns.has("payment_status")) await query("ALTER TABLE orders ADD COLUMN payment_status ENUM('unpaid','awaiting_payment','paid','failed','cancelled','refunded') NOT NULL DEFAULT 'unpaid' AFTER payment_method");
    if (!columns.has("payment_reference")) await query("ALTER TABLE orders ADD COLUMN payment_reference VARCHAR(160) NULL AFTER payment_status");
    if (!columns.has("transaction_id")) await query("ALTER TABLE orders ADD COLUMN transaction_id VARCHAR(160) NULL AFTER payment_reference");
    if (!columns.has("paid_at")) await query("ALTER TABLE orders ADD COLUMN paid_at DATETIME NULL AFTER transaction_id");
    if (!columns.has("payment_provider")) await query("ALTER TABLE orders ADD COLUMN payment_provider VARCHAR(40) NULL AFTER paid_at");
    if (!columns.has("checkout_session_id")) await query("ALTER TABLE orders ADD COLUMN checkout_session_id VARCHAR(160) NULL AFTER payment_provider");
    if (!columns.has("checkout_url")) await query("ALTER TABLE orders ADD COLUMN checkout_url TEXT NULL AFTER checkout_session_id");
    if (!columns.has("cash_received")) await query("ALTER TABLE orders ADD COLUMN cash_received DECIMAL(10,2) NULL AFTER total_amount");
    if (!columns.has("change_amount")) await query("ALTER TABLE orders ADD COLUMN change_amount DECIMAL(10,2) NULL AFTER cash_received");
    if (!columns.has("pos_cashier_id")) await query("ALTER TABLE orders ADD COLUMN pos_cashier_id INT NULL AFTER change_amount");
  })().catch((error) => {
    orderColumnsReady = undefined;
    throw error;
  });
  return orderColumnsReady;
}

router.get("/", requireAuth, requireApproved, asyncHandler(async (req, res) => {
  await ensureOrderColumns();
  const where = req.user.role === "admin" ? "" : "WHERE o.user_id = :userId";
  const orders = await query(
`SELECT
    o.id,
    o.user_id,
    o.order_channel,
    o.status,
    o.payment_method,
    o.payment_status,
    o.payment_reference,
    o.transaction_id,
    o.paid_at,
    o.cash_received,
    o.change_amount,
    o.tracking_number,
    o.fulfillment_method,
    o.delivery_address,
    o.delivery_latitude,
    o.delivery_longitude,
    o.delivery_municipality,
    o.delivery_province,
    o.delivery_region,
    o.delivery_postal_code,
    o.delivery_place_id,
    o.delivery_landmark,
    o.delivery_notes,
    o.meeting_place,
    o.meeting_latitude,
    o.meeting_longitude,
    o.meetup_date,
    o.meetup_time,
    o.meetup_confirmation_status,
    o.meetup_confirmed_at,
    o.meetup_customer_note,
    o.meetup_24h_reminder_sent_at,
    o.meetup_1h_reminder_sent_at,
    o.subtotal_amount,
    o.coupon_discount,
    o.sale_discount,
    o.shipping_fee,
    o.shipping_zone,
    o.shipping_distance_km,
    o.shipping_rule,
    o.coupon_code,
    o.total_amount,
    o.checkout_url,
    o.created_at,

    MAX(u.username) AS username,
    MAX(u.display_name) AS display_name,
    MAX(COALESCE(u.display_name, u.username)) AS customer_name,
    MAX(u.email) AS email,
    MAX(u.email) AS customer_email,
    MAX(u.location) AS location,
    MAX(u.phone_number) AS phone_number,
    MAX(u.phone_number) AS customer_phone,

    COUNT(oi.id) AS item_count,

    GROUP_CONCAT(DISTINCT p.brand ORDER BY p.brand SEPARATOR ', ') AS brands,

    GROUP_CONCAT(DISTINCT p.name ORDER BY p.name SEPARATOR ', ') AS product_names,

    SUBSTRING_INDEX(
        GROUP_CONCAT(p.name ORDER BY oi.id SEPARATOR '||'),
        '||',
        1
    ) AS first_product_name,

    SUBSTRING_INDEX(
        GROUP_CONCAT(${productImageExpression("p")} ORDER BY oi.id SEPARATOR '||'),
        '||',
        1
    ) AS first_product_image

FROM orders o
LEFT JOIN users u ON u.id = o.user_id
LEFT JOIN order_items oi ON oi.order_id = o.id
LEFT JOIN products p ON p.id = oi.product_id

${where}

GROUP BY
    o.id,
    o.user_id,
    o.order_channel,
    o.status,
    o.payment_method,
    o.payment_status,
    o.payment_reference,
    o.transaction_id,
    o.paid_at,
    o.cash_received,
    o.change_amount,
    o.tracking_number,
    o.fulfillment_method,
    o.delivery_address,
    o.delivery_latitude,
    o.delivery_longitude,
    o.delivery_municipality,
    o.delivery_province,
    o.delivery_region,
    o.delivery_postal_code,
    o.delivery_place_id,
    o.delivery_landmark,
    o.delivery_notes,
    o.meeting_place,
    o.meeting_latitude,
    o.meeting_longitude,
    o.meetup_date,
    o.meetup_time,
    o.meetup_confirmation_status,
    o.meetup_confirmed_at,
    o.meetup_customer_note,
    o.meetup_24h_reminder_sent_at,
    o.meetup_1h_reminder_sent_at,
    o.subtotal_amount,
    o.coupon_discount,
    o.sale_discount,
    o.shipping_fee,
    o.shipping_zone,
    o.shipping_distance_km,
    o.shipping_rule,
    o.coupon_code,
    o.total_amount,
    o.checkout_url,
    o.created_at

ORDER BY o.created_at DESC`,
{
    userId: req.user.id,
});
  res.json(await decorateMeetupEligibility(orders));
}));

router.get("/:id/items", requireAuth, requireApproved, asyncHandler(async (req, res) => {
  await ensureOrderColumns();
  const ownershipFilter = req.user.role === "admin" ? "" : "AND o.user_id = :userId";
  const orders = await query(
    `SELECT o.id, o.user_id, o.order_channel, o.status, o.payment_method, o.payment_status, o.payment_reference,
       o.transaction_id, o.paid_at, o.cash_received, o.change_amount,
       o.tracking_number, o.fulfillment_method, o.delivery_address, o.delivery_latitude,
       o.delivery_longitude, o.delivery_municipality, o.delivery_province, o.delivery_region,
       o.delivery_postal_code, o.delivery_place_id, o.delivery_landmark, o.delivery_notes,
       o.meeting_place, o.meeting_latitude, o.meeting_longitude, o.meetup_date, o.meetup_time,
       o.meetup_confirmation_status, o.meetup_confirmed_at, o.meetup_customer_note,
       o.meetup_24h_reminder_sent_at, o.meetup_1h_reminder_sent_at, o.subtotal_amount, o.coupon_discount,
       o.sale_discount, o.shipping_fee, o.shipping_zone, o.shipping_distance_km, o.shipping_rule,
       o.coupon_code, o.total_amount, o.checkout_url, o.created_at,
       u.username, u.display_name, COALESCE(u.display_name, u.username) AS customer_name, u.email, u.email AS customer_email, u.location, u.phone_number, u.phone_number AS customer_phone
     FROM orders o
     LEFT JOIN users u ON u.id = o.user_id
     WHERE o.id = :id
       ${ownershipFilter}
     LIMIT 1`,
    { id: req.params.id, userId: req.user.id }
  );
  if (!orders.length) throw new HttpError(404, "Order not found");

  const items = await query(
    `SELECT oi.product_id, oi.quantity, oi.price, p.name, p.brand, p.category, p.size, ${productImageExpression("p")} AS image_url, p.\`condition\`
     FROM order_items oi
     JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = :id
     ORDER BY oi.id ASC`,
    { id: req.params.id }
  );

  const [order] = await decorateMeetupEligibility(orders);
  res.json({ order, items });
}));

router.patch("/:id/cancel", requireAuth, requireApproved, asyncHandler(async (req, res) => {
  await ensureOrderColumns();
  await ensureProductInventoryColumns();
  const { config } = await loadSystemSettings();
  const lowStockThreshold = Number(config?.inventory?.lowStockThreshold ?? 3);
  const orderId = Number(req.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) throw new HttpError(400, "A valid order ID is required");

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [orders] = await conn.execute(
      `SELECT id, user_id, status, payment_status, payment_method, total_amount, checkout_url
       FROM orders
       WHERE id = ?
       FOR UPDATE`,
      [orderId]
    );
    if (!orders.length || Number(orders[0].user_id) !== Number(req.user.id)) {
      throw new HttpError(404, "Order not found");
    }
    const order = orders[0];
    if (!isCustomerCancellableStatus(order.status)) {
      throw new HttpError(409, "This order can no longer be cancelled.");
    }

    const [items] = await conn.execute(
      "SELECT product_id, quantity FROM order_items WHERE order_id = ?",
      [orderId]
    );
    const inventoryUpdates = [];
    for (const item of items) {
      await conn.execute(
        `UPDATE products
         SET stock = stock + ?,
             status = CASE
               WHEN stock + ? <= 0 THEN 'Out of Stock'
               WHEN stock + ? <= ${lowStockThreshold} THEN 'Low Stock'
               ELSE 'In Stock'
             END
         WHERE id = ?`,
        [item.quantity, item.quantity, item.quantity, item.product_id]
      );
      const [updatedProducts] = await conn.execute("SELECT id, name, stock FROM products WHERE id = ?", [item.product_id]);
      const nextStock = Number(updatedProducts[0]?.stock || 0);
      inventoryUpdates.push({
        id: Number(item.product_id),
        name: updatedProducts[0]?.name,
        stock: nextStock,
        status: nextStock <= 0 ? "Out of Stock" : nextStock <= lowStockThreshold ? "Low Stock" : "In Stock"
      });
    }

    await conn.execute(
      `UPDATE orders
       SET status = 'cancelled',
           payment_status = 'cancelled',
           checkout_url = NULL,
           checkout_session_id = NULL
       WHERE id = ?`,
      [orderId]
    );
    await conn.execute(
      "INSERT INTO notifications (user_id, type, title, body) VALUES (?, 'order', 'Order cancelled', ?)",
      [req.user.id, `Order #${orderId} was cancelled successfully.`]
    );
    const adminCancelNotification = await createAdminNotification({
      type: "order_cancelled",
      title: "Order cancelled",
      body: `Order #${orderId} was cancelled by the customer.`,
      customerId: req.user.id,
      executor: conn.execute.bind(conn),
      emit: false
    });

    const [updatedRows] = await conn.execute(
      `SELECT id, user_id, order_channel, status, payment_method, payment_status, payment_reference,
         transaction_id, paid_at, cash_received, change_amount, tracking_number, fulfillment_method,
         delivery_address, delivery_latitude, delivery_longitude, delivery_municipality, delivery_province,
         delivery_region, delivery_postal_code, delivery_place_id, delivery_landmark, delivery_notes, meeting_place,
         subtotal_amount, coupon_discount, sale_discount, shipping_fee, shipping_zone, shipping_distance_km,
         shipping_rule, coupon_code, total_amount,
         checkout_url, created_at
       FROM orders
       WHERE id = ?`,
      [orderId]
    );
    await conn.commit();

    const cancelledOrder = updatedRows[0];
    req.app.get("io")?.to(`user:${req.user.id}`).emit("order:update", { id: orderId, status: "cancelled", payment_status: "cancelled" });
    req.app.get("io")?.to("admin").emit("order:update", { id: orderId, status: "cancelled", payment_status: "cancelled" });
    inventoryUpdates.forEach((update) => {
      req.app.get("io")?.emit("inventory:update", { type: "inventory", action: "order_cancelled", ...update });
    });
    req.app.get("io")?.to("admin").emit("notification:new", adminCancelNotification);
    res.json({
      message: "Order cancelled successfully.",
      order: cancelledOrder
    });
  } catch (error) {
    await rollbackQuietly(conn, "order-cancel");
    throw error;
  } finally {
    conn.release();
  }
}));

async function createOrderTransactionAttempt(req, input, pricing, attempt) {
  const { config } = await loadSystemSettings();
  const lowStockThreshold = Number(config?.inventory?.lowStockThreshold ?? 3);
  const conn = await pool.getConnection();
  const startedAt = Date.now();
  const userId = req.user.id;
  console.log("[order-transaction] start", { userId, itemCount: pricing.items.length, attempt });

  try {
    await conn.beginTransaction();
    const productIds = pricing.items.map((item) => Number(item.product_id)).sort((left, right) => left - right);
    const placeholders = productIds.map(() => "?").join(",");
    const [lockedProducts] = await conn.execute(
      `SELECT id, name, price, stock
       FROM products
       WHERE id IN (${placeholders})
         AND is_deleted = FALSE
       ORDER BY id ASC
       FOR UPDATE`,
      productIds
    );
    if (lockedProducts.length !== productIds.length) throw new HttpError(404, "Apparel item not found");
    const productById = new Map(lockedProducts.map((product) => [Number(product.id), product]));

    for (const item of pricing.items) {
      const product = productById.get(Number(item.product_id));
      if (!product) throw new HttpError(404, "Apparel item not found");
      if (Number(product.stock || 0) < item.quantity) {
        throw new HttpError(400, `Only ${product.stock} items remaining in stock.`);
      }
      if (Math.abs(Number(product.price || 0) - Number(item.price || 0)) > 0.009) {
        throw new HttpError(409, "An item price changed. Please review your cart and try again.");
      }
    }

    const [orderResult] = await conn.execute(
      `INSERT INTO orders
        (user_id, status, payment_method, payment_status, fulfillment_method, delivery_address,
         delivery_latitude, delivery_longitude, delivery_municipality, delivery_province, delivery_region,
         delivery_postal_code, delivery_place_id, delivery_landmark, delivery_notes, subtotal_amount,
         coupon_discount, sale_discount, shipping_fee, shipping_zone, shipping_distance_km, shipping_rule,
         coupon_code, total_amount)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        input.payment_method === "cod" ? "pending" : "awaiting_payment",
        input.payment_method,
        input.payment_method === "cod" ? "unpaid" : "awaiting_payment",
        input.fulfillment_method,
        input.fulfillment_method === "delivery" ? input.delivery_address : null,
        input.fulfillment_method === "delivery" ? input.delivery_latitude ?? null : null,
        input.fulfillment_method === "delivery" ? input.delivery_longitude ?? null : null,
        input.fulfillment_method === "delivery" ? input.delivery_municipality || null : null,
        input.fulfillment_method === "delivery" ? input.delivery_province || null : null,
        input.fulfillment_method === "delivery" ? input.delivery_region || null : null,
        input.fulfillment_method === "delivery" ? input.delivery_postal_code || null : null,
        input.fulfillment_method === "delivery" ? input.delivery_place_id || null : null,
        input.fulfillment_method === "delivery" ? input.delivery_landmark || null : null,
        input.fulfillment_method === "delivery" ? input.delivery_notes || null : null,
        pricing.subtotal,
        pricing.couponDiscount,
        pricing.saleDiscount,
        pricing.shippingFee,
        pricing.shippingZone,
        pricing.shippingDistanceKm ?? null,
        pricing.shippingRule,
        pricing.coupon?.code || null,
        pricing.total
      ]
    );

    const inventoryUpdates = [];
    const outOfStockProducts = [];
    for (const item of pricing.items) {
      const finalLinePrice = item.quantity ? Math.max(0, (item.subtotal - item.saleDiscount) / item.quantity) : item.price;
      await conn.execute(
        "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)",
        [orderResult.insertId, item.product_id, item.quantity, finalLinePrice]
      );
      const [stockResult] = await conn.execute(
        `UPDATE products
         SET stock = stock - ?,
             status = CASE
               WHEN stock - ? <= 0 THEN 'Out of Stock'
               WHEN stock - ? <= ${lowStockThreshold} THEN 'Low Stock'
               ELSE 'In Stock'
             END
         WHERE id = ?
           AND is_deleted = FALSE
           AND stock >= ?`,
        [item.quantity, item.quantity, item.quantity, item.product_id, item.quantity]
      );
      if (stockResult.affectedRows !== 1) {
        const product = productById.get(Number(item.product_id));
        throw new HttpError(400, `${product?.name || "This apparel item"} does not have enough stock.`);
      }
      const [updatedProducts] = await conn.execute("SELECT id, name, stock FROM products WHERE id = ?", [item.product_id]);
      const nextStock = Number(updatedProducts[0]?.stock || 0);
      const nextStatus = nextStock <= 0 ? "Out of Stock" : nextStock <= lowStockThreshold ? "Low Stock" : "In Stock";
      inventoryUpdates.push({
        id: Number(item.product_id),
        name: updatedProducts[0]?.name,
        stock: nextStock,
        status: nextStatus
      });
      if (nextStock === 0) {
        outOfStockProducts.push({ id: Number(item.product_id), name: updatedProducts[0]?.name || item.name });
      }
    }

    if (pricing.items.length) {
      await conn.execute(
        `DELETE FROM cart_items
         WHERE user_id = ?
           AND product_id IN (${placeholders})`,
        [userId, ...productIds]
      );
    }

    await conn.commit();
    console.log("[order-transaction] committed", {
      userId,
      orderId: orderResult.insertId,
      durationMs: Date.now() - startedAt,
      attempt
    });

    return {
      orderId: orderResult.insertId,
      inventoryUpdates,
      outOfStockProducts,
      response: {
        id: orderResult.insertId,
        total_amount: pricing.total,
        pricing,
        status: input.payment_method === "cod" ? "pending" : "awaiting_payment",
        payment_method: input.payment_method,
        fulfillment_method: input.fulfillment_method
      }
    };
  } catch (error) {
    await rollbackQuietly(conn, "order-create");
    console.error("[order-transaction] failed", {
      userId,
      durationMs: Date.now() - startedAt,
      attempt,
      code: error?.code,
      errno: error?.errno,
      message: error?.message
    });
    throw error;
  } finally {
    conn.release();
  }
}

async function createOrderWithRetry(req, input, pricing) {
  for (let attempt = 1; attempt <= maxOrderCreateAttempts; attempt += 1) {
    try {
      return await createOrderTransactionAttempt(req, input, pricing, attempt);
    } catch (error) {
      if (!isTransientOrderLockError(error)) throw error;
      if (attempt >= maxOrderCreateAttempts) {
        throw new HttpError(409, "This item is temporarily being updated. Please try checkout again.");
      }
      await sleep(100 * attempt + Math.floor(Math.random() * 120));
    }
  }
  throw new HttpError(409, "This item is temporarily being updated. Please try checkout again.");
}

async function runOrderCreatedSideEffects(req, result) {
  const io = req.app.get("io");
  const orderBody = `Order #${result.orderId} was placed by ${req.user.username || "a customer"}.`;
  try {
    const adminNotification = await createAdminNotification({
      type: "order",
      title: "New order received",
      body: orderBody,
      customerId: req.user.id,
      emit: false
    });
    io?.to("admin").emit("notification:new", adminNotification);
  } catch (error) {
    console.error("[order-side-effects] admin notification failed", { orderId: result.orderId, message: error?.message, code: error?.code });
  }

  try {
    await query(
      "INSERT INTO notifications (user_id, type, title, body) VALUES (?, 'order', 'Order placed', ?)",
      [req.user.id, `Your order #${result.orderId} was placed successfully.`]
    );
  } catch (error) {
    console.error("[order-side-effects] customer notification failed", { orderId: result.orderId, message: error?.message, code: error?.code });
  }

  for (const product of result.outOfStockProducts) {
    try {
      await query(
        "INSERT INTO notifications (type, title, body, product_id) VALUES ('inventory', 'Out of stock', ?, ?)",
        [`${product.name} is now out of stock.`, product.id]
      );
    } catch (error) {
      console.error("[order-side-effects] inventory notification failed", { orderId: result.orderId, productId: product.id, message: error?.message, code: error?.code });
    }
  }

  io?.to("admin").emit("order:new", { id: result.orderId, total_amount: result.response.total_amount });
  result.inventoryUpdates.forEach((update) => {
    io?.emit("inventory:update", { type: "inventory", action: "ordered", ...update });
  });
  result.outOfStockProducts.forEach((product) => {
    io?.to("admin").emit("notification:new", { type: "inventory", title: "Out of stock", body: `${product.name} is now out of stock.` });
  });
}

router.post("/", requireAuth, requireApproved, asyncHandler(async (req, res) => {
  await ensureOrderColumns();
  await ensureCartTable();
  await ensureProductInventoryColumns();
  const schema = z.object({
    payment_method: z.enum(["cod", "gcash", "qrph", "debit", "credit", "maya"]).optional().default("cod"),
    fulfillment_method: z.enum(["delivery", "pickup"]).optional().default("delivery"),
    coupon_code: z.string().trim().max(40).optional().default(""),
    delivery_address: z.string().trim().max(500).optional().default(""),
    delivery_latitude: nullableCoordinate(-90, 90),
    delivery_longitude: nullableCoordinate(-180, 180),
    delivery_landmark: z.string().trim().max(255).optional().default(""),
    delivery_notes: z.string().trim().max(1000).optional().default(""),
    items: z.array(z.object({ product_id: z.coerce.number().int().positive(), quantity: z.coerce.number().int().positive() })).min(1)
  });
  const input = schema.parse(req.body);
  const savedLocation = await loadCustomerDeliveryLocation(req.user.id);
  if (input.fulfillment_method === "delivery" && !savedLocation?.formattedAddress) {
    throw new HttpError(400, "Please save your delivery location before checkout.");
  }
  if (input.payment_method === "cod") {
    const explicitDeliveryArea = String(savedLocation?.deliveryAreaOverride || "").trim().toLowerCase();
    const shippingQuote = input.fulfillment_method === "delivery"
      ? await calculateShippingQuote(savedLocation || {}, { fulfillmentMethod: "delivery" })
      : null;
    if (explicitDeliveryArea === "outside" || (input.fulfillment_method === "delivery" && shippingQuote?.shippingZone !== "nearby")) {
      throw new HttpError(400, codMunicipalityError);
    }
  }
  const trustedInput = input.fulfillment_method === "delivery" ? {
    ...input,
    delivery_address: savedLocation.formattedAddress,
    delivery_latitude: savedLocation.latitude,
    delivery_longitude: savedLocation.longitude,
    delivery_municipality: savedLocation.municipality,
    delivery_province: savedLocation.province,
    delivery_region: savedLocation.region,
    delivery_postal_code: savedLocation.postalCode,
    delivery_place_id: savedLocation.placeId,
    delivery_landmark: savedLocation.landmark || "",
    delivery_notes: savedLocation.notes || ""
  } : input;
  const compactItems = compactOrderItems(input.items);
  const pricing = await calculateCheckoutPricing(
    compactItems,
    input.coupon_code,
    input.fulfillment_method,
    { location: savedLocation }
  );
  if (input.coupon_code && !pricing.coupon) throw new HttpError(400, "Coupon is invalid or expired.");
  const result = await createOrderWithRetry(req, trustedInput, pricing);
  void runOrderCreatedSideEffects(req, result).catch((error) => {
    console.error("[order-side-effects] failed", { orderId: result.orderId, message: error?.message, code: error?.code });
  });
  res.status(201).json(result.response);
}));

router.patch("/:id/status", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  await ensureOrderColumns();
  const schema = z.object({ status: z.enum(statuses) });
  const { status } = schema.parse(req.body);
  const orders = await query("SELECT user_id, status, payment_method, payment_status, fulfillment_method, delivery_address, delivery_latitude, delivery_longitude, delivery_municipality, meetup_confirmation_status, meeting_place, meetup_date, meetup_time FROM orders WHERE id = :id", { id: req.params.id });
  if (!orders.length) throw new HttpError(404, "Order not found");
  const currentStatus = normalizeOrderStatus(orders[0].status);
  if (currentStatus !== status && !allowedAdminStatusTransitions[currentStatus]?.has(status)) {
    throw new HttpError(409, "This order status cannot be changed that way.");
  }
  const isCod = String(orders[0].payment_method || "").toLowerCase() === "cod";
  if (status === "approved" && !isCod && orders[0].payment_status !== "paid") {
    throw new HttpError(409, "This online order must be paid before it can be accepted.");
  }
  if (status === "ready") {
    const [decoratedOrder] = await decorateMeetupEligibility(orders);
    if (decoratedOrder.meetup_area_eligible) {
      const scheduleSaved = Boolean(orders[0].meeting_place && orders[0].meetup_date && orders[0].meetup_time);
      if (!scheduleSaved) {
        throw new HttpError(409, "Save the meetup place, date, and time before sending this local order out for delivery.");
      }
      if (orders[0].meetup_confirmation_status !== "agreed") {
        throw new HttpError(409, "The customer must agree to the proposed meetup schedule before this order can go out for delivery.");
      }
    }
  }
  await query("UPDATE orders SET status = :status WHERE id = :id", { id: req.params.id, status });
  const title = status === "ready" ? "Out for Delivery" : status === "completed" ? "Order received" : "Order update";
  const body = status === "ready"
    ? "Your order is out for delivery."
    : status === "completed"
      ? "Your order was marked received. Please send feedback from the Feedback page."
      : `Your order is now ${status}.`;
  await query(
    "INSERT INTO notifications (user_id, type, title, body) VALUES (:userId, 'order', :title, :body)",
    { userId: orders[0].user_id, title, body }
  );
  if (status === "completed" && orders[0].status !== "completed") {
    await query(
      "INSERT INTO notifications (type, title, body) VALUES ('order', 'Sale completed', :body)",
      { body: `Order #${req.params.id} was received by the customer. Feedback can now be collected.` }
    );
  }
  req.app.get("io")?.to(`user:${orders[0].user_id}`).emit("order:update", { id: Number(req.params.id), status });
  res.json({ message: "Order updated" });
}));

router.post("/:id/resolve-delivery-location", requireAuth, requireApproved, asyncHandler(async (req, res) => {
  await ensureOrderColumns();
  const ownershipFilter = req.user.role === "admin" ? "" : "AND o.user_id = :userId";
  const orders = await query(`SELECT o.id, o.user_id, o.delivery_address, o.delivery_latitude, o.delivery_longitude FROM orders o WHERE o.id = :id ${ownershipFilter} LIMIT 1`, { id: req.params.id, userId: req.user.id });
  if (!orders.length) throw new HttpError(404, "Order not found");
  const existingLatitude = Number(orders[0].delivery_latitude);
  const existingLongitude = Number(orders[0].delivery_longitude);
  if (Number.isFinite(existingLatitude) && Number.isFinite(existingLongitude) && Math.abs(existingLatitude) <= 90 && Math.abs(existingLongitude) <= 180 && !(Math.abs(existingLatitude) < 0.01 && Math.abs(existingLongitude) < 0.01)) {
    return res.json({ delivery_latitude: existingLatitude, delivery_longitude: existingLongitude });
  }
  const address = String(orders[0].delivery_address || "").trim();
  if (!address) throw new HttpError(409, "No saved delivery address is available to resolve.");
  const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=ph&q=${encodeURIComponent(address)}`, { headers: { "User-Agent": "RETELA/1.0 delivery-location-resolver" } });
  if (!response.ok) throw new HttpError(503, "Delivery location could not be resolved right now.");
  const geocoded = await response.json();
  const [result] = Array.isArray(geocoded) ? geocoded : [];
  const latitude = Number.parseFloat(result?.lat);
  const longitude = Number.parseFloat(result?.lon);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude) < 0.01 || Math.abs(longitude) < 0.01) throw new HttpError(503, "Delivery location coordinates are unavailable for this order.");
  await query("UPDATE orders SET delivery_latitude = :latitude, delivery_longitude = :longitude WHERE id = :id AND delivery_latitude IS NULL AND delivery_longitude IS NULL", { id: req.params.id, latitude, longitude });
  const payload = { id: Number(req.params.id), delivery_latitude: latitude, delivery_longitude: longitude };
  req.app.get("io")?.to(`user:${orders[0].user_id}`).emit("order:update", payload);
  req.app.get("io")?.to("admin").emit("order:update", payload);
  res.json(payload);
}));

router.patch("/:id/tracking", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  await ensureOrderColumns();
  const schema = z.object({ tracking_number: z.string().trim().max(120).optional().default("") });
  const input = schema.parse(req.body);
  const orders = await query("SELECT user_id FROM orders WHERE id = :id", { id: req.params.id });
  if (!orders.length) throw new HttpError(404, "Order not found");
  await query("UPDATE orders SET tracking_number = :trackingNumber WHERE id = :id", {
    id: req.params.id,
    trackingNumber: input.tracking_number || null
  });
  await query(
    "INSERT INTO notifications (user_id, type, title, body) VALUES (:userId, 'order', 'Tracking updated', :body)",
    { userId: orders[0].user_id, body: input.tracking_number ? `Tracking number: ${input.tracking_number}` : "Tracking number was cleared." }
  );
  req.app.get("io")?.to(`user:${orders[0].user_id}`).emit("order:update", { id: Number(req.params.id), tracking_number: input.tracking_number || null });
  res.json({ message: "Tracking updated", tracking_number: input.tracking_number || null });
}));

router.patch("/:id/meeting-place", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  await ensureOrderColumns();
  const schema = z.object({
    meetingPlace: z.string().trim().min(1, "Meeting place is required.").max(500),
    meetingLatitude: nullableCoordinate(-90, 90),
    meetingLongitude: nullableCoordinate(-180, 180),
    meetupDate: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/, "Meetup date is required."),
    meetupTime: z.string().trim().regex(/^\d{2}:\d{2}$/, "Meetup time is required.")
  });
  const input = schema.parse(req.body);
  if (Number.isNaN(new Date(`${input.meetupDate}T00:00:00Z`).getTime())) {
    throw new HttpError(400, "Meetup date is invalid.");
  }
  const [hours, minutes] = input.meetupTime.split(":").map(Number);
  if (hours > 23 || minutes > 59) throw new HttpError(400, "Meetup time is invalid.");
  const meetupDateTime = new Date(`${input.meetupDate}T${input.meetupTime}:00`);
  if (Number.isNaN(meetupDateTime.getTime()) || meetupDateTime.getTime() <= Date.now()) {
    throw new HttpError(400, "Meetup date and time must be in the future.");
  }
  const orderId = Number(req.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) throw new HttpError(400, "A valid order ID is required");
  const orders = await query("SELECT orders.id, orders.user_id, orders.status, orders.order_channel, orders.fulfillment_method, orders.delivery_address, orders.delivery_latitude, orders.delivery_longitude, orders.delivery_municipality, orders.meeting_latitude, orders.meeting_longitude, users.location FROM orders LEFT JOIN users ON users.id = orders.user_id WHERE orders.id = :id", { id: orderId });
  if (!orders.length) throw new HttpError(404, "Order not found");
  const [decoratedOrder] = await decorateMeetupEligibility(orders);
  if (normalizeOrderStatus(orders[0].status) !== "approved") {
    throw new HttpError(409, "Meetup details can only be scheduled after the order is accepted.");
  }
  if (!decoratedOrder?.meetup_area_eligible) {
    throw new HttpError(403, "Meetup details are only available for verified local customers within the configured delivery range.");
  }
  const meetingPlace = input.meetingPlace;
  const meetingLatitude = input.meetingLatitude === undefined ? orders[0].meeting_latitude ?? null : input.meetingLatitude;
  const meetingLongitude = input.meetingLongitude === undefined ? orders[0].meeting_longitude ?? null : input.meetingLongitude;
  const meetupDate = input.meetupDate;
  const meetupTime = input.meetupTime;
  await query("UPDATE orders SET meeting_place = :meetingPlace, meeting_latitude = :meetingLatitude, meeting_longitude = :meetingLongitude, meetup_date = :meetupDate, meetup_time = :meetupTime, meetup_confirmation_status = 'pending', meetup_confirmed_at = NULL, meetup_customer_note = NULL, meetup_24h_reminder_sent_at = NULL, meetup_1h_reminder_sent_at = NULL WHERE id = :id", { id: orderId, meetingPlace, meetingLatitude, meetingLongitude, meetupDate, meetupTime });
  if (orders[0].user_id) {
    await query(
      "INSERT INTO notifications (user_id, type, title, body) VALUES (:userId, 'order', 'Meetup schedule proposed', :body)",
      {
        userId: orders[0].user_id,
        body: `Please review the meetup schedule for Order #${orderId}: ${meetingPlace} on ${meetupDate} at ${meetupTime}.`
      }
    );
    req.app.get("io")?.to(`user:${orders[0].user_id}`).emit("order:update", { id: orderId, meeting_place: meetingPlace, meeting_latitude: meetingLatitude, meeting_longitude: meetingLongitude, meetup_date: meetupDate, meetup_time: meetupTime, meetup_confirmation_status: "pending", meetup_confirmed_at: null, meetup_customer_note: null, meetup_24h_reminder_sent_at: null, meetup_1h_reminder_sent_at: null });
    req.app.get("io")?.to(`user:${orders[0].user_id}`).emit("notification:new", {
      type: "order",
      title: "Meetup schedule proposed",
      body: `Please review the meetup schedule for Order #${orderId}: ${meetingPlace} on ${meetupDate} at ${meetupTime}.`
    });
  }
  const meetupPayload = { id: orderId, meeting_place: meetingPlace, meeting_latitude: meetingLatitude, meeting_longitude: meetingLongitude, meetup_date: meetupDate, meetup_time: meetupTime, meetup_confirmation_status: "pending", meetup_confirmed_at: null, meetup_customer_note: null, meetup_24h_reminder_sent_at: null, meetup_1h_reminder_sent_at: null };
  req.app.get("io")?.to("admin").emit("order:update", meetupPayload);
  res.json({ message: "Meetup details saved", ...meetupPayload });
}));

router.patch("/:id/meetup-confirmation", requireAuth, requireApproved, asyncHandler(async (req, res) => {
  await ensureOrderColumns();
  const input = z.object({ decision: z.enum(["agreed", "disagreed"]), note: z.string().trim().max(500).optional().default("") }).parse(req.body);
  const orderId = Number(req.params.id);
  if (!Number.isInteger(orderId) || orderId <= 0) throw new HttpError(400, "A valid order ID is required");
  const orders = await query(
    `SELECT o.id, o.user_id, o.status, o.fulfillment_method, o.delivery_address, o.delivery_latitude, o.delivery_longitude, o.delivery_municipality, o.meeting_place, o.meetup_date, o.meetup_time,
            o.meetup_confirmation_status, o.meetup_confirmed_at, o.meetup_customer_note, u.location
     FROM orders o LEFT JOIN users u ON u.id = o.user_id
     WHERE o.id = :id AND o.user_id = :userId LIMIT 1`,
    { id: orderId, userId: req.user.id }
  );
  if (!orders.length) throw new HttpError(404, "Order not found");
  const [eligible] = await decorateMeetupEligibility(orders);
  if (!eligible.meetup_eligible || !(eligible.meeting_place || eligible.meetup_date || eligible.meetup_time)) {
    throw new HttpError(409, "There is no active meetup schedule to confirm.");
  }
  const note = input.decision === "disagreed" ? (input.note || null) : null;
  if (eligible.meetup_confirmation_status === input.decision && (eligible.meetup_customer_note || null) === note) {
    return res.json({ message: "Meetup confirmation already recorded", meetup_confirmation_status: input.decision, meetup_confirmed_at: eligible.meetup_confirmed_at, meetup_customer_note: note });
  }
  const confirmedAt = input.decision === "agreed" ? new Date() : null;
  await query("UPDATE orders SET meetup_confirmation_status = :status, meetup_confirmed_at = :confirmedAt, meetup_customer_note = :note WHERE id = :id AND user_id = :userId", { id: orderId, userId: req.user.id, status: input.decision, confirmedAt, note });
  const title = input.decision === "agreed" ? "Meetup schedule confirmed" : "Meetup schedule declined";
  const body = input.decision === "agreed" ? `Customer confirmed the meetup schedule for Order #${orderId}.` : `Customer declined the meetup schedule for Order #${orderId}.`;
  await query("INSERT INTO notifications (type, title, body) VALUES ('order', :title, :body)", { title, body });
  const payload = { id: orderId, meetup_confirmation_status: input.decision, meetup_confirmed_at: confirmedAt, meetup_customer_note: note };
  req.app.get("io")?.to("admin").emit("order:update", payload);
  req.app.get("io")?.to("admin").emit("notification:new", { type: "order", title, body });
  req.app.get("io")?.to(`user:${req.user.id}`).emit("order:update", payload);
  res.json({ message: "Meetup confirmation saved", ...payload });
}));

export default router;
