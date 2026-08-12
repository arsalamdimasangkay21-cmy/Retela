import { query, safeModifyColumn } from "../config/db.js";

export const ADMIN_NOTIFICATION_TYPES = [
  "approval",
  "customer_registration",
  "registration",
  "order",
  "order_cancelled",
  "payment",
  "message",
  "feedback",
  "refund",
  "return",
  "inventory",
  "system"
];

export const NOTIFICATION_TYPE_ENUM_SQL = "ENUM('approval','customer_registration','registration','order','order_cancelled','payment','message','feedback','refund','return','new_product','inventory','system','broadcast')";

let notificationColumnCache;
let notificationSchemaReady;

export async function ensureAdminNotificationSchema() {
  notificationSchemaReady ||= safeModifyColumn(
    "notifications",
    "type",
    "type enum update",
    `ALTER TABLE notifications MODIFY type ${NOTIFICATION_TYPE_ENUM_SQL} NOT NULL`
  );
  return notificationSchemaReady;
}

export async function notificationColumns() {
  if (notificationColumnCache) return notificationColumnCache;
  const rows = await query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = 'notifications'`
  );
  notificationColumnCache = new Set(rows.map((row) => row.COLUMN_NAME));
  return notificationColumnCache;
}

function normalizeExecutorResult(result) {
  if (Array.isArray(result) && result[0]?.insertId !== undefined) return result[0];
  return result;
}

function adminNotificationPayload({ id, type, title, body, customerId = null, productId = null, broadcastId = null }) {
  return {
    id,
    user_id: ["registration", "customer_registration", "approval"].includes(type) ? customerId : null,
    customer_id: customerId,
    product_id: productId,
    broadcast_id: broadcastId,
    type,
    title,
    body,
    message: body,
    is_read: false,
    created_at: new Date().toISOString()
  };
}

export async function createAdminNotification({
  type,
  title,
  body,
  customerId = null,
  productId = null,
  broadcastId = null,
  app = null,
  io = null,
  executor = query,
  emit = true
}) {
  await ensureAdminNotificationSchema();
  const columns = await notificationColumns();
  const insertColumns = ["type", "title", "body"];
  const values = [type, title, String(body || "").slice(0, 255)];

  if (columns.has("user_id") && customerId && ["registration", "customer_registration", "approval"].includes(type)) {
    insertColumns.push("user_id");
    values.push(customerId);
  }

  if (columns.has("product_id") && productId) {
    insertColumns.push("product_id");
    values.push(productId);
  }

  if (columns.has("broadcast_id") && broadcastId) {
    insertColumns.push("broadcast_id");
    values.push(broadcastId);
  }

  const placeholders = insertColumns.map(() => "?").join(", ");
  const result = normalizeExecutorResult(await executor(
    `INSERT INTO notifications (${insertColumns.join(", ")}) VALUES (${placeholders})`,
    values
  ));
  const payload = adminNotificationPayload({
    id: result.insertId,
    type,
    title,
    body: String(body || "").slice(0, 255),
    customerId,
    productId,
    broadcastId
  });

  console.log("[ADMIN NOTIFICATION CREATED]", {
    id: result.insertId,
    type,
    title
  });

  if (emit) {
    (io || app?.get("io"))?.to("admin").emit("notification:new", payload);
  }

  return payload;
}
