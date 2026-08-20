import { Router } from "express";
import { query, safeModifyColumn } from "../config/db.js";
import { asyncHandler } from "../utils/errors.js";
import { requireAuth } from "../middleware/auth.js";
import { productImageSelect, productImageUrlForRow } from "../utils/productImages.js";
import { ADMIN_NOTIFICATION_TYPES, NOTIFICATION_TYPE_ENUM_SQL } from "../utils/adminNotifications.js";
import {
  CUSTOMER_BLOCKED_NOTIFICATION_TEXT_PATTERNS,
  CUSTOMER_BLOCKED_NOTIFICATION_TITLES,
  CUSTOMER_PRIVATE_NOTIFICATION_TYPES,
  CUSTOMER_PUBLIC_NOTIFICATION_TYPES,
  CUSTOMER_SAFE_BROADCAST_TYPES
} from "../utils/notificationVisibility.js";

const router = Router();
let notificationBroadcastSchemaReady;

const ADMIN_TYPES_SQL = ADMIN_NOTIFICATION_TYPES.map((type) => `'${type}'`).join(", ");
const REGISTRATION_TYPES_SQL = "'approval', 'customer_registration', 'registration'";
const CUSTOMER_PRIVATE_TYPES_SQL = CUSTOMER_PRIVATE_NOTIFICATION_TYPES.map((type) => `'${type}'`).join(", ");
const CUSTOMER_PUBLIC_TYPES_SQL = CUSTOMER_PUBLIC_NOTIFICATION_TYPES.map((type) => `'${type}'`).join(", ");
const CUSTOMER_SAFE_BROADCAST_TYPES_SQL = CUSTOMER_SAFE_BROADCAST_TYPES.map((type) => `'${type}'`).join(", ");
const CUSTOMER_BLOCKED_TITLE_SQL = CUSTOMER_BLOCKED_NOTIFICATION_TITLES.map((title) => `'${title}'`).join(", ");
const CUSTOMER_BLOCKED_TEXT_SQL = CUSTOMER_BLOCKED_NOTIFICATION_TEXT_PATTERNS
  .map((pattern, index) => `AND LOWER(CONCAT_WS(' ', COALESCE(n.title, ''), COALESCE(n.body, ''))) NOT LIKE :customerBlockedText${index}`)
  .join("\n  ");
const CUSTOMER_BLOCKED_TEXT_PARAMS = Object.fromEntries(
  CUSTOMER_BLOCKED_NOTIFICATION_TEXT_PATTERNS.map((pattern, index) => [`customerBlockedText${index}`, pattern])
);

const CUSTOMER_ADMIN_ACTIVITY_FILTER_SQL = `
  AND LOWER(COALESCE(n.title, '')) NOT IN (${CUSTOMER_BLOCKED_TITLE_SQL})
  ${CUSTOMER_BLOCKED_TEXT_SQL}
`;

const CUSTOMER_SAFE_BROADCAST_SQL = `(
       n.user_id = :id
       AND n.type = 'broadcast'
       AND b.id IS NOT NULL
       AND COALESCE(b.is_deleted, FALSE) = FALSE
       AND (
         b.broadcast_type IN (${CUSTOMER_SAFE_BROADCAST_TYPES_SQL})
         OR COALESCE(b.sale_enabled, FALSE) = TRUE
         OR COALESCE(b.promo_code, '') <> ''
       )
     )`;

const CUSTOMER_VISIBILITY_PREDICATE = `(
       (n.user_id = :id AND n.type IN (${CUSTOMER_PRIVATE_TYPES_SQL}))
       OR ${CUSTOMER_SAFE_BROADCAST_SQL}
       OR (n.user_id IS NULL AND n.type IN (${CUSTOMER_PUBLIC_TYPES_SQL}))
     )
     ${CUSTOMER_ADMIN_ACTIVITY_FILTER_SQL}`;

const CUSTOMER_OWNED_VISIBILITY_PREDICATE = `(
       (n.user_id = :id AND n.type IN (${CUSTOMER_PRIVATE_TYPES_SQL}))
       OR ${CUSTOMER_SAFE_BROADCAST_SQL}
     )
     ${CUSTOMER_ADMIN_ACTIVITY_FILTER_SQL}`;

const CUSTOMER_VISIBILITY_FILTER = `WHERE ${CUSTOMER_VISIBILITY_PREDICATE}`;

