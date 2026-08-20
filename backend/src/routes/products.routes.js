import { Router } from "express";
import { z } from "zod";
import { query, transaction } from "../config/db.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { requireApproved, requireAuth, requireRole } from "../middleware/auth.js";
import { productUpload } from "../middleware/upload.js";
import { ensureApparelOptionTables } from "./apparel-options.routes.js";
import { productImageSelect, productImageUrlForRow } from "../utils/productImages.js";
import {
  availableProductWhere,
  ensureProductInventoryColumns,
  inventoryStatusSql,
  normalizeProductMatchValue,
  nonDeletedProductWhere,
  productSkuForId,
  productStatusForStock,
  productWriteTable
} from "../utils/productInventory.js";

const router = Router();
const allowedBrands = ["Adidas", "Nike", "Lacoste", "Essentials", "Uniqlo", "H&M", "Zara", "Bench", "Penshoppe", "Champion", "Puma", "Reebok", "Under Armour", "Jordan", "Levi's", "Ralph Lauren", "Tommy Hilfiger", "GAP", "Old Navy", "Dickies", "Carhartt", "Stussy", "Converse", "Vans", "New Balance", "Gildan", "Hanes", "Fruit of the Loom", "Blue Corner", "Regatta", "Other"];

async function notifyApprovedCustomersAboutNewProduct(app, product) {
  const customers = await query("SELECT id FROM users WHERE role = 'customer' AND status = 'approved'");
  if (!customers.length) return;
  const title = "New Item Available";
  const body = `New arrival: ${product.name || "Apparel item"} is now available.`;
  const values = customers.map((_, index) => `(:userId${index}, 'new_product', :title, :body, :productId)`).join(", ");
  const params = {
    title,
    body,
    productId: product.id,
    ...Object.fromEntries(customers.map((customer, index) => [`userId${index}`, customer.id]))
  };
  await query(
    `INSERT INTO notifications (user_id, type, title, body, product_id)
     VALUES ${values}`,
    params
  );
  customers.forEach((customer) => {
    app.get("io")?.to(`user:${customer.id}`).emit("notification:new", {
      type: "new_product",
      title,
      body,
      product,
      product_id: product.id
    });
  });
}

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
  return String(color || "").trim().replace(/\s+/g, " ") || "Other";
}

function normalizeProductInput(input) {
  const conditionValue = input.condition ?? input.condition_name ?? input.condition_id;
  const stockValue = input.stock ?? input.quantity;
  const activeValue = input.is_active ?? input.active;
  const imageValue = typeof input.image_url === "string" ? input.image_url.trim() : input.image_url;
  return {
    ...input,
    stock: stockValue,
    is_active: activeValue,
    image_url: imageValue || null,
    brand: normalizeBrand(input.brand),
    category: normalizeCategory(input.category),
    gender: String(input.gender || "").trim().replace(/\s+/g, " ") || "Other",
    size: normalizeSize(input.size),
    color: normalizeColor(input.color),
    condition: String(conditionValue || "").trim().replace(/\s+/g, " ") || "Good"
  };
}

const productSchema = z.object({
  name: z.string().trim().min(2, "Apparel name must be at least 2 characters"),
  brand: z.string().trim().min(1).max(120).optional().default("Other"),
  category: z.string().trim().min(1).max(80).optional().default("T-Shirts"),
  gender: z.string().trim().min(1).max(80).optional().default("Other"),
  size: z.string().trim().min(1).max(80).optional().default("Free Size"),
  color: z.string().trim().max(80).optional().default("Other"),
  price: z.coerce.number({ invalid_type_error: "Price must be a valid number" }).positive("Price must be greater than zero"),
  stock: z.coerce.number({ invalid_type_error: "Stock must be a valid number" }).int("Stock must be a whole number").min(0, "Stock cannot be negative"),
  condition: z.string().trim().min(2, "Condition is required").max(120),
  description: z.string().trim().max(1200).optional().default(""),
  image_url: z.string().optional().nullable()
});

function isDuplicateSkuError(error) {
  const message = String(error?.sqlMessage || error?.message || "").toLowerCase();
  return error?.code === "ER_DUP_ENTRY" && message.includes("sku");
}

