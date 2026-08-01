import { Router } from "express";
import { z } from "zod";
import { query } from "../config/db.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { requireApproved, requireAuth } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";

const router = Router();
let notificationTypesReady;
let reviewColumnsReady;

const feedbackCategories = ["Apparel Quality", "Delivery", "Customer Service", "Payment", "Overall Experience"];

async function ensureNotificationTypes() {
  notificationTypesReady ||= query("ALTER TABLE notifications MODIFY type ENUM('approval','customer_registration','order','message','refund','new_product','inventory','system','feedback','broadcast') NOT NULL");
  return notificationTypesReady;
}

async function ensureReviewColumns() {
  reviewColumnsReady ||= (async () => {
    const rows = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'reviews'
         AND COLUMN_NAME IN ('customer_id', 'order_id', 'brand_id', 'brand_name', 'product_name', 'order_number', 'amount_paid', 'category')`
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
  })().catch((error) => {
    reviewColumnsReady = undefined;
    throw error;
  });
  return reviewColumnsReady;
}

router.get("/", requireAuth, asyncHandler(async (req, res) => {
  await ensureReviewColumns();
  const where = req.user.role === "admin" ? "" : "WHERE r.user_id = :userId";
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
    r.created_at

ORDER BY r.created_at DESC`,
{
    userId: req.user.id,
}
);
  res.json(rows);
}));

router.post("/", requireAuth, requireApproved, upload.single("image"), asyncHandler(async (req, res) => {
  await ensureNotificationTypes();
  await ensureReviewColumns();
  const schema = z.object({
    order_id: z.coerce.number().int().positive(),
    product_id: z.coerce.number().int().optional(),
    rating: z.coerce.number().int().min(1).max(5),
    category: z.enum(feedbackCategories),
    comment: z.string().trim().min(10).max(1000)
  });
  const input = schema.parse(req.body);
  const orders = await query(
    `SELECT o.id, o.status, o.total_amount, o.created_at,
       oi.product_id AS first_product_id,
       p.name AS first_product_name,
       p.brand AS first_brand_name
     FROM orders o
     LEFT JOIN order_items oi ON oi.order_id = o.id
     LEFT JOIN products p ON p.id = oi.product_id
     WHERE o.id = :orderId AND o.user_id = :userId
     ORDER BY oi.id ASC
     LIMIT 1`,
    { orderId: input.order_id, userId: req.user.id }
  );
  if (!orders.length) throw new HttpError(404, "Order not found");
  if (orders[0].status !== "completed") throw new HttpError(400, "Feedback is allowed only for received or delivered orders");
  const selectedProductId = orders[0].first_product_id || input.product_id || null;
  const orderYear = orders[0].created_at ? new Date(orders[0].created_at).getFullYear() : new Date().getFullYear();
  const orderNumber = `#ORD-${orderYear}-${String(orders[0].id).padStart(5, "0")}`;
  const duplicates = await query(
    "SELECT id FROM reviews WHERE order_id = :orderId AND user_id = :userId LIMIT 1",
    { orderId: input.order_id, userId: req.user.id }
  );
  if (duplicates.length) throw new HttpError(409, "You already submitted feedback for this order");
  await query(
    `INSERT INTO reviews (user_id, customer_id, order_id, product_id, brand_id, brand_name, product_name, order_number, amount_paid, rating, category, comment, image_url)
     VALUES (:userId, :customerId, :orderId, :productId, :brandId, :brandName, :productName, :orderNumber, :amountPaid, :rating, :category, :comment, :imageUrl)`,
    {
      userId: req.user.id,
      customerId: req.user.id,
      orderId: input.order_id,
      productId: selectedProductId,
      brandId: null,
      brandName: orders[0].first_brand_name || null,
      productName: orders[0].first_product_name || null,
      orderNumber,
      amountPaid: orders[0].total_amount,
      rating: input.rating,
      category: input.category,
      comment: input.comment,
      imageUrl: req.file ? `/uploads/${req.file.filename}` : null
    }
  );
  await query(
    "INSERT INTO notifications (type, title, body) VALUES ('feedback', 'New customer feedback', :body)",
    { body: `${req.user.username} submitted ${input.rating} star ${input.category} feedback.` }
  );
  req.app.get("io").to("admin").emit("notification:new", { type: "feedback", title: "New customer feedback", body: `${req.user.username} submitted ${input.rating} star ${input.category} feedback.` });
  res.status(201).json({ message: "Feedback submitted" });
}));

export default router;
