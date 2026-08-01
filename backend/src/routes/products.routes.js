import { Router } from "express";
import { z } from "zod";
import { query } from "../config/db.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { requireApproved, requireAuth, requireRole } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";
import { ensureApparelOptionTables } from "./apparel-options.routes.js";
import {
  availableProductWhere,
  ensureProductInventoryColumns,
  inventoryStatusSql,
  normalizeProductMatchValue,
  nonDeletedProductWhere,
  productSkuForId,
  productStatusForStock
} from "../utils/productInventory.js";

const router = Router();
const allowedBrands = ["Adidas", "Nike", "Lacoste", "Essentials", "Uniqlo", "H&M", "Zara", "Bench", "Penshoppe", "Champion", "Puma", "Reebok", "Under Armour", "Jordan", "Levi's", "Ralph Lauren", "Tommy Hilfiger", "GAP", "Old Navy", "Dickies", "Carhartt", "Stussy", "Converse", "Vans", "New Balance", "Gildan", "Hanes", "Fruit of the Loom", "Blue Corner", "Regatta", "Other"];
const allowedColors = ["Black", "White", "Gray", "Red", "Blue", "Green", "Yellow", "Brown", "Pink", "Purple", "Orange", "Other"];

function normalizeCategory(category) {
  const value = String(category || "").trim().replace(/\s+/g, " ");
  return value || "T-Shirts";
}

function normalizeBrand(brand) {
  const value = String(brand || "").trim().replace(/\s+/g, " ");
  return value || "Other";
}

function normalizeSize(size) {
  const value = String(size || "").trim().replace(/\s+/g, " ");
  return value || "Free Size";
}

function normalizeColor(color) {
  const value = String(color || "").trim();
  if (!value) return "Other";
  const match = allowedColors.find((item) => item.toLowerCase() === value.toLowerCase());
  return match || "Other";
}

function normalizeProductInput(input) {
  return {
    ...input,
    brand: normalizeBrand(input.brand),
    category: normalizeCategory(input.category),
    gender: String(input.gender || "").trim().replace(/\s+/g, " ") || "Other",
    size: normalizeSize(input.size),
    color: normalizeColor(input.color),
    condition: String(input.condition || "").trim().replace(/\s+/g, " ") || "Good"
  };
}

const productSchema = z.object({
  name: z.string().min(2),
  brand: z.string().trim().min(1).max(120).optional().default("Other"),
  category: z.string().trim().min(1).max(80).optional().default("T-Shirts"),
  gender: z.string().trim().min(1).max(80).optional().default("Other"),
  size: z.string().trim().min(1).max(80).optional().default("Free Size"),
  color: z.string().trim().max(80).optional().default("Other"),
  price: z.coerce.number().positive(),
  stock: z.coerce.number().int().min(0),
  condition: z.string().trim().min(2).max(120),
  description: z.string().trim().max(1200).optional().default(""),
  image_url: z.string().optional().nullable()
});

function duplicateSignature(product) {
  return [
    normalizeProductMatchValue(product.name),
    normalizeProductMatchValue(product.brand),
    normalizeProductMatchValue(product.category),
    normalizeProductMatchValue(product.size),
    normalizeProductMatchValue(product.condition),
    Number(product.price || 0).toFixed(2)
  ].join("::");
}

async function findDuplicateActiveProduct(input) {
  const candidates = await query(
    `SELECT id, sku, name, brand, category, size, \`condition\`, price, stock, image_url, description
     FROM products
     WHERE ${nonDeletedProductWhere()}
       AND price = :price`,
    { price: input.price }
  );
  const inputSignature = duplicateSignature(input);
  return candidates.find((product) => duplicateSignature(product) === inputSignature) || null;
}

async function ensureProductOptionValues(input) {
  await ensureApparelOptionTables();
  const optionValues = [
    ["brands", input.brand],
    ["categories", input.category],
    ["types", input.gender],
    ["sizes", input.size],
    ["conditions", input.condition]
  ];
  for (const [table, rawName] of optionValues) {
    const name = String(rawName || "").trim();
    if (!name) continue;
    await query(
      `INSERT INTO \`${table}\` (name)
       SELECT :name
       WHERE NOT EXISTS (
         SELECT 1 FROM \`${table}\` WHERE LOWER(name) = LOWER(:name)
       )`,
      { name }
    );
  }
}