function productCreateError(error) {
  if (isDuplicateSkuError(error)) {
    return new HttpError(409, "A product with this SKU already exists");
  }
  if (error?.name === "ZodError") return error;
  if (["ER_BAD_NULL_ERROR", "ER_TRUNCATED_WRONG_VALUE", "ER_WARN_DATA_OUT_OF_RANGE", "WARN_DATA_TRUNCATED"].includes(error?.code)) {
    return new HttpError(400, "Invalid product details. Please check the form and try again.");
  }
  return error;
}

function createdProductResponse(row) {
  const productId = Number(row?.id);
  if (!Number.isInteger(productId) || productId <= 0) {
    throw new Error("Product response is missing a valid ID");
  }
  const barcode = row.sku || row.barcode || null;
  const imageUrl = productImageUrlForRow(row);
  return {
    ...row,
    id: productId,
    name: row.name,
    brand: row.brand,
    category: row.category,
    type: row.gender || row.type || null,
    gender: row.gender || row.type || null,
    size: row.size,
    color: row.color,
    price: row.price,
    stock: row.stock,
    condition: row.condition,
    description: row.description,
    imageUrl,
    image_url: imageUrl,
    sku: barcode,
    barcode,
    status: row.computed_status || row.status || productStatusForStock(row.stock)
  };
}

function productListResponse(row) {
  return createdProductResponse(row);
}

function productSelect(tableExpression = "products") {
  const table = tableExpression.includes(".") || tableExpression.startsWith("`") ? tableExpression : `\`${tableExpression}\``;
  return `${table}.id AS id,
    ${table}.sku,
    ${table}.name,
    ${table}.brand,
    ${table}.category,
    ${table}.gender,
    ${table}.size,
    ${table}.color,
    ${table}.price,
    ${table}.stock,
    ${table}.status,
    ${table}.image_url,
    ${productImageSelect(table)},
    ${table}.\`condition\`,
    ${table}.description,
    ${table}.is_active,
    ${table}.is_deleted,
    ${table}.deleted_at,
    ${table}.deleted_by,
    ${table}.sale_enabled,
    ${table}.sale_discount_percent,
    ${table}.sale_product_ids_json,
    ${table}.sale_starts_at,
    ${table}.sale_ends_at,
    ${table}.created_at,
    ${table}.updated_at`;
}

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
    ["conditions", input.condition],
    ["colors", input.color]
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

function parseProductId(value) {
  const productId = Number(value);
  if (!Number.isInteger(productId) || productId <= 0) {
    throw new HttpError(400, "A valid product ID is required");
  }
  return productId;
}

function uploadedProductImage(req) {
  return req.file ? { data: req.file.buffer, mime: req.file.mimetype } : { data: null, mime: null };
}

function logProductUpload(req, imageUrl = null) {
  console.log("[PRODUCT UPLOAD]", {
    id: req.params.id || null,
    hasFile: Boolean(req.file),
    filename: req.file?.originalname || null,
    mimetype: req.file?.mimetype || null,
    resultingImageUrl: imageUrl || null
  });
}

function logProductEditImage(req) {
  console.log("[PRODUCT EDIT IMAGE]", {
    hasFile: Boolean(req.file),
    filename: req.file?.filename || null,
    mimetype: req.file?.mimetype || null,
    contentType: req.headers["content-type"]
  });
}

function logProductImageSaveFailure(error) {
  console.error("[product image save failed]", {
    message: error.message,
    code: error.code,
    sqlMessage: error.sqlMessage,
    stack: error.stack
  });
}

router.get("/", requireAuth, requireApproved, asyncHandler(async (req, res) => {
  const table = await productWriteTable();
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
  clauses.push(isAdmin ? nonDeletedProductWhere() : `${nonDeletedProductWhere()} AND is_active = TRUE`);

  if (isAdmin && filters.stock === "available") clauses.push("stock > 0");
  if (!isAdmin && filters.stock === "available") clauses.push("stock > 0");
  if (filters.stock === "in_stock") clauses.push(isAdmin ? "stock > 5" : "stock > 0");
  if (filters.stock === "low_stock") clauses.push("stock BETWEEN 1 AND 5");
  if (filters.stock === "out_of_stock") clauses.push("stock <= 0");

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
  const products = await query(`SELECT ${productSelect(table)}, ${inventoryStatusSql("stock")} AS computed_status FROM \`${table}\` ${where} ${orderBy}`, params);
  const mapped = products.map(productListResponse);
  res.json(mapped);
}));

