import { Router } from "express";
import { z } from "zod";
import { query } from "../config/db.js";
import { requireApproved, requireAuth } from "../middleware/auth.js";
import { asyncHandler, HttpError } from "../utils/errors.js";

const router = Router();
let cartTableReady;

export async function ensureCartTable() {
  cartTableReady ||= query(`
    CREATE TABLE IF NOT EXISTS cart_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      product_id INT NOT NULL,
      quantity INT NOT NULL DEFAULT 1,
      selected BOOLEAN NOT NULL DEFAULT TRUE,
      checked_out_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_cart_user_product (user_id, product_id),
      INDEX idx_cart_user_active (user_id, checked_out_at)
    )
  `).catch((error) => {
    cartTableReady = undefined;
    throw error;
  });
  return cartTableReady;
}

async function readCart(userId) {
  await ensureCartTable();
  return query(
    `SELECT
       ci.product_id,
       ci.quantity,
       ci.selected,
       p.name,
       p.brand,
       p.category,
       p.size,
       p.price,
       p.stock,
       p.status,
       p.image_url,
       p.\`condition\`
     FROM cart_items ci
     LEFT JOIN products p ON p.id = ci.product_id AND p.is_deleted = FALSE
     WHERE ci.user_id = :userId
       AND ci.checked_out_at IS NULL
     ORDER BY ci.updated_at DESC, ci.id DESC`,
    { userId }
  );
}

async function getProductForCart(productId) {
  const rows = await query(
    "SELECT id, stock FROM products WHERE id = :productId AND is_deleted = FALSE LIMIT 1",
    { productId }
  );
  if (!rows.length) throw new HttpError(404, "Apparel item not found");
  if (Number(rows[0].stock || 0) <= 0) throw new HttpError(400, "This apparel item is out of stock.");
  return rows[0];
}

router.use(requireAuth, requireApproved);

router.get("/", asyncHandler(async (req, res) => {
  res.json(await readCart(req.user.id));
}));

router.post("/items", asyncHandler(async (req, res) => {
  const schema = z.object({
    product_id: z.coerce.number().int().positive(),
    quantity: z.coerce.number().int().positive().optional().default(1),
    selected: z.boolean().optional().default(true)
  });
  const input = schema.parse(req.body);
  const product = await getProductForCart(input.product_id);
  await ensureCartTable();
  await query(
    `INSERT INTO cart_items (user_id, product_id, quantity, selected)
     VALUES (:userId, :productId, LEAST(:quantity, :stock), :selected)
     ON DUPLICATE KEY UPDATE
       quantity = LEAST(quantity + VALUES(quantity), :stock),
       selected = VALUES(selected),
       checked_out_at = NULL`,
    {
      userId: req.user.id,
      productId: input.product_id,
      quantity: input.quantity,
      stock: Number(product.stock || 1),
      selected: input.selected
    }
  );
  res.status(201).json(await readCart(req.user.id));
}));

router.post("/merge", asyncHandler(async (req, res) => {
  const schema = z.object({
    items: z.array(z.object({
      product_id: z.coerce.number().int().positive(),
      quantity: z.coerce.number().int().positive().optional().default(1),
      selected: z.boolean().optional().default(true)
    })).optional().default([])
  });
  const input = schema.parse(req.body);
  await ensureCartTable();
  for (const item of input.items) {
    const product = await getProductForCart(item.product_id).catch(() => null);
    if (!product) continue;
    await query(
      `INSERT INTO cart_items (user_id, product_id, quantity, selected)
       VALUES (:userId, :productId, LEAST(:quantity, :stock), :selected)
       ON DUPLICATE KEY UPDATE
         quantity = LEAST(quantity + VALUES(quantity), :stock),
         selected = selected OR VALUES(selected),
         checked_out_at = NULL`,
      {
        userId: req.user.id,
        productId: item.product_id,
        quantity: item.quantity,
        stock: Number(product.stock || 1),
        selected: item.selected
      }
    );
  }
  res.json(await readCart(req.user.id));
}));

router.patch("/items/:productId", asyncHandler(async (req, res) => {
  const schema = z.object({
    quantity: z.coerce.number().int().positive().optional(),
    selected: z.boolean().optional()
  });
  const input = schema.parse(req.body);
  const productId = Number(req.params.productId);
  const product = await getProductForCart(productId);
  const updates = [];
  const params = { userId: req.user.id, productId };
  if (input.quantity !== undefined) {
    updates.push("quantity = LEAST(:quantity, :stock)");
    params.quantity = input.quantity;
    params.stock = Number(product.stock || 1);
  }
  if (input.selected !== undefined) {
    updates.push("selected = :selected");
    params.selected = input.selected;
  }
  if (!updates.length) throw new HttpError(400, "No cart changes supplied.");
  await ensureCartTable();
  await query(
    `UPDATE cart_items
     SET ${updates.join(", ")}
     WHERE user_id = :userId
       AND product_id = :productId
       AND checked_out_at IS NULL`,
    params
  );
  res.json(await readCart(req.user.id));
}));

router.patch("/selection", asyncHandler(async (req, res) => {
  const schema = z.object({
    product_ids: z.array(z.coerce.number().int().positive()).optional().default([]),
    selected: z.boolean()
  });
  const input = schema.parse(req.body);
  await ensureCartTable();
  if (input.product_ids.length) {
    const params = Object.fromEntries(input.product_ids.map((id, index) => [`id${index}`, id]));
    const placeholders = input.product_ids.map((_, index) => `:id${index}`).join(", ");
    await query(
      `UPDATE cart_items
       SET selected = :selected
       WHERE user_id = :userId
         AND checked_out_at IS NULL
         AND product_id IN (${placeholders})`,
      { ...params, userId: req.user.id, selected: input.selected }
    );
  } else {
    await query(
      `UPDATE cart_items
       SET selected = :selected
       WHERE user_id = :userId
         AND checked_out_at IS NULL`,
      { userId: req.user.id, selected: input.selected }
    );
  }
  res.json(await readCart(req.user.id));
}));

router.delete("/items/:productId", asyncHandler(async (req, res) => {
  await ensureCartTable();
  await query(
    `DELETE FROM cart_items
     WHERE user_id = :userId
       AND product_id = :productId
       AND checked_out_at IS NULL`,
    { userId: req.user.id, productId: Number(req.params.productId) }
  );
  res.json(await readCart(req.user.id));
}));

export default router;
