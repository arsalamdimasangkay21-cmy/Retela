import { Router } from "express";
import { z } from "zod";
import { query, safeModifyColumn } from "../config/db.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { optionalAuth, requireApproved, requireAuth } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";
import { createAdminNotification, NOTIFICATION_TYPE_ENUM_SQL } from "../utils/adminNotifications.js";

const router = Router();
let notificationTypesReady;
let reviewColumnsReady;

const feedbackCategories = ["Apparel Quality", "Delivery", "Customer Service", "Payment", "Overall Experience", "Other"];
const deliveredStatuses = new Set(["delivered", "completed"]);
const unpaidStatuses = new Set(["pending", "awaiting_payment", "awaiting payment", "failed", "expired", "cancelled", "canceled"]);

function normalizeStatus(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, "_");
}

function canLeaveFeedback(order) {
  const status = normalizeStatus(order?.status || order?.order_status || order?.delivery_status);
  if (!deliveredStatuses.has(status)) return false;
  const method = normalizeStatus(order?.payment_method);
  const paymentStatus = normalizeStatus(order?.payment_status);
  const isCod = method === "cod" || method === "cash_on_delivery" || method === "cash_on_delivery_local";
  if (!isCod && unpaidStatuses.has(paymentStatus)) return false;
  return true;
}

function parseImageList(value, fallback = null) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (value && typeof value === "object") return Object.values(value).filter(Boolean).map(String);
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
    } catch {
      // Keep compatibility with legacy single-path values.
    }
  }
  return fallback ? [fallback] : [];
}

async function ensureNotificationTypes() {
  notificationTypesReady ||= safeModifyColumn("notifications", "type", "type enum update", `ALTER TABLE notifications MODIFY type ${NOTIFICATION_TYPE_ENUM_SQL} NOT NULL`);
  return notificationTypesReady;
}