router.get("/inventory", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const table = await productWriteTable();
  const products = await query(
    `SELECT ${productSelect(table)}, ${inventoryStatusSql("stock")} AS computed_status
     FROM \`${table}\`
     WHERE ${nonDeletedProductWhere()}
     ORDER BY created_at DESC`
  );
  res.json(products.map(productListResponse));
}));

router.get("/available", requireAuth, requireApproved, asyncHandler(async (req, res) => {
  const table = await productWriteTable();
  const products = await query(
    `SELECT ${productSelect(table)}, ${inventoryStatusSql("stock")} AS computed_status
     FROM \`${table}\`
     WHERE ${availableProductWhere()}
     ORDER BY created_at DESC`
  );
  res.json(products.map(productListResponse));
}));

router.get("/:id/image", asyncHandler(async (req, res) => {
  const table = await productWriteTable();
  const productId = parseProductId(req.params.id);
  const rows = await query(
    `SELECT id, image_data, image_mime
     FROM \`${table}\`
     WHERE id = :id
       AND ${nonDeletedProductWhere()}
     LIMIT 1`,
    { id: productId }
  );
  const product = rows[0];
  if (!product?.image_data) throw new HttpError(404, "Product image not found.");
  res.setHeader("Content-Type", product.image_mime || "image/jpeg");
  res.setHeader("Cache-Control", "public, max-age=3600");
  res.send(product.image_data);
}));

router.get("/archived", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const table = await productWriteTable();
  const products = await query(
    `SELECT ${productSelect(table)}, ${inventoryStatusSql("stock")} AS computed_status
     FROM \`${table}\`
     WHERE is_deleted = TRUE
     ORDER BY deleted_at DESC, updated_at DESC`
  );
  res.json(products.map(productListResponse));
}));

