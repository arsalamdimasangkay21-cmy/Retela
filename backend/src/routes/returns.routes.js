import { Router } from "express";
import { z } from "zod";
import { query, safeModifyColumn, transaction } from "../config/db.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { requireApproved, requireAuth, requireRole } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";
import { productImageExpression } from "../utils/productImages.js";
import { createAdminNotification, NOTIFICATION_TYPE_ENUM_SQL } from "../utils/adminNotifications.js";
import { productStatusForStock } from "../utils/productInventory.js";
import { loadSystemSettings } from "../utils/systemSettings.js";

const router = Router();
let returnColumnsReady;
let returnNotificationTypesReady;

const returnReasons = ["Wrong item received", "Damaged apparel", "Damaged product", "Size issue", "Defective item", "Missing item", "Other"];
const refundTypes = ["Replacement", "Refund", "Store Credit"];
const returnStatuses = ["pending", "under_review", "approved", "rejected", "refunded"];

async function configuredLowStockThreshold() {
  const { config } = await loadSystemSettings();
  const threshold = Number(config?.inventory?.lowStockThreshold);
  return Number.isFinite(threshold) && threshold >= 0 ? threshold : 3;
}

function parseImageList(value, fallback = null) {
  if (Array.isArray(value)) return value.filter(Boolean).map(String);
  if (value && typeof value === "object") return Object.values(value).filter(Boolean).map(String);
  if (typeof value === "string" && value.trim()) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed.filter(Boolean).map(String);
    } catch {
      // Legacy rows may contain a single path rather than JSON.
    }
  }
  return fallback ? [fallback] : [];
}

function returnCreationErrorMessage(error) {
  if (error?.name === "ZodError") return error.issues?.[0]?.message || "Invalid return request.";
  return error?.sqlMessage || error?.message || "Unknown return creation error";
}

function returnCreationErrorStatus(error) {
  if (error?.name === "ZodError") return 400;
  if (error instanceof HttpError || error?.status || error?.statusCode) return error.status || error.statusCode;
  if (error?.name === "MulterError" || error?.message?.includes("Only jpg")) return 400;
  return 500;
}

function logReturnCreationError(error, req, context = {}) {
  console.error("[returns:create] Return creation failed", {
    route: req.originalUrl,
    method: req.method,
    userId: req.user?.id || null,
    role: req.user?.role || null,
    code: error?.code || null,
    errno: error?.errno || null,
    sqlState: error?.sqlState || null,
    sqlMessage: error?.sqlMessage || null,
    message: error?.message || null,
    issues: error?.issues || null,
    ...context
  });
}

function sendReturnCreationError(res, error) {
  res.status(returnCreationErrorStatus(error)).json({
    success: false,
    message: "Return creation failed",
    error: returnCreationErrorMessage(error)
  });
}

function handleReturnImagesUpload(req, res, next) {
  upload.array("images", 10)(req, res, (error) => {
    if (!error) return next();
    logReturnCreationError(error, req, { phase: "upload" });
    return sendReturnCreationError(res, error);
  });
}

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
  returnNotificationTypesReady ||= safeModifyColumn("notifications", "type", "type enum update", `ALTER TABLE notifications MODIFY type ${NOTIFICATION_TYPE_ENUM_SQL} NOT NULL`);
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
          GROUP_CONCAT(${productImageExpression("p")} ORDER BY oi.id SEPARATOR '||'),
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

  res.json(rows.map((row) => ({
    ...row,
    images: parseImageList(row.proof_images, row.image_url)
  })));
}));

router.post("/", requireAuth, requireApproved, handleReturnImagesUpload, async (req, res) => {
  try {
    if (!req.user?.id) throw new HttpError(401, "Authenticated user is required.");
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
    console.info("[returns:create] request received", {
      userId: req.user.id,
      orderId: input.order_id,
      returnReason: input.reason_category,
      refundType: input.refund_type,
      imageCount: (req.files || []).length,
      fields: Object.keys(req.body || {})
    });
    const orders = await query(
      `SELECT o.id, o.user_id, o.status, o.payment_status, o.total_amount, o.created_at, o.updated_at,
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
    if (!orders.length) throw new HttpError(404, "Order not found or does not belong to this customer.");
    if (Number(orders[0].user_id) !== Number(req.user.id)) throw new HttpError(403, "Order does not belong to this customer.");
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

    const imageUrls = (req.files || []).slice(0, 10).map((file) => `/uploads/${file.filename}`);
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
    await createAdminNotification({
      type: "return",
      title: "New return request",
      body: `${req.user.username} requested ${input.refund_type} for Order #${input.order_id}.`,
      customerId: req.user.id,
      app: req.app
    });
    req.app.get("io")?.to("admin").emit("return:new", {
      order_id: input.order_id,
      reason: input.reason_category,
      refund_type: input.refund_type
    });
    res.status(201).json({ success: true, message: "Return/refund request submitted" });
  } catch (error) {
    logReturnCreationError(error, req, { phase: "create" });
    sendReturnCreationError(res, error);
  }
});