async function ensureReviewColumns() {
  reviewColumnsReady ||= (async () => {
    const rows = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'reviews'
         AND COLUMN_NAME IN ('customer_id', 'order_id', 'brand_id', 'brand_name', 'product_name', 'order_number', 'amount_paid', 'category', 'image_urls_json')`
    );
    const columns = new Set(rows.map((row) => row.COLUMN_NAME));
    if (!columns.has("customer_id")) {
      await query("ALTER TABLE reviews ADD COLUMN customer_id INT NULL AFTER user_id");
      await query("CREATE INDEX idx_reviews_customer ON reviews(customer_id)").catch(() => {});
    }
    if (!columns.has("order_id")) {
      await query("ALTER TABLE reviews ADD COLUMN order_id INT NULL AFTER user_id");
      await query("CREATE INDEX idx_reviews_order ON reviews(order_id)").catch(() => {});
    }
    if (!columns.has("brand_id")) {
      await query("ALTER TABLE reviews ADD COLUMN brand_id INT NULL AFTER product_id");
    }
    if (!columns.has("brand_name")) {
      await query("ALTER TABLE reviews ADD COLUMN brand_name VARCHAR(120) NULL AFTER brand_id");
    }
    if (!columns.has("product_name")) {
      await query("ALTER TABLE reviews ADD COLUMN product_name VARCHAR(180) NULL AFTER brand_name");
    }
    if (!columns.has("order_number")) {
      await query("ALTER TABLE reviews ADD COLUMN order_number VARCHAR(40) NULL AFTER product_name");
    }
    if (!columns.has("amount_paid")) {
      await query("ALTER TABLE reviews ADD COLUMN amount_paid DECIMAL(10,2) NULL AFTER order_number");
    }
    if (!columns.has("category")) {
      await query("ALTER TABLE reviews ADD COLUMN category VARCHAR(80) NOT NULL DEFAULT 'Overall Experience' AFTER rating");
    }
    if (!columns.has("image_urls_json")) {
      await query("ALTER TABLE reviews ADD COLUMN image_urls_json JSON NULL AFTER image_url");
    }
  })().catch((error) => {
    reviewColumnsReady = undefined;
    throw error;
  });
  return reviewColumnsReady;
}

router.get("/", optionalAuth, asyncHandler(async (req, res) => {
  await ensureReviewColumns();
  const where = !req.user || req.user.role === "admin" ? "" : "WHERE r.user_id = :userId";
 const rows = await query(
`SELECT
    r.id,
    r.user_id,
    r.customer_id,
    r.order_id,
    r.product_id,
    r.brand_id,
    r.brand_name,
    r.product_name,
    r.order_number,
    r.amount_paid,
    r.rating,
    r.category,
    r.comment,
    r.image_url,
    r.image_urls_json,
    r.created_at,

    MAX(u.username) AS username,
    MAX(p.name) AS product_name,
    MAX(o.total_amount) AS total_amount,
    MAX(o.status) AS order_status,

    GROUP_CONCAT(
        DISTINCT op.name
        ORDER BY op.name
        SEPARATOR ', '
    ) AS order_products

FROM reviews r
JOIN users u
    ON u.id = r.user_id
LEFT JOIN products p
    ON p.id = r.product_id
LEFT JOIN orders o
    ON o.id = r.order_id
LEFT JOIN order_items oi
    ON oi.order_id = o.id
LEFT JOIN products op
    ON op.id = oi.product_id

${where}

GROUP BY
    r.id,
    r.user_id,
    r.customer_id,
    r.order_id,
    r.product_id,
    r.brand_id,
    r.brand_name,
    r.product_name,
    r.order_number,
    r.amount_paid,
    r.rating,
    r.category,
    r.comment,
    r.image_url,
    r.image_urls_json,
    r.created_at

ORDER BY r.created_at DESC`,
{
    userId: req.user?.id || null,
}
);
  res.json(rows.map((row) => ({
    ...row,
    images: parseImageList(row.image_urls_json, row.image_url)
  })));
}));

router.post("/", requireAuth, requireApproved, upload.fields([{ name: "images", maxCount: 10 }, { name: "image", maxCount: 1 }]), asyncHandler(async (req, res) => {
  await ensureNotificationTypes();
  await ensureReviewColumns();
  const schema = z.object({
    order_id: z.coerce.number().int().positive(),
    product_id: z.coerce.number().int().optional(),
    rating: z.coerce.number().int().min(1).max(5),
    category: z.string().trim().min(1).max(80),
    custom_category: z.string().trim().max(80).optional(),
    comment: z.string().trim().min(10).max(1000)
  });
  const input = schema.parse(req.body);
  if (!feedbackCategories.includes(input.category)) throw new HttpError(400, "Select a valid feedback category");
  const category = input.category === "Other" ? String(input.custom_category || "").trim() : input.category;
  if (input.category === "Other" && !category) throw new HttpError(400, "Please specify your feedback category");
  if (category.length > 80) throw new HttpError(400, "Feedback category is too long");
  const orders = await query(
    `SELECT o.id, o.status, o.payment_status, o.payment_method, o.total_amount, o.created_at
     FROM orders o
     WHERE o.id = :orderId AND o.user_id = :userId
     LIMIT 1`,
    { orderId: input.order_id, userId: req.user.id }
  );
  if (!orders.length) throw new HttpError(404, "Order not found");
  if (!canLeaveFeedback(orders[0])) throw new HttpError(400, "Feedback is allowed only after this order is delivered");
  const orderItems = await query(
    `SELECT oi.product_id, p.name AS product_name, p.brand AS brand_name
     FROM order_items oi
     LEFT JOIN products p ON p.id = oi.product_id
     WHERE oi.order_id = :orderId
     ORDER BY oi.id ASC`,
    { orderId: input.order_id }
  );
  const selectedProductId = input.product_id || orderItems[0]?.product_id || null;
  if (selectedProductId && !orderItems.some((item) => Number(item.product_id) === Number(selectedProductId))) {
    throw new HttpError(400, "Select an apparel item from this order");
  }
  const selectedItem = orderItems.find((item) => Number(item.product_id) === Number(selectedProductId)) || orderItems[0] || {};
  const orderYear = orders[0].created_at ? new Date(orders[0].created_at).getFullYear() : new Date().getFullYear();
  const orderNumber = `#ORD-${orderYear}-${String(orders[0].id).padStart(5, "0")}`;
  const duplicates = await query(
    "SELECT id FROM reviews WHERE order_id = :orderId AND user_id = :userId AND (product_id = :productId OR product_id IS NULL) LIMIT 1",
    { orderId: input.order_id, userId: req.user.id, productId: selectedProductId }
  );
  if (duplicates.length) throw new HttpError(409, "You already submitted feedback for this order");
  const uploadedFiles = [...(req.files?.images || []), ...(req.files?.image || [])].slice(0, 10);
  const imageUrls = uploadedFiles.map((file) => `/uploads/${file.filename}`);
  await query(
    `INSERT INTO reviews (user_id, customer_id, order_id, product_id, brand_id, brand_name, product_name, order_number, amount_paid, rating, category, comment, image_url, image_urls_json)
     VALUES (:userId, :customerId, :orderId, :productId, :brandId, :brandName, :productName, :orderNumber, :amountPaid, :rating, :category, :comment, :imageUrl, :imageUrlsJson)`,
    {
      userId: req.user.id,
      customerId: req.user.id,
      orderId: input.order_id,
      productId: selectedProductId,
      brandId: null,
      brandName: selectedItem.brand_name || null,
      productName: selectedItem.product_name || null,
      orderNumber,
      amountPaid: orders[0].total_amount,
      rating: input.rating,
      category,
      comment: input.comment,
      imageUrl: imageUrls[0] || null,
      imageUrlsJson: imageUrls.length ? JSON.stringify(imageUrls) : null
    }
  );
  await createAdminNotification({
    type: "feedback",
    title: "New customer feedback",
    body: `${req.user.username} submitted feedback.`,
    customerId: req.user.id,
    app: req.app
  });
  res.status(201).json({ message: "Feedback submitted", images: imageUrls });
}));

export default router;