router.get("/", requireAuth, requireApproved, asyncHandler(async (req, res) => {
  await ensureProductInventoryColumns();
  const schema = z.object({
    search: z.string().trim().optional().default(""),
    brand: z.string().trim().optional().default(""),
    category: z.string().trim().optional().default(""),
    size: z.string().trim().optional().default(""),
    minPrice: z.coerce.number().optional(),
    maxPrice: z.coerce.number().optional(),
    view: z.enum(["product", "inventory"]).optional().default("product"),
    sortBy: z.enum(["latest", "lowest_price", "highest_price", "name_asc"]).optional().default("latest"),
    stock: z.enum(["available", "in_stock", "low_stock", "out_of_stock", "all"]).optional().default("all")
  });
  const filters = schema.parse(req.query);
  const clauses = [];
  const params = {};

  const isAdmin = req.user.role === "admin";
  clauses.push(isAdmin ? nonDeletedProductWhere() : availableProductWhere());

  if (isAdmin && filters.stock === "available") clauses.push("stock > 0");
  if (filters.stock === "in_stock") clauses.push("stock > 5");
  if (filters.stock === "low_stock") clauses.push("stock BETWEEN 1 AND 5");
  if (isAdmin && filters.stock === "out_of_stock") clauses.push("stock <= 0");

  if (filters.search) {
    clauses.push("(LOWER(name) LIKE :search OR LOWER(sku) LIKE :search OR LOWER(brand) LIKE :search OR LOWER(category) LIKE :search OR LOWER(size) LIKE :search OR LOWER(color) LIKE :search OR LOWER(description) LIKE :search)");
    params.search = `%${filters.search.toLowerCase()}%`;
  }
  if (filters.brand && filters.brand !== "all") {
    clauses.push("brand = :brand");
    params.brand = filters.brand;
  }
  if (filters.category && filters.category !== "all") {
    clauses.push("category = :category");
    params.category = filters.category;
  }
  if (filters.size && filters.size !== "all") {
    clauses.push("size = :size");
    params.size = filters.size;
  }
  if (filters.minPrice !== undefined && !Number.isNaN(Number(filters.minPrice))) {
    clauses.push("price >= :minPrice");
    params.minPrice = Number(filters.minPrice);
  }
  if (filters.maxPrice !== undefined && !Number.isNaN(Number(filters.maxPrice))) {
    clauses.push("price <= :maxPrice");
    params.maxPrice = Number(filters.maxPrice);
  }

  const orderBy = filters.sortBy === "lowest_price"
    ? "ORDER BY price ASC, created_at DESC"
    : filters.sortBy === "highest_price"
      ? "ORDER BY price DESC, created_at DESC"
      : filters.sortBy === "name_asc"
        ? "ORDER BY name ASC, created_at DESC"
      : "ORDER BY created_at DESC";
  const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
  const products = await query(`SELECT *, ${inventoryStatusSql("stock")} AS computed_status FROM products ${where} ${orderBy}`, params);
  const mapped = products.map((product) => ({ ...product, status: product.computed_status || product.status || productStatusForStock(product.stock) }));
  res.json(mapped);
}));

router.get("/inventory", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  await ensureProductInventoryColumns();
  const products = await query(
    `SELECT *, ${inventoryStatusSql("stock")} AS computed_status
     FROM products
     WHERE ${nonDeletedProductWhere()}
     ORDER BY created_at DESC`
  );
  res.json(products.map((product) => ({ ...product, status: product.computed_status || product.status || productStatusForStock(product.stock) })));
}));

router.get("/available", requireAuth, requireApproved, asyncHandler(async (req, res) => {
  await ensureProductInventoryColumns();
  const products = await query(
    `SELECT *, ${inventoryStatusSql("stock")} AS computed_status
     FROM products
     WHERE ${availableProductWhere()}
     ORDER BY created_at DESC`
  );
  res.json(products.map((product) => ({ ...product, status: product.computed_status || product.status || productStatusForStock(product.stock) })));
}));

router.get("/archived", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  await ensureProductInventoryColumns();
  const products = await query(
    `SELECT *, ${inventoryStatusSql("stock")} AS computed_status
     FROM products
     WHERE is_deleted = TRUE
     ORDER BY deleted_at DESC, updated_at DESC`
  );
  res.json(products.map((product) => ({ ...product, status: product.computed_status || product.status || productStatusForStock(product.stock) })));
}));

router.get("/barcode/:sku", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  await ensureProductInventoryColumns();
  const [product] = await query(
    `SELECT *, ${inventoryStatusSql("stock")} AS computed_status
     FROM products
     WHERE ${nonDeletedProductWhere()}
       AND LOWER(sku) = LOWER(:sku)
     LIMIT 1`,
    { sku: String(req.params.sku || "").trim() }
  );
  if (!product) throw new HttpError(404, "No product found for this barcode");
  res.json({ ...product, status: product.computed_status || product.status || productStatusForStock(product.stock) });
}));

