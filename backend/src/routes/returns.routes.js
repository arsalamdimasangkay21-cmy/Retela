import { Router } from "express";
import { z } from "zod";
import { query, safeModifyColumn } from "../config/db.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { requireApproved, requireAuth, requireRole } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";

const router = Router();
let returnColumnsReady;
let returnNotificationTypesReady;

const returnReasons = ["Wrong item received", "Damaged apparel", "Damaged product", "Size issue", "Defective item", "Missing item", "Other"];
const refundTypes = ["Replacement", "Refund", "Store Credit"];
const returnStatuses = ["pending", "under_review", "approved", "rejected", "refunded"];

async function ensureReturnColumns() {
  returnColumnsReady ||= (async () => {
    const rows = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'returns'
         AND COLUMN_NAME IN ('customer_id', 'product_id', 'brand_id', 'brand_name', 'product_name', 'order_number', 'amount', 'shipping_fee', 'estimated_refund', 'reason_category', 'refund_type', 'proof_images')`
    );
    const columns = new Set(rows.map((row) => row.COLUMN_NAME));
    await safeModifyColumn("returns", "status", "status enum update", "ALTER TABLE returns MODIFY status ENUM('pending','under_review','approved','rejected','refunded') NOT NULL DEFAULT 'pending'");
    if (!columns.has("customer_id")) {
      await query("ALTER TABLE returns ADD COLUMN customer_id INT NULL AFTER user_id");
      await query("CREATE INDEX idx_returns_customer ON returns(customer_id)").catch(() => {});
    }
    if (!columns.has("product_id")) {
      await query("ALTER TABLE returns ADD COLUMN product_id INT NULL AFTER customer_id");
      await query("CREATE INDEX idx_returns_product ON returns(product_id)").catch(() => {});
    }
    if (!columns.has("brand_id")) {
      await query("ALTER TABLE returns ADD COLUMN brand_id INT NULL AFTER product_id");
    }
    if (!columns.has("brand_name")) {
      await query("ALTER TABLE returns ADD COLUMN brand_name VARCHAR(120) NULL AFTER brand_id");
    }
    if (!columns.has("product_name")) {
      await query("ALTER TABLE returns ADD COLUMN product_name VARCHAR(180) NULL AFTER brand_name");
    }
    if (!columns.has("order_number")) {
      await query("ALTER TABLE returns ADD COLUMN order_number VARCHAR(40) NULL AFTER product_name");
    }
    if (!columns.has("amount")) {
      await query("ALTER TABLE returns ADD COLUMN amount DECIMAL(10,2) NULL AFTER order_number");
    }
    if (!columns.has("reason_category")) {
      await query("ALTER TABLE returns ADD COLUMN reason_category VARCHAR(80) NOT NULL DEFAULT 'Other' AFTER reason");
    }
    if (!columns.has("refund_type")) {
      await query("ALTER TABLE returns ADD COLUMN refund_type VARCHAR(40) NOT NULL DEFAULT 'Refund' AFTER reason_category");
    }
    if (!columns.has("shipping_fee")) {
      await query("ALTER TABLE returns ADD COLUMN shipping_fee DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER refund_type");
    }
    if (!columns.has("estimated_refund")) {
      await query("ALTER TABLE returns ADD COLUMN estimated_refund DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER shipping_fee");
    }
    if (!columns.has("proof_images")) {
      await query("ALTER TABLE returns ADD COLUMN proof_images JSON NULL AFTER image_url");
    }
  })().catch((error) => {
    returnColumnsReady = undefined;
    throw error;
  });
  return returnColumnsReady;
}

async function ensureReturnNotificationTypes() {
  returnNotificationTypesReady ||= safeModifyColumn("notifications", "type", "type enum update", "ALTER TABLE notifications MODIFY type ENUM('approval','customer_registration','order','message','refund','new_product','inventory','system','feedback','broadcast') NOT NULL");
  return returnNotificationTypesReady;
}

router.get("/", requireAuth, asyncHandler(async (req, res) => {
  await ensureReturnColumns();

  const where = req.user.role === "admin"
    ? ""
    : "WHERE r.user_id = :userId";

  const rows = await query(
  `SELECT
      r.id,
      r.order_id,
      r.user_id,
      r.customer_id,
      r.product_id,
      r.brand_id,
      r.brand_name,
      r.product_name,
      r.order_number,
      r.amount,
      r.reason,
      r.reason_category,
      r.refund_type,
      r.shipping_fee,
      r.estimated_refund,
      r.image_url,
      r.proof_images,
      r.status,
      r.admin_note,
      r.decided_at,
      r.created_at,

      MAX(u.username) AS username,
      MAX(o.total_amount) AS total_amount,
      MAX(o.status) AS order_status,

      GROUP_CONCAT(DISTINCT p.name ORDER BY p.name SEPARATOR ', ') AS product_names,

      SUBSTRING_INDEX(
          GROUP_CONCAT(p.image_url ORDER BY oi.id SEPARATOR '||'),
          '||',
          1
      ) AS product_image

   FROM returns r
   JOIN users u ON u.id = r.user_id
   JOIN orders o ON o.id = r.order_id
   LEFT JOIN order_items oi ON oi.order_id = o.id
   LEFT JOIN products p ON p.id = oi.product_id

   ${where}

   GROUP BY
      r.id,
      r.order_id,
      r.user_id,
      r.customer_id,
      r.product_id,
      r.brand_id,
      r.brand_name,
      r.product_name,
      r.order_number,
      r.amount,
      r.reason,
      r.reason_category,
      r.refund_type,
      r.shipping_fee,
      r.estimated_refund,
      r.image_url,
      r.proof_images,
      r.status,
      r.admin_note,
      r.decided_at,
      r.created_at

   ORDER BY r.created_at DESC`,
  {
    userId: req.user.id,
  }
);

  res.json(rows);
}));

router.post("/", requireAuth, requireApproved, upload.array("images", 4), asyncHandler(async (req, res) => {
  await ensureReturnColumns();
  await ensureReturnNotificationTypes();
  const schema = z.object({
    order_id: z.coerce.number().int().positive(),
    reason_category: z.enum(returnReasons),
    refund_type: z.enum(refundTypes),
    shipping_fee: z.coerce.number().min(0).max(10000).optional().default(0),
    description: z.string().trim().min(10).max(1200)
  });
  const input = schema.parse(req.body);
  const orders = await query(
    `SELECT o.id, o.status, o.payment_status, o.total_amount, o.created_at, o.updated_at,
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
  if (orders[0].payment_status === "refunded") throw new HttpError(400, "Order Already Refunded");
  if (orders[0].status !== "completed") throw new HttpError(400, "Order Not Delivered");
  const receivedAt = new Date(orders[0].updated_at);
  if (Date.now() - receivedAt.getTime() > 7 * 24 * 60 * 60 * 1000) {
    throw new HttpError(400, "Return Window Expired");
  }
  const refunded = await query(
    "SELECT id FROM returns WHERE order_id = :orderId AND user_id = :userId AND status = 'refunded' LIMIT 1",
    { orderId: input.order_id, userId: req.user.id }
  );
  if (refunded.length) throw new HttpError(409, "Order Already Refunded");
  const duplicates = await query(
    "SELECT id FROM returns WHERE order_id = :orderId AND user_id = :userId AND status IN ('pending','under_review','approved') LIMIT 1",
    { orderId: input.order_id, userId: req.user.id }
  );
  if (duplicates.length) throw new HttpError(409, "Order Already Returned");

  const imageUrls = (req.files || []).map((file) => `/uploads/${file.filename}`);
  const orderYear = orders[0].created_at ? new Date(orders[0].created_at).getFullYear() : new Date().getFullYear();
  const orderNumber = `#ORD-${orderYear}-${String(orders[0].id).padStart(5, "0")}`;
  const shippingFee = Number(input.shipping_fee || 0);
  const estimatedRefund = Math.max(0, Number(orders[0].total_amount || 0) - shippingFee);
  await query(
    `INSERT INTO returns (order_id, user_id, customer_id, product_id, brand_id, brand_name, product_name, order_number, amount, reason, reason_category, refund_type, shipping_fee, estimated_refund, image_url, proof_images, status)
     VALUES (:orderId, :userId, :customerId, :productId, :brandId, :brandName, :productName, :orderNumber, :amount, :reason, :reasonCategory, :refundType, :shippingFee, :estimatedRefund, :imageUrl, :proofImages, 'pending')`,
    {
      orderId: input.order_id,
      userId: req.user.id,
      customerId: req.user.id,
      productId: orders[0].first_product_id || null,
      brandId: null,
      brandName: orders[0].first_brand_name || null,
      productName: orders[0].first_product_name || null,
      orderNumber,
      amount: orders[0].total_amount,
      reason: input.description,
      reasonCategory: input.reason_category,
      refundType: input.refund_type,
      shippingFee,
      estimatedRefund,
      imageUrl: imageUrls[0] || null,
      proofImages: imageUrls.length ? JSON.stringify(imageUrls) : null
    }
  );
  await query(
    "INSERT INTO notifications (type, title, body) VALUES ('refund', 'New return request', :body)",
    { body: `${req.user.username} requested ${input.refund_type} for Order #${input.order_id}.` }
  );
  req.app.get("io")?.to("admin").emit("notification:new", {
    type: "refund",
    title: "New return request",
    body: `${req.user.username} requested ${input.refund_type} for Order #${input.order_id}.`
  });
  req.app.get("io")?.to("admin").emit("return:new", {
    order_id: input.order_id,
    reason: input.reason_category,
    refund_type: input.refund_type
  });
  res.status(201).json({ message: "Return/refund request submitted" });
}));

router.patch("/:id/decision", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  await ensureReturnColumns();
  const schema = z.object({ status: z.enum(returnStatuses), admin_note: z.string().optional() });
  const input = schema.parse(req.body);
  const rows = await query("SELECT user_id FROM returns WHERE id = :id", { id: req.params.id });
  if (!rows.length) throw new HttpError(404, "Request not found");
  await query("UPDATE returns SET status=:status, admin_note=:admin_note, decided_at=NOW() WHERE id=:id", {
    ...input,
    admin_note: input.admin_note || null,
    id: req.params.id
  });
  await query(
    "INSERT INTO notifications (user_id, type, title, body) VALUES (:userId, 'refund', 'Return request update', :body)",
    { userId: rows[0].user_id, body: `Your return request is now ${input.status.replace("_", " ")}.` }
  );
  req.app.get("io")?.to(`user:${rows[0].user_id}`).emit("return:update", { id: Number(req.params.id), status: input.status });
  res.json({ message: "Return/refund decision saved" });
}));

export default router;