function setDynamicNotificationHeaders(res) {
  res.set("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
  res.set("Pragma", "no-cache");
  res.set("Expires", "0");
  res.set("ETag", `"notifications-${Date.now()}"`);
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

async function attachCustomerNotificationDetails(rows) {
  const productIds = new Set();
  for (const row of rows) {
    if (row.product_id) productIds.add(Number(row.product_id));
    parseJson(row.sale_product_ids_json, []).forEach((id) => {
      const productId = Number(id);
      if (productId) productIds.add(productId);
    });
  }

  const productsById = new Map();
  if (productIds.size) {
    const ids = [...productIds];
    const params = Object.fromEntries(ids.map((id, index) => [`id${index}`, id]));
    const placeholders = ids.map((_, index) => `:id${index}`).join(", ");
    const products = await query(
      `SELECT id, sku, name, brand, category, size, price, stock, image_url, ${productImageSelect("products")}
       FROM products
       WHERE id IN (${placeholders})`,
      params
    );
    products.forEach((product) => productsById.set(Number(product.id), { ...product, image_url: productImageUrlForRow(product), imageUrl: productImageUrlForRow(product) }));
  }

  return rows.map((row) => {
    const saleProductIds = parseJson(row.sale_product_ids_json, []).map(Number).filter(Boolean);
    const relatedProducts = [];
    if (row.product_id && productsById.has(Number(row.product_id))) {
      relatedProducts.push(productsById.get(Number(row.product_id)));
    }
    saleProductIds.forEach((id) => {
      const product = productsById.get(Number(id));
      if (product && !relatedProducts.some((item) => Number(item.id) === Number(product.id))) {
        relatedProducts.push(product);
      }
    });

    const hasBroadcast = Boolean(row.broadcast_id);
    const discountPercentage = Number(row.sale_discount_percent || 0);
    return {
      id: row.id,
      user_id: row.user_id,
      product_id: row.product_id,
      broadcast_id: row.broadcast_id,
      type: row.type,
      title: row.title,
      body: row.broadcast_message || row.body,
      message: row.broadcast_message || row.body,
      is_read: Boolean(row.is_read),
      created_at: row.created_at,
      promo_code: row.promo_code || "",
      discount_percentage: discountPercentage > 0 ? discountPercentage : null,
      promo_starts_at: row.sale_starts_at || null,
      promo_ends_at: row.sale_ends_at || null,
      related_products: relatedProducts,
      broadcast: hasBroadcast ? {
        id: row.broadcast_id,
        title: row.broadcast_title || row.title,
        message: row.broadcast_message || row.body,
        image_url: row.broadcast_image_url || null,
        promo_code: row.promo_code || "",
        broadcast_type: row.broadcast_type || "broadcast",
        sale_enabled: Boolean(row.sale_enabled),
        discount_percentage: discountPercentage > 0 ? discountPercentage : null,
        product_ids: saleProductIds,
        starts_at: row.sale_starts_at || null,
        ends_at: row.sale_ends_at || null
      } : null
    };
  });
}

async function ensureNotificationBroadcastSchema() {
  notificationBroadcastSchemaReady ||= (async () => {
    const rows = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'notifications'
         AND COLUMN_NAME IN ('broadcast_id')`
    );
    const columns = new Set(rows.map((row) => row.COLUMN_NAME));
    if (!columns.has("broadcast_id")) {
      await query("ALTER TABLE notifications ADD COLUMN broadcast_id INT NULL AFTER product_id");
      await query("CREATE INDEX idx_notifications_broadcast ON notifications (broadcast_id)");
    }
    await safeModifyColumn("notifications", "type", "type enum update", `ALTER TABLE notifications MODIFY type ${NOTIFICATION_TYPE_ENUM_SQL} NOT NULL`);
    const broadcastRows = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'broadcasts'
         AND COLUMN_NAME IN ('is_deleted', 'deleted_at', 'deleted_by', 'sale_enabled', 'sale_discount_percent', 'sale_product_ids_json', 'sale_starts_at', 'sale_ends_at')`
    );
    const broadcastColumns = new Set(broadcastRows.map((row) => row.COLUMN_NAME));
    if (!broadcastColumns.has("is_deleted")) {
      await query("ALTER TABLE broadcasts ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE AFTER created_by");
    }
    if (!broadcastColumns.has("deleted_at")) {
      await query("ALTER TABLE broadcasts ADD COLUMN deleted_at DATETIME NULL AFTER is_deleted");
    }
    if (!broadcastColumns.has("deleted_by")) {
      await query("ALTER TABLE broadcasts ADD COLUMN deleted_by INT NULL AFTER deleted_at");
    }
    if (!broadcastColumns.has("sale_enabled")) {
      await query("ALTER TABLE broadcasts ADD COLUMN sale_enabled BOOLEAN NOT NULL DEFAULT FALSE AFTER deleted_by");
    }
    if (!broadcastColumns.has("sale_discount_percent")) {
      await query("ALTER TABLE broadcasts ADD COLUMN sale_discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER sale_enabled");
    }
    if (!broadcastColumns.has("sale_product_ids_json")) {
      await query("ALTER TABLE broadcasts ADD COLUMN sale_product_ids_json JSON NULL AFTER sale_discount_percent");
    }
    if (!broadcastColumns.has("sale_starts_at")) {
      await query("ALTER TABLE broadcasts ADD COLUMN sale_starts_at DATETIME NULL AFTER sale_product_ids_json");
    }
    if (!broadcastColumns.has("sale_ends_at")) {
      await query("ALTER TABLE broadcasts ADD COLUMN sale_ends_at DATETIME NULL AFTER sale_starts_at");
    }
    await query(`
      CREATE TABLE IF NOT EXISTS broadcast_deliveries (
        id INT AUTO_INCREMENT PRIMARY KEY,
        broadcast_id INT NOT NULL,
        user_id INT NOT NULL,
        notification_id INT NULL,
        channel ENUM('in_app','email','sms','ai_chat') NOT NULL,
        delivery_status ENUM('sent','failed','skipped') NOT NULL DEFAULT 'sent',
        delivered_at DATETIME NULL,
        opened_at DATETIME NULL,
        clicked_at DATETIME NULL,
        error_message VARCHAR(255) NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_broadcast_deliveries_broadcast (broadcast_id),
        INDEX idx_broadcast_deliveries_user (user_id),
        INDEX idx_broadcast_deliveries_notification (notification_id)
      )
    `);
  })().catch((error) => {
    notificationBroadcastSchemaReady = undefined;
    throw error;
  });
  return notificationBroadcastSchemaReady;
}

router.use(requireAuth);

router.get("/", asyncHandler(async (req, res) => {
  await ensureNotificationBroadcastSchema();
  setDynamicNotificationHeaders(res);
  const visibilityFilter = req.user.role === "customer"
    ? CUSTOMER_VISIBILITY_FILTER
    : `WHERE (
         n.user_id IS NULL
         OR n.type IN (${REGISTRATION_TYPES_SQL})
       )
       AND n.type IN (${ADMIN_TYPES_SQL})`;
  const rows = await query(
    req.user.role === "customer"
      ? `SELECT
           n.*,
           n.body AS message,
           b.title AS broadcast_title,
           b.message AS broadcast_message,
           b.image_url AS broadcast_image_url,
           b.promo_code,
           b.broadcast_type,
           b.sale_enabled,
           b.sale_discount_percent,
           b.sale_product_ids_json,
           b.sale_starts_at,
           b.sale_ends_at
         FROM notifications n
         LEFT JOIN broadcasts b ON b.id = n.broadcast_id
         ${visibilityFilter}
         ORDER BY n.created_at DESC, n.id DESC LIMIT 100`
      : `SELECT
           n.*,
           n.body AS message,
           u.id AS customerId,
           u.username AS username,
           u.email AS email,
           u.phone_number AS phone,
           u.location AS location,
           u.status AS status,
           u.id AS registration_id,
           u.username AS registration_username,
           u.email AS registration_email,
           u.phone_number AS registration_phone,
           u.location AS registration_location,
           u.status AS registration_status,
           u.created_at AS registration_created_at
         FROM notifications n
         LEFT JOIN users u ON u.id = n.user_id
         ${visibilityFilter}
         ORDER BY n.created_at DESC, n.id DESC LIMIT 100`,
    req.user.role === "customer" ? { id: req.user.id, ...CUSTOMER_BLOCKED_TEXT_PARAMS } : { id: req.user.id }
  );
  if (req.user.role !== "admin") {
    return res.json(await attachCustomerNotificationDetails(rows));
  }
  const deduped = [];
  const seen = new Set();
  for (const row of rows) {
    const isRegistration = ["approval", "customer_registration", "registration"].includes(row.type) && row.title === "New customer registration";
    const key = isRegistration
      ? `registration:${row.customerId || row.registration_id || row.user_id || row.email || row.phone || row.registration_email || row.registration_phone || row.id}`
      : `notification:${row.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(row);
  }
  console.log("[ADMIN NOTIFICATIONS FETCH]", {
    count: deduped.length
  });
  res.json(deduped);
}));

router.patch("/read-all", asyncHandler(async (req, res) => {
  await ensureNotificationBroadcastSchema();
  setDynamicNotificationHeaders(res);
  if (req.user.role === "customer") {
    await query(
      `UPDATE notifications n
       LEFT JOIN broadcasts b ON b.id = n.broadcast_id
       SET n.is_read = true
       WHERE ${CUSTOMER_OWNED_VISIBILITY_PREDICATE.replaceAll(":id", ":userId")}`,
      { userId: req.user.id, ...CUSTOMER_BLOCKED_TEXT_PARAMS }
    );
    await query(
      `UPDATE broadcast_deliveries bd
       JOIN notifications n ON n.id = bd.notification_id
       LEFT JOIN broadcasts b ON b.id = n.broadcast_id
       SET bd.opened_at = COALESCE(bd.opened_at, NOW()),
           bd.clicked_at = COALESCE(bd.clicked_at, NOW())
       WHERE bd.channel = 'in_app'
         AND bd.user_id = :userId
         AND ${CUSTOMER_SAFE_BROADCAST_SQL.replaceAll(":id", ":userId")}`,
      { userId: req.user.id }
    );
  } else {
    await query(
      `UPDATE notifications
       SET is_read = true
       WHERE (
         user_id IS NULL
         OR type IN (${REGISTRATION_TYPES_SQL})
       )
         AND type IN (${ADMIN_TYPES_SQL})`
    );
  }
  res.json({ message: "Notifications marked as read" });
}));

router.patch("/read-type/:type", asyncHandler(async (req, res) => {
  await ensureNotificationBroadcastSchema();
  setDynamicNotificationHeaders(res);
  if (req.user.role === "customer") {
    await query(
      `UPDATE notifications n
       LEFT JOIN broadcasts b ON b.id = n.broadcast_id
       SET n.is_read = true
       WHERE n.type = :type
         AND ${CUSTOMER_OWNED_VISIBILITY_PREDICATE.replaceAll(":id", ":userId")}`,
      { userId: req.user.id, type: req.params.type, ...CUSTOMER_BLOCKED_TEXT_PARAMS }
    );
    if (req.params.type === "broadcast") {
      await query(
        `UPDATE broadcast_deliveries bd
         JOIN notifications n ON n.id = bd.notification_id
         LEFT JOIN broadcasts b ON b.id = n.broadcast_id
         SET bd.opened_at = COALESCE(bd.opened_at, NOW()),
             bd.clicked_at = COALESCE(bd.clicked_at, NOW())
         WHERE bd.channel = 'in_app'
           AND bd.user_id = :userId
           AND ${CUSTOMER_SAFE_BROADCAST_SQL.replaceAll(":id", ":userId")}`,
        { userId: req.user.id }
      );
    }
  } else {
    await query(
      `UPDATE notifications
       SET is_read = true
       WHERE type = :type
         AND (
           user_id IS NULL
           OR type IN (${REGISTRATION_TYPES_SQL})
         )
         AND type IN (${ADMIN_TYPES_SQL})`,
      { type: req.params.type }
    );
  }
  res.json({ message: "Notifications marked as read" });
}));

router.patch("/:id/read", asyncHandler(async (req, res) => {
  await ensureNotificationBroadcastSchema();
  setDynamicNotificationHeaders(res);
  if (req.user.role === "admin") {
    await query(
      `UPDATE notifications
       SET is_read = true
       WHERE id = :id
         AND (
           user_id IS NULL
           OR type IN (${REGISTRATION_TYPES_SQL})
         )
         AND type IN (${ADMIN_TYPES_SQL})`,
      { id: req.params.id }
    );
  } else {
    await query(
      `UPDATE notifications n
       LEFT JOIN broadcasts b ON b.id = n.broadcast_id
       SET n.is_read = true
       WHERE n.id = :notificationId
         AND ${CUSTOMER_OWNED_VISIBILITY_PREDICATE.replaceAll(":id", ":userId")}`,
      {
      notificationId: req.params.id,
      userId: req.user.id,
      ...CUSTOMER_BLOCKED_TEXT_PARAMS
    });
  }
  if (req.user.role === "customer") {
    await query(
      `UPDATE broadcast_deliveries bd
       JOIN notifications n ON n.id = bd.notification_id
       LEFT JOIN broadcasts b ON b.id = n.broadcast_id
       SET bd.opened_at = COALESCE(bd.opened_at, NOW()),
           bd.clicked_at = COALESCE(bd.clicked_at, NOW())
       WHERE bd.notification_id = :notificationId
         AND bd.user_id = :userId
         AND bd.channel = 'in_app'
         AND ${CUSTOMER_SAFE_BROADCAST_SQL.replaceAll(":id", ":userId")}`,
      {
        notificationId: req.params.id,
        userId: req.user.id
      }
    );
  }
  res.json({ message: "Notification marked as read" });
}));

export default router;