router.get("/filters", requireAuth, requireApproved, asyncHandler(async (req, res) => {
  await ensureProductInventoryColumns();
  await ensureApparelOptionTables();
  const baseWhere = req.user.role === "admin" ? nonDeletedProductWhere() : availableProductWhere();
  const [brands, productBrands, categories, sizes] = await Promise.all([
    query("SELECT name FROM brands ORDER BY name ASC"),
    query(`SELECT DISTINCT brand FROM products WHERE ${baseWhere} AND brand IS NOT NULL AND brand <> '' ORDER BY brand ASC`),
    query(`SELECT DISTINCT category FROM products WHERE ${baseWhere} AND category IS NOT NULL AND category <> '' ORDER BY category ASC`),
    query(`SELECT DISTINCT size FROM products WHERE ${baseWhere} AND size IS NOT NULL AND size <> '' ORDER BY size ASC`)
  ]);
  res.json({
    brands: [...allowedBrands, ...brands.map((row) => row.name), ...productBrands.map((row) => normalizeBrand(row.brand))]
      .filter((value, index, array) => value && array.findIndex((item) => item.toLowerCase() === value.toLowerCase()) === index),
    categories: categories.map((row) => normalizeCategory(row.category)).filter((value, index, array) => value && array.indexOf(value) === index),
    sizes: sizes.map((row) => normalizeSize(row.size)).filter((value, index, array) => value && array.indexOf(value) === index)
  });
}));

router.post("/", requireAuth, requireRole("admin"), upload.single("image"), asyncHandler(async (req, res) => {
  await ensureProductInventoryColumns();
  const input = normalizeProductInput(productSchema.parse({ ...req.body, image_url: req.file ? `/uploads/${req.file.filename}` : req.body.image_url }));
  await ensureProductOptionValues(input);
  const duplicate = await findDuplicateActiveProduct(input);

  if (duplicate) {
    const nextStock = Number(duplicate.stock || 0) + Number(input.stock || 0);
    const nextStatus = productStatusForStock(nextStock);
    await query(
      `UPDATE products
       SET stock = :stock,
           status = :status,
           updated_at = NOW(),
           image_url = CASE WHEN (image_url IS NULL OR image_url = '') AND :imageUrl <> '' THEN :imageUrl ELSE image_url END,
           description = CASE WHEN (description IS NULL OR description = '') AND :description <> '' THEN :description ELSE description END
       WHERE id = :id`,
      {
        id: duplicate.id,
        stock: nextStock,
        status: nextStatus,
        imageUrl: input.image_url || "",
        description: input.description || ""
      }
    );
    const [merged] = await query(`SELECT *, ${inventoryStatusSql("stock")} AS computed_status FROM products WHERE id = :id LIMIT 1`, { id: duplicate.id });
    req.app.get("io")?.emit("inventory:update", { type: "inventory", action: "stock", id: duplicate.id, stock: nextStock, status: nextStatus });
    return res.status(200).json({
      id: duplicate.id,
      merged: true,
      message: "Existing apparel item found. Stock combined successfully.",
      product: { ...merged, status: merged.computed_status || merged.status || productStatusForStock(merged.stock) }
    });
  }

  const status = productStatusForStock(input.stock);
  const result = await query(
    `INSERT INTO products (name, brand, category, gender, size, color, price, stock, status, image_url, \`condition\`, description, is_active, is_deleted, deleted_at, deleted_by)
     VALUES (:name, :brand, :category, :gender, :size, :color, :price, :stock, :status, :image_url, :condition, :description, TRUE, FALSE, NULL, NULL)`,
    { ...input, status }
  );
  const sku = productSkuForId(result.insertId);
  await query("UPDATE products SET sku = :sku WHERE id = :id", { id: result.insertId, sku });
  const [created] = await query(`SELECT *, ${inventoryStatusSql("stock")} AS computed_status FROM products WHERE id = :id LIMIT 1`, { id: result.insertId });
  const product = { ...created, status: created.computed_status || created.status || productStatusForStock(created.stock) };
  await query("INSERT INTO notifications (type, title, body, product_id) VALUES ('new_product', 'New apparel posted!', 'View now...', :id)", { id: product.id });
  req.app.get("io").emit("product:new", product);
  req.app.get("io").emit("notification:new", { type: "new_product", title: "New apparel posted!", body: "View now...", product });
  res.status(201).json(product);
}));