router.get("/barcode/:sku", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  await ensureProductInventoryColumns();
  const [product] = await query(
    `SELECT ${productSelect("products")}, ${inventoryStatusSql("stock")} AS computed_status
     FROM products
     WHERE ${nonDeletedProductWhere()}
       AND LOWER(sku) = LOWER(:sku)
     LIMIT 1`,
    { sku: String(req.params.sku || "").trim() }
  );
  if (!product) throw new HttpError(404, "No product found for this barcode");
  res.json(productListResponse(product));
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

router.post("/", requireAuth, requireRole("admin"), productUpload.single("image"), asyncHandler(async (req, res) => {
  console.log("[POST /api/products] request", {
    bodyFields: Object.keys(req.body || {}),
    hasFile: Boolean(req.file),
    contentType: req.headers["content-type"]
  });
  try {
    const table = await productWriteTable();
    const uploadedImage = uploadedProductImage(req);
    logProductUpload(req, req.file ? "database:image_data" : null);
    const rawInput = normalizeProductInput({ ...req.body, image_url: req.body.image_url || null });
    const input = productSchema.parse(rawInput);
    await ensureProductOptionValues(input);
    const duplicate = await findDuplicateActiveProduct(input);

    if (duplicate) {
      const nextStock = Number(duplicate.stock || 0) + Number(input.stock || 0);
      const nextStatus = productStatusForStock(nextStock);
      await query(
        `UPDATE \`${table}\`
         SET stock = :stock,
             status = :status,
             updated_at = NOW(),
             image_data = CASE WHEN :hasImage = TRUE THEN :imageData ELSE image_data END,
             image_mime = CASE WHEN :hasImage = TRUE THEN :imageMime ELSE image_mime END,
             description = CASE WHEN (description IS NULL OR description = '') AND :description <> '' THEN :description ELSE description END
         WHERE id = :id`,
        {
          id: duplicate.id,
          stock: nextStock,
          status: nextStatus,
          hasImage: Boolean(uploadedImage.data),
          imageData: uploadedImage.data,
          imageMime: uploadedImage.mime,
          description: input.description || ""
        }
      );
      const [merged] = await query(`SELECT ${productSelect("products")}, ${inventoryStatusSql("stock")} AS computed_status FROM products WHERE id = :id LIMIT 1`, { id: duplicate.id });
      const item = createdProductResponse(merged);
      req.app.get("io")?.emit("inventory:update", { type: "inventory", action: "stock", id: duplicate.id, stock: nextStock, status: nextStatus });
      return res.status(200).json({
        success: true,
        merged: true,
        message: "Existing apparel item found. Stock combined successfully.",
        item,
        product: item
      });
    }

    const status = productStatusForStock(input.stock);
    const product = await transaction(async (run) => {
      const result = await run(
        `INSERT INTO \`${table}\` (name, brand, category, gender, size, color, price, stock, status, image_url, image_data, image_mime, \`condition\`, description, is_active, is_deleted, deleted_at, deleted_by)
         VALUES (:name, :brand, :category, :gender, :size, :color, :price, :stock, :status, :image_url, :image_data, :image_mime, :condition, :description, TRUE, FALSE, NULL, NULL)`,
        { ...input, status, image_data: uploadedImage.data, image_mime: uploadedImage.mime }
      );
      const productId = Number(result.insertId);
      if (!Number.isInteger(productId) || productId <= 0) {
        throw new Error("Product insert returned an invalid ID");
      }
      const sku = productSkuForId(productId);
      await run(`UPDATE \`${table}\` SET sku = :sku WHERE id = :id`, { id: productId, sku });
      const [created] = await run(`SELECT ${productSelect(table)}, ${inventoryStatusSql("stock")} AS computed_status FROM \`${table}\` WHERE id = :id LIMIT 1`, { id: productId });
      return createdProductResponse(created);
    });

    notifyApprovedCustomersAboutNewProduct(req.app, product)
      .catch((notificationError) => {
        console.warn("Create apparel notification failed:", {
          message: notificationError.message,
          code: notificationError.code,
          sqlMessage: notificationError.sqlMessage
        });
      });
    req.app.get("io")?.emit("product:new", product);
    return res.status(201).json({
      success: true,
      message: "Apparel item created successfully",
      item: product,
      product
    });
  } catch (error) {
    logProductImageSaveFailure(error);
    console.error("[POST /api/products] failed", {
      message: error.message,
      code: error.code,
      errno: error.errno,
      sqlMessage: error.sqlMessage,
      sqlState: error.sqlState,
      sql: error.sqlText || error.sql,
      stack: error.stack
    });
    throw productCreateError(error);
  }
}));

router.put("/:id", requireAuth, requireRole("admin"), productUpload.single("image"), asyncHandler(async (req, res) => {
  try {
    logProductEditImage(req);
    const table = await productWriteTable();
    const productId = parseProductId(req.params.id);
    const [existingProduct] = await query(
      `SELECT id, image_url FROM \`${table}\` WHERE id = :id AND is_deleted = FALSE LIMIT 1`,
      { id: productId }
    );
    if (!existingProduct) throw new HttpError(404, "Apparel item not found");

    const uploadedImage = uploadedProductImage(req);
    const imageUrl = existingProduct.image_url;
    logProductUpload(req, req.file ? "database:image_data" : imageUrl);
    const input = productSchema.parse(normalizeProductInput({ ...req.body, image_url: imageUrl }));
    await ensureProductOptionValues(input);
    const status = productStatusForStock(input.stock);
    const result = await query(
      `UPDATE \`${table}\` SET name=:name, brand=:brand, category=:category, gender=:gender, size=:size, color=:color, price=:price,
       stock=:stock, status=:status, image_url=:image_url,
       image_data = CASE WHEN :hasImage = TRUE THEN :imageData ELSE image_data END,
       image_mime = CASE WHEN :hasImage = TRUE THEN :imageMime ELSE image_mime END,
       \`condition\`=:condition, description=:description WHERE id=:id AND ${nonDeletedProductWhere()}`,
      { ...input, status, id: productId, hasImage: Boolean(uploadedImage.data), imageData: uploadedImage.data, imageMime: uploadedImage.mime }
    );
    if (!result.affectedRows) throw new HttpError(404, "Apparel item not found");
    const [updated] = await query(`SELECT ${productSelect(table)}, ${inventoryStatusSql("stock")} AS computed_status FROM \`${table}\` WHERE id = :id LIMIT 1`, { id: productId });
    const apparel = productListResponse(updated);
    req.app.get("io")?.emit("inventory:update", { type: "inventory", action: "updated", apparel });
    req.app.get("io")?.emit("product:update", apparel);
    res.json({
      success: true,
      message: "Apparel item updated successfully",
      item: apparel,
      product: apparel
    });
  } catch (error) {
    logProductImageSaveFailure(error);
    throw error;
  }
}));

router.patch("/:id/stock", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const table = await productWriteTable();
  const productId = parseProductId(req.params.id);
  const schema = z.object({
    delta: z.coerce.number().int().optional(),
    stock: z.coerce.number().int().min(0).optional()
  }).refine((value) => value.delta !== undefined || value.stock !== undefined, "delta or stock is required");
  const input = schema.parse(req.body);
  console.log("[stock update]", {
    productId,
    requestedStock: input.stock ?? null,
    delta: input.delta ?? null
  });
  const products = await query("SELECT id, stock FROM products WHERE id = :id AND is_deleted = FALSE", { id: productId });
  if (!products.length) throw new HttpError(404, "Apparel item not found");
  const nextStock = input.stock !== undefined ? input.stock : Math.max(0, Number(products[0].stock) + input.delta);
  const nextStatus = productStatusForStock(nextStock);
  await query(`UPDATE \`${table}\` SET stock = :stock, status = :status, updated_at = NOW() WHERE id = :id`, { id: productId, stock: nextStock, status: nextStatus });
  if (nextStock > 0 && nextStock <= 5) {
    const notificationResult = await query(
      "INSERT INTO notifications (type, title, body, product_id) VALUES ('inventory', 'Low stock alert', :body, :id)",
      { id: productId, body: `Apparel item #${productId} is now at ${nextStock} stock.` }
    );
    console.log("[admin notification created]", {
      id: notificationResult.insertId,
      type: "inventory",
      title: "Low stock alert"
    });
    req.app.get("io")?.to("admin").emit("notification:new", { id: notificationResult.insertId, type: "inventory", title: "Low stock alert", body: `Apparel item #${productId} is now at ${nextStock} stock.`, created_at: new Date().toISOString() });
  }
  if (nextStock === 0) {
    req.app.get("io")?.to("admin").emit("notification:new", { type: "inventory", title: "Out of stock", body: `Apparel item #${productId} is out of stock.` });
  }
  const [updated] = await query(`SELECT ${productSelect(table)}, ${inventoryStatusSql("stock")} AS computed_status FROM \`${table}\` WHERE id = :id LIMIT 1`, { id: productId });
  const product = productListResponse(updated);
  req.app.get("io")?.emit("inventory:update", { type: "inventory", action: "stock", id: productId, stock: nextStock, status: nextStatus, product });
  res.json(product);
}));

