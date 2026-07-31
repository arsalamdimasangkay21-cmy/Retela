import { Router } from "express";
import { z } from "zod";
import { pool, query } from "../config/db.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { ensureProductInventoryColumns, inventoryStatusSql, nonDeletedProductWhere, productStatusForStock } from "../utils/productInventory.js";
import { loadSystemSettings } from "../utils/systemSettings.js";

const router = Router();
let posSchemaReady;

function makeTransactionNumber() {
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, "").slice(0, 14);
  const suffix = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `POS-${stamp}-${suffix}`;
}

async function ensurePosSchema() {
  posSchemaReady ||= (async () => {
    await ensureProductInventoryColumns();
    await query("ALTER TABLE users MODIFY role ENUM('admin','staff','customer') NOT NULL DEFAULT 'customer'");
    await query("ALTER TABLE orders MODIFY user_id INT NULL");
    await query("ALTER TABLE orders MODIFY payment_method ENUM('cod','cash','gcash','debit','credit','maya') NOT NULL DEFAULT 'cod'");

    const rows = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'orders'
         AND COLUMN_NAME IN ('order_channel', 'cash_received', 'change_amount', 'pos_cashier_id')`
    );
    const columns = new Set(rows.map((row) => row.COLUMN_NAME));
    if (!columns.has("order_channel")) {
      await query("ALTER TABLE orders ADD COLUMN order_channel ENUM('online','pos') NOT NULL DEFAULT 'online' AFTER user_id");
    }
    if (!columns.has("cash_received")) {
      await query("ALTER TABLE orders ADD COLUMN cash_received DECIMAL(10,2) NULL AFTER total_amount");
    }
    if (!columns.has("change_amount")) {
      await query("ALTER TABLE orders ADD COLUMN change_amount DECIMAL(10,2) NULL AFTER cash_received");
    }
    if (!columns.has("pos_cashier_id")) {
      await query("ALTER TABLE orders ADD COLUMN pos_cashier_id INT NULL AFTER change_amount");
    }

    await query(`
      CREATE TABLE IF NOT EXISTS pos_transaction_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        order_id INT NOT NULL,
        transaction_number VARCHAR(160) NOT NULL,
        cashier_id INT NULL,
        payment_method ENUM('cash','gcash') NOT NULL,
        total_amount DECIMAL(10,2) NOT NULL,
        cash_received DECIMAL(10,2) NULL,
        change_amount DECIMAL(10,2) NULL,
        gcash_reference_number VARCHAR(160) NULL,
        payment_received_at DATETIME NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_pos_logs_order (order_id),
        INDEX idx_pos_logs_transaction (transaction_number),
        INDEX idx_pos_logs_payment (payment_method),
        FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
      )
    `);
  })().catch((error) => {
    posSchemaReady = undefined;
    throw error;
  });
  return posSchemaReady;
}

router.use(requireAuth, requireRole("admin", "staff"));

router.get("/settings", asyncHandler(async (req, res) => {
  const { config } = await loadSystemSettings();
  res.json({
    shopName: config.general.shopName,
    gcashNumber: config.payment.gcashNumber,
    gcashQrUrl: config.payment.gcashQrUrl
  });
}));

router.get("/search", asyncHandler(async (req, res) => {
  await ensurePosSchema();
  const input = z.object({
    q: z.string().trim().max(120).optional().default(""),
    limit: z.coerce.number().int().min(1).max(10).optional().default(8)
  }).parse(req.query);
  const search = input.q.trim();
  if (!search) return res.json([]);
  const like = `%${search.toLowerCase()}%`;
  const prefix = `${search.toLowerCase()}%`;
  const rows = await query(
    `SELECT id, sku, name, brand, category, size, price, stock, status, image_url, ${inventoryStatusSql("stock")} AS computed_status
     FROM products
     WHERE ${nonDeletedProductWhere()}
       AND (
         LOWER(name) LIKE :like
         OR LOWER(sku) LIKE :like
         OR LOWER(category) LIKE :like
         OR LOWER(size) LIKE :like
       )
     ORDER BY
       CASE
         WHEN LOWER(sku) = LOWER(:search) THEN 0
         WHEN LOWER(sku) LIKE :prefix THEN 1
         WHEN LOWER(name) LIKE :prefix THEN 2
         WHEN LOWER(category) LIKE :prefix THEN 3
         ELSE 4
       END,
       stock <= 0 ASC,
       name ASC
     LIMIT ${input.limit}`,
    { search, like, prefix }
  );
  res.json(rows.map((product) => ({ ...product, status: product.computed_status || product.status || productStatusForStock(product.stock) })));
}));

router.get("/barcode/:barcode", asyncHandler(async (req, res) => {
  await ensurePosSchema();
  const barcode = String(req.params.barcode || "").trim();
  if (!barcode) throw new HttpError(400, "Barcode is required");
  const [product] = await query(
    `SELECT *, ${inventoryStatusSql("stock")} AS computed_status
     FROM products
     WHERE ${nonDeletedProductWhere()}
       AND LOWER(sku) = LOWER(:barcode)
     LIMIT 1`,
    { barcode }
  );
  if (!product) throw new HttpError(404, "No product found for this barcode");
  res.json({ ...product, status: product.computed_status || product.status || productStatusForStock(product.stock) });
}));

router.post("/checkout", asyncHandler(async (req, res) => {
  await ensurePosSchema();
  const schema = z.object({
    payment_method: z.enum(["cash", "gcash"]),
    cash_received: z.coerce.number().min(0).optional(),
    gcash_reference_number: z.string().trim().max(160).optional().default(""),
    items: z.array(z.object({
      product_id: z.coerce.number().int().positive(),
      quantity: z.coerce.number().int().positive()
    })).min(1)
  });
  const input = schema.parse(req.body);
  const compactItems = Array.from(input.items.reduce((map, item) => {
    map.set(item.product_id, (map.get(item.product_id) || 0) + item.quantity);
    return map;
  }, new Map()), ([product_id, quantity]) => ({ product_id, quantity }));

  const conn = await pool.getConnection();
  const inventoryUpdates = [];
  const outOfStockProducts = [];
  try {
    await conn.beginTransaction();
    const receiptItems = [];
    let total = 0;

    for (const item of compactItems) {
      const [rows] = await conn.execute(
        `SELECT id, sku, name, brand, category, size, image_url, price, stock
         FROM products
         WHERE id = ? AND is_deleted = FALSE
         LIMIT 1
         FOR UPDATE`,
        [item.product_id]
      );
      if (!rows.length) throw new HttpError(404, "Apparel item not found");
      const product = rows[0];
      if (Number(product.stock || 0) < item.quantity) {
        throw new HttpError(400, `${product.name} only has ${product.stock} in stock.`);
      }
      const unitPrice = Number(product.price || 0);
      const lineTotal = unitPrice * item.quantity;
      total += lineTotal;
      receiptItems.push({
        product_id: Number(product.id),
        sku: product.sku,
        name: product.name,
        brand: product.brand,
        category: product.category,
        size: product.size,
        image_url: product.image_url,
        quantity: item.quantity,
        price: unitPrice,
        subtotal: lineTotal
      });
    }

    const cashReceived = input.payment_method === "cash" ? Number(input.cash_received || 0) : null;
    if (input.payment_method === "cash" && cashReceived < total) {
      throw new HttpError(400, "Cash received is less than the total amount.");
    }
    if (input.payment_method === "gcash" && !input.gcash_reference_number) {
      throw new HttpError(400, "GCash reference number is required.");
    }

    const changeAmount = input.payment_method === "cash" ? cashReceived - total : null;
    const paidAt = new Date();
    const transactionNumber = makeTransactionNumber();
    const [orderResult] = await conn.execute(
      `INSERT INTO orders
        (user_id, order_channel, status, payment_method, payment_status, payment_reference, transaction_id, paid_at, payment_provider, fulfillment_method, total_amount, cash_received, change_amount, pos_cashier_id)
       VALUES
        (NULL, 'pos', 'completed', ?, 'paid', ?, ?, NOW(), ?, 'pickup', ?, ?, ?, ?)`,
      [
        input.payment_method,
        input.payment_method === "gcash" ? input.gcash_reference_number : null,
        transactionNumber,
        input.payment_method,
        total,
        cashReceived,
        changeAmount,
        req.user.id
      ]
    );

    for (const item of receiptItems) {
      await conn.execute(
        "INSERT INTO order_items (order_id, product_id, quantity, price) VALUES (?, ?, ?, ?)",
        [orderResult.insertId, item.product_id, item.quantity, item.price]
      );
      await conn.execute(
        "UPDATE products SET stock = stock - ?, status = CASE WHEN stock - ? <= 0 THEN 'Out of Stock' WHEN stock - ? <= 5 THEN 'Low Stock' ELSE 'In Stock' END WHERE id = ?",
        [item.quantity, item.quantity, item.quantity, item.product_id]
      );
      const [updatedProducts] = await conn.execute("SELECT id, name, stock FROM products WHERE id = ?", [item.product_id]);
      const nextStock = Number(updatedProducts[0]?.stock || 0);
      const status = productStatusForStock(nextStock);
      inventoryUpdates.push({ id: item.product_id, name: updatedProducts[0]?.name, stock: nextStock, status });
      if (nextStock === 0) {
        outOfStockProducts.push(updatedProducts[0]?.name || item.name);
        await conn.execute(
          "INSERT INTO notifications (type, title, body, product_id) VALUES ('inventory', 'Out of stock', ?, ?)",
          [`${updatedProducts[0]?.name || item.name} is now out of stock.`, item.product_id]
        );
      }
    }

    await conn.execute(
      `INSERT INTO pos_transaction_logs
        (order_id, transaction_number, cashier_id, payment_method, total_amount, cash_received, change_amount, gcash_reference_number, payment_received_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        orderResult.insertId,
        transactionNumber,
        req.user.id,
        input.payment_method,
        total,
        cashReceived,
        changeAmount,
        input.payment_method === "gcash" ? input.gcash_reference_number : null
      ]
    );
    await conn.execute(
      "INSERT INTO notifications (type, title, body) VALUES ('order', 'POS sale completed', ?)",
      [`${req.user.display_name || req.user.username} completed ${transactionNumber}.`]
    );

    await conn.commit();

    inventoryUpdates.forEach((update) => {
      req.app.get("io")?.emit("inventory:update", { type: "inventory", action: "pos-sale", ...update });
    });
    outOfStockProducts.forEach((name) => {
      req.app.get("io")?.to("admin").emit("notification:new", { type: "inventory", title: "Out of stock", body: `${name} is now out of stock.` });
    });
    req.app.get("io")?.to("admin").emit("order:new", { id: orderResult.insertId, total_amount: total, order_channel: "pos" });
    req.app.get("io")?.emit("pos:transaction", { id: orderResult.insertId, transaction_number: transactionNumber, payment_method: input.payment_method, total_amount: total });

    res.status(201).json({
      order: {
        id: orderResult.insertId,
        transaction_number: transactionNumber,
        date_time: paidAt.toISOString(),
        payment_method: input.payment_method,
        total_amount: total,
        cash_received: cashReceived,
        change_amount: changeAmount,
        gcash_reference_number: input.payment_method === "gcash" ? input.gcash_reference_number : null
      },
      items: receiptItems
    });
  } catch (error) {
    await conn.rollback();
    throw error;
  } finally {
    conn.release();
  }
}));

export default router;