router.put("/:id", requireAuth, requireRole("admin"), upload.single("image"), asyncHandler(async (req, res) => {
  await ensureProductInventoryColumns();
  const input = normalizeProductInput(productSchema.parse({ ...req.body, image_url: req.file ? `/uploads/${req.file.filename}` : req.body.image_url }));
  await ensureProductOptionValues(input);
  const status = productStatusForStock(input.stock);
  await query(
    `UPDATE products SET name=:name, brand=:brand, category=:category, gender=:gender, size=:size, color=:color, price=:price,
     stock=:stock, status=:status, image_url=:image_url, \`condition\`=:condition, description=:description WHERE id=:id AND ${nonDeletedProductWhere()}`,
    { ...input, status, id: req.params.id }
  );
  const apparel = { id: Number(req.params.id), ...input, status };
  req.app.get("io")?.emit("inventory:update", { type: "inventory", action: "updated", apparel });
  req.app.get("io")?.emit("product:update", apparel);
  res.json(apparel);
}));

router.patch("/:id/stock", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  await ensureProductInventoryColumns();
  const schema = z.object({
    delta: z.coerce.number().int().optional(),
    stock: z.coerce.number().int().min(0).optional()
  }).refine((value) => value.delta !== undefined || value.stock !== undefined, "delta or stock is required");
  const input = schema.parse(req.body);
  const products = await query("SELECT id, stock FROM products WHERE id = :id AND is_deleted = FALSE", { id: req.params.id });
  if (!products.length) throw new HttpError(404, "Apparel item not found");
  const nextStock = input.stock !== undefined ? input.stock : Math.max(0, Number(products[0].stock) + input.delta);
  const nextStatus = productStatusForStock(nextStock);
  await query("UPDATE products SET stock = :stock, status = :status, updated_at = NOW() WHERE id = :id", { id: req.params.id, stock: nextStock, status: nextStatus });
  if (nextStock > 0 && nextStock <= 5) {
    await query(
      "INSERT INTO notifications (type, title, body, product_id) VALUES ('inventory', 'Low stock alert', :body, :id)",
      { id: req.params.id, body: `Apparel item #${req.params.id} is now at ${nextStock} stock.` }
    );
  }
  if (nextStock === 0) {
    req.app.get("io")?.to("admin").emit("notification:new", { type: "inventory", title: "Out of stock", body: `Apparel item #${req.params.id} is out of stock.` });
  }
  req.app.get("io")?.emit("inventory:update", { type: "inventory", action: "stock", id: Number(req.params.id), stock: nextStock, status: nextStatus });
  res.json({ id: Number(req.params.id), stock: nextStock, status: nextStatus });
}));

router.delete("/:id", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  await ensureProductInventoryColumns();
  const existing = await query("SELECT id FROM products WHERE id = :id AND is_deleted = FALSE", { id: req.params.id });
  if (!existing.length) throw new HttpError(404, "Apparel item not found");
  await query(
    `UPDATE products
     SET is_deleted = TRUE,
         deleted_at = NOW(),
         deleted_by = :deletedBy,
         updated_at = NOW()
     WHERE id = :id`,
    { id: req.params.id, deletedBy: req.user.id }
  );
  req.app.get("io")?.emit("inventory:update", { type: "inventory", action: "archived", id: Number(req.params.id) });
  res.json({ message: "Apparel item archived", isDeleted: true, deletedAt: new Date().toISOString() });
}));

router.patch("/:id/restore", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  await ensureProductInventoryColumns();
  const rows = await query("SELECT id, stock FROM products WHERE id = :id LIMIT 1", { id: req.params.id });
  if (!rows.length) throw new HttpError(404, "Apparel item not found");
  const restoredStatus = productStatusForStock(rows[0].stock);
  await query(
    `UPDATE products
     SET is_deleted = FALSE,
         deleted_at = NULL,
         deleted_by = NULL,
         status = :status,
         updated_at = NOW()
     WHERE id = :id`,
    { id: req.params.id, status: restoredStatus }
  );
  req.app.get("io")?.emit("inventory:update", { type: "inventory", action: "restored", id: Number(req.params.id), status: restoredStatus });
  res.json({ message: "Apparel item restored", id: Number(req.params.id), status: restoredStatus });
}));

router.delete("/:id/permanent", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  await ensureProductInventoryColumns();
  const result = await query("DELETE FROM products WHERE id = :id AND is_deleted = TRUE", { id: req.params.id });
  if (!result.affectedRows) throw new HttpError(404, "Apparel item not found in trash");
  req.app.get("io")?.emit("inventory:update", { type: "inventory", action: "deleted", id: Number(req.params.id) });
  res.json({ message: "Apparel item permanently deleted", id: Number(req.params.id) });
}));

export default router;