router.patch("/:id/decision", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  await ensureReturnColumns();
  const schema = z.object({ status: z.enum(returnStatuses), admin_note: z.string().trim().max(1000).optional().default("") });
  const input = schema.parse(req.body);
  if (input.status === "rejected" && !input.admin_note) {
    throw new HttpError(400, "Admin note is required when rejecting a return/refund request.");
  }
  const lowStockThreshold = await configuredLowStockThreshold();
  const result = await transaction(async (run) => {
    const rows = await run(
      "SELECT id, user_id, order_id, product_id, status FROM returns WHERE id = :id FOR UPDATE",
      { id: req.params.id }
    );
    if (!rows.length) throw new HttpError(404, "Request not found");
    const existing = rows[0];
    const shouldRestock = input.status === "approved" && !["approved", "refunded"].includes(String(existing.status || "").toLowerCase());
    await run("UPDATE returns SET status=:status, admin_note=:admin_note, decided_at=NOW() WHERE id=:id", {
      ...input,
      admin_note: input.admin_note || null,
      id: req.params.id
    });
    if (input.status === "refunded") {
      await run("UPDATE orders SET payment_status = 'refunded' WHERE id = :orderId", { orderId: existing.order_id });
    }

    const inventoryUpdates = [];
    if (shouldRestock) {
      const productFilter = existing.product_id ? "AND oi.product_id = :productId" : "";
      const returnedItems = await run(
        `SELECT oi.product_id, SUM(oi.quantity) AS quantity
         FROM order_items oi
         WHERE oi.order_id = :orderId ${productFilter}
         GROUP BY oi.product_id`,
        { orderId: existing.order_id, productId: existing.product_id }
      );
      for (const item of returnedItems) {
        const quantity = Number(item.quantity || 0);
        if (quantity <= 0) continue;
        const products = await run(
          "SELECT id, name, stock FROM products WHERE id = :productId AND is_deleted = FALSE FOR UPDATE",
          { productId: item.product_id }
        );
        if (!products.length) continue;
        const nextStock = Number(products[0].stock || 0) + quantity;
        const nextStatus = productStatusForStock(nextStock, lowStockThreshold);
        await run(
          "UPDATE products SET stock = :stock, status = :status, updated_at = NOW() WHERE id = :productId",
          { productId: item.product_id, stock: nextStock, status: nextStatus }
        );
        inventoryUpdates.push({
          id: Number(item.product_id),
          name: products[0].name,
          stock: nextStock,
          status: nextStatus
        });
      }
    }
    return { userId: existing.user_id, orderId: existing.order_id, inventoryUpdates };
  });
  const statusText = input.status.replace("_", " ");
  const noteSuffix = input.admin_note ? ` Note: ${input.admin_note}` : "";
  await query(
    "INSERT INTO notifications (user_id, type, title, body) VALUES (:userId, 'refund', 'Return request update', :body)",
    { userId: result.userId, body: `Your return request for Order #${result.orderId} is now ${statusText}.${noteSuffix}` }
  );
  result.inventoryUpdates.forEach((update) => {
    req.app.get("io")?.emit("inventory:update", { type: "inventory", action: "return-restocked", ...update });
  });
  const returnPayload = { id: Number(req.params.id), order_id: Number(result.orderId), status: input.status, admin_note: input.admin_note || null };
  req.app.get("io")?.to(`user:${result.userId}`).emit("return:update", returnPayload);
  req.app.get("io")?.to("admin").emit("return:update", returnPayload);
  if (input.status === "refunded") {
    const orderPayload = { id: Number(result.orderId), payment_status: "refunded" };
    req.app.get("io")?.to(`user:${result.userId}`).emit("order:update", orderPayload);
    req.app.get("io")?.to("admin").emit("order:update", orderPayload);
  }
  res.json({ message: "Return/refund decision saved", return: returnPayload });
}));

export default router;