router.delete("/:id", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const table = await productWriteTable();
  const productId = parseProductId(req.params.id);
  const existing = await query("SELECT id FROM products WHERE id = :id AND is_deleted = FALSE", { id: productId });
  if (!existing.length) throw new HttpError(404, "Apparel item not found");
  const result = await query(
    `UPDATE \`${table}\`
     SET is_deleted = TRUE,
         deleted_at = NOW(),
         deleted_by = :deletedBy,
         updated_at = NOW()
     WHERE id = :id`,
    { id: productId, deletedBy: req.user.id }
  );
  if (!result.affectedRows) throw new HttpError(404, "Apparel item not found");
  req.app.get("io")?.emit("inventory:update", { type: "inventory", action: "archived", id: productId });
  res.json({ message: "Apparel item archived", isDeleted: true, deletedAt: new Date().toISOString() });
}));

router.patch("/:id/restore", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const table = await productWriteTable();
  const productId = parseProductId(req.params.id);
  const rows = await query("SELECT id, stock FROM products WHERE id = :id LIMIT 1", { id: productId });
  if (!rows.length) throw new HttpError(404, "Apparel item not found");
  const restoredStatus = productStatusForStock(rows[0].stock);
  await query(
    `UPDATE \`${table}\`
     SET is_deleted = FALSE,
         deleted_at = NULL,
         deleted_by = NULL,
         status = :status,
         updated_at = NOW()
     WHERE id = :id`,
    { id: productId, status: restoredStatus }
  );
  req.app.get("io")?.emit("inventory:update", { type: "inventory", action: "restored", id: productId, status: restoredStatus });
  res.json({ message: "Apparel item restored", id: productId, status: restoredStatus });
}));

router.delete("/:id/permanent", requireAuth, requireRole("admin"), asyncHandler(async (req, res) => {
  const table = await productWriteTable();
  const productId = parseProductId(req.params.id);
  const result = await query(`DELETE FROM \`${table}\` WHERE id = :id AND is_deleted = TRUE`, { id: productId });
  if (!result.affectedRows) throw new HttpError(404, "Apparel item not found in trash");
  req.app.get("io")?.emit("inventory:update", { type: "inventory", action: "deleted", id: productId });
  res.json({ message: "Apparel item permanently deleted", id: productId });
}));

export default router;
