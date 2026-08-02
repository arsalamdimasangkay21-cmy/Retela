import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { Router } from "express";
import { z } from "zod";
import { query } from "../config/db.js";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { upload } from "../middleware/upload.js";
import { asyncHandler, HttpError } from "../utils/errors.js";
import { ensureProductInventoryColumns } from "../utils/productInventory.js";
import {
  DEFAULT_SYSTEM_SETTINGS,
  loadSystemSettings,
  normalizeSystemSettings,
  resetSystemSettings,
  sanitizeSystemSettings,
  saveSystemSettings
} from "../utils/systemSettings.js";
import { getAIProviderStatus } from "../utils/aiProvider.js";
import { calculateCheckoutPricing, getPromotionSummary } from "../utils/promotions.js";
import { getActiveShippingSettings, saveActiveShippingSettings, shippingSummary } from "../utils/shippingSettings.js";

const router = Router();
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const backendRoot = path.join(__dirname, "../..");
const uploadsDir = path.join(backendRoot, "uploads");
const defaultShippingFallback = {
  type: "fixed",
  name: "Standard Shipping",
  enabled: true,
  fee: 0
};

function normalizeShippingFallbackFromConfig(config) {
  const enabled = config.payment.shippingFeeType !== "free";
  return {
    type: enabled ? "fixed" : "free",
    name: config.payment.shippingRateName || "Standard Shipping",
    enabled,
    fee: enabled ? Number(config.payment.shippingFee || 0) : 0
  };
}

async function safeShippingSummary(config = null) {
  try {
    return await shippingSummary();
  } catch (error) {
    console.warn("[settings] Shipping summary unavailable; using settings fallback", {
      code: error.code || null,
      message: error.message
    });
    return config ? normalizeShippingFallbackFromConfig(config) : defaultShippingFallback;
  }
}

async function safeActiveShippingSettings(config = null) {
  try {
    return await getActiveShippingSettings();
  } catch (error) {
    console.warn("[settings] Active shipping settings unavailable; using settings fallback", {
      code: error.code || null,
      message: error.message
    });
    const fallback = config ? normalizeShippingFallbackFromConfig(config) : defaultShippingFallback;
    return {
      id: null,
      rateName: fallback.name,
      fixedFee: fallback.fee,
      enabled: fallback.enabled,
      active: true,
      updatedAt: null
    };
  }
}

async function safeCount(sql, field) {
  try {
    const [row] = await query(sql);
    return Number(row?.[field] || 0);
  } catch (error) {
    console.warn("[settings] Count query failed; returning 0", {
      field,
      code: error.code || null,
      message: error.message
    });
    return 0;
  }
}

router.get("/public", asyncHandler(async (req, res) => {
  const { config } = await loadSystemSettings();
  const shipping = await safeShippingSummary(config);
  const [totalCustomers, totalProducts, ordersCompleted] = await Promise.all([
    safeCount("SELECT COUNT(*) AS total_customers FROM users WHERE role = 'customer' AND status = 'approved'", "total_customers"),
    safeCount("SELECT COUNT(*) AS total_products FROM products", "total_products"),
    safeCount("SELECT COUNT(*) AS orders_completed FROM orders WHERE status = 'completed'", "orders_completed")
  ]);
  res.json({
    general: config.general,
    appearance: config.appearance,
    about: config.about,
    payment: {
      gcashNumber: config.payment.gcashNumber,
      codEnabled: config.payment.codEnabled,
      onlinePaymentEnabled: config.payment.onlinePaymentEnabled,
      shippingFeeType: shipping.type,
      shippingRateName: shipping.name,
      shippingFeeEnabled: shipping.enabled,
      shippingFee: Number(shipping.fee || 0)
    },
    stats: {
      totalCustomers,
      totalProducts,
      ordersCompleted
    }
  });
}));

router.get("/promotions", requireAuth, asyncHandler(async (req, res) => {
  res.json(await getPromotionSummary());
}));

router.post("/coupons/validate", requireAuth, asyncHandler(async (req, res) => {
  const schema = z.object({
    couponCode: z.string().trim().max(40).optional().default(""),
    fulfillmentMethod: z.enum(["delivery", "pickup"]).optional().default("delivery"),
    items: z.array(z.object({ product_id: z.coerce.number().int().positive(), quantity: z.coerce.number().int().positive() })).min(1)
  });
  const input = schema.parse(req.body);
  const pricing = await calculateCheckoutPricing(input.items, input.couponCode, input.fulfillmentMethod);
  if (input.couponCode && !pricing.coupon) throw new HttpError(400, "Coupon is invalid or expired.");
  res.json(pricing);
}));

router.use(requireAuth, requireRole("admin"));

async function getDatabaseStatus() {
  try {
    const [status] = await query("SELECT DATABASE() AS database_name, NOW() AS checked_at");
    const tables = await query("SHOW TABLES");
    return {
      connected: true,
      databaseName: status?.database_name || "retela_db",
      checkedAt: status?.checked_at,
      tableCount: tables.length
    };
  } catch (error) {
    console.error("[settings] Database status check failed", {
      code: error.code || null,
      message: error.message
    });
    return {
      connected: false,
      databaseName: process.env.DB_NAME || "retela_db",
      checkedAt: new Date().toISOString(),
      tableCount: 0,
      error: "database_unavailable"
    };
  }
}

async function buildSettingsResponse(config, encryptedOpenAiApiKey, databaseStatus = null) {
  const sanitized = sanitizeSystemSettings(config, encryptedOpenAiApiKey, databaseStatus);
  const aiProviderStatus = await getAIProviderStatus(config);
  const shipping = await safeActiveShippingSettings(config);
  return {
    ...sanitized,
    payment: {
      ...sanitized.payment,
      shippingFeeType: shipping.enabled ? "fixed" : "free",
      shippingRateName: shipping.rateName,
      shippingFeeEnabled: shipping.enabled,
      shippingFee: shipping.fixedFee
    },
    ai: {
      ...sanitized.ai,
      currentProvider: aiProviderStatus.currentProvider,
      lastProviderUsed: aiProviderStatus.lastProviderUsed,
      apiStatus: aiProviderStatus.apiStatus,
      providerStatus: aiProviderStatus.providers
    }
  };
}

function parseSettingsPayload(req) {
  let source;
  try {
    source = req.body.settings ? JSON.parse(req.body.settings) : req.body;
  } catch {
    throw new HttpError(400, "Settings payload contains invalid JSON");
  }
  if (!source || typeof source !== "object") throw new HttpError(400, "Settings payload is required");
  return source;
}

function applyUploadUrls(settings, files = {}) {
  const nextSettings = {
    ...settings,
    general: { ...settings.general },
    payment: { ...settings.payment }
  };
  const shopLogo = files.shopLogo?.[0];
  const gcashQr = files.gcashQr?.[0];
  if (shopLogo) nextSettings.general.shopLogoUrl = `/uploads/${shopLogo.filename}`;
  if (gcashQr) nextSettings.payment.gcashQrUrl = `/uploads/${gcashQr.filename}`;
  return nextSettings;
}

router.get("/", asyncHandler(async (req, res) => {
  const [{ config, encryptedOpenAiApiKey }, databaseStatus] = await Promise.all([
    loadSystemSettings(),
    getDatabaseStatus()
  ]);
  res.json(await buildSettingsResponse(config, encryptedOpenAiApiKey, databaseStatus));
}));

router.put("/", upload.fields([
  { name: "shopLogo", maxCount: 1 },
  { name: "gcashQr", maxCount: 1 }
]), asyncHandler(async (req, res) => {
  const payload = applyUploadUrls(parseSettingsPayload(req), req.files);
  const openaiApiKey = String(payload.ai?.openaiApiKey || "").trim();
  const saved = await saveSystemSettings(payload, { openaiApiKey: openaiApiKey || undefined });
  if (payload.payment) {
    await saveActiveShippingSettings({
      rateName: payload.payment.shippingRateName || "Standard Shipping",
      fixedFee: payload.payment.shippingFee,
      enabled: payload.payment.shippingFeeEnabled ?? payload.payment.shippingFeeType !== "free"
    }, req.user.id);
  }
  const databaseStatus = await getDatabaseStatus();
  res.json({
    message: "Settings saved successfully",
    settings: await buildSettingsResponse(saved.config, saved.encryptedOpenAiApiKey, databaseStatus)
  });
}));

router.get("/shipping", asyncHandler(async (req, res) => {
  const shipping = await getActiveShippingSettings();
  res.json(shipping);
}));

router.put("/shipping", asyncHandler(async (req, res) => {
  const schema = z.object({
    rateName: z.string().trim().max(120).optional().default(""),
    fixedFee: z.coerce.number().min(0, "Shipping fee cannot be negative.").max(99999),
    enabled: z.boolean()
  });
  const input = schema.parse(req.body);
  const shipping = await saveActiveShippingSettings(input, req.user.id);
  const { config } = await loadSystemSettings();
  await saveSystemSettings({
    ...config,
    payment: {
      ...config.payment,
      shippingFeeType: shipping.enabled ? "fixed" : "free",
      shippingRateName: shipping.rateName,
      shippingFeeEnabled: shipping.enabled,
      shippingFee: shipping.fixedFee
    }
  });
  req.app.get("io")?.emit("shipping:update", {
    type: shipping.enabled ? "fixed" : "free",
    fee: shipping.enabled ? shipping.fixedFee : 0,
    name: shipping.rateName || "Shipping",
    enabled: shipping.enabled
  });
  res.json(shipping);
}));

router.post("/reset", asyncHandler(async (req, res) => {
  const reset = await resetSystemSettings();
  const databaseStatus = await getDatabaseStatus();
  res.json({
    message: "Settings reset to default values",
    settings: await buildSettingsResponse(reset.config, reset.encryptedOpenAiApiKey, databaseStatus)
  });
}));

async function deleteProductUploads(imageRows) {
  const filenames = Array.from(new Set(
    imageRows
      .map((row) => String(row.image_url || "").trim())
      .filter((url) => url.startsWith("/uploads/"))
      .map((url) => path.basename(url))
      .filter(Boolean)
  ));
  await Promise.all(filenames.map((filename) => fs.unlink(path.join(uploadsDir, filename)).catch(() => {})));
  return filenames.length;
}

async function resetBusinessAutoIncrements() {
  const tables = await query(
    `SELECT TABLE_NAME, TABLE_TYPE
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN ('apparel_items', 'products', 'orders', 'returns')`
  );
  const hasApparelTable = tables.some((row) => row.TABLE_NAME === "apparel_items" && row.TABLE_TYPE === "BASE TABLE");
  const hasProductsTable = tables.some((row) => row.TABLE_NAME === "products" && row.TABLE_TYPE === "BASE TABLE");
  const resetIfSafe = async (tableName) => {
    try {
      const [idColumn] = await query(
        `SELECT COLUMN_NAME, EXTRA
         FROM INFORMATION_SCHEMA.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE()
           AND TABLE_NAME = :tableName
           AND COLUMN_NAME = 'id'
         LIMIT 1`,
        { tableName }
      );
      const primaryKeyRows = await query(
        `SELECT kcu.COLUMN_NAME
         FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
         JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE kcu
           ON tc.CONSTRAINT_SCHEMA = kcu.CONSTRAINT_SCHEMA
          AND tc.TABLE_NAME = kcu.TABLE_NAME
          AND tc.CONSTRAINT_NAME = kcu.CONSTRAINT_NAME
         WHERE tc.CONSTRAINT_SCHEMA = DATABASE()
           AND tc.TABLE_NAME = :tableName
           AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
         ORDER BY kcu.ORDINAL_POSITION`,
        { tableName }
      );
      const primaryKeyColumns = primaryKeyRows.map((row) => row.COLUMN_NAME);
      if (!idColumn || !String(idColumn.EXTRA || "").includes("auto_increment") || primaryKeyColumns.length !== 1 || primaryKeyColumns[0] !== "id") {
        console.warn(`[schema reset] Skipping AUTO_INCREMENT reset on ${tableName}: id is not an AUTO_INCREMENT PRIMARY KEY`);
        return;
      }
      await query(`ALTER TABLE \`${tableName}\` AUTO_INCREMENT = 1`);
    } catch (error) {
      console.warn(`[schema reset] Skipping AUTO_INCREMENT reset on ${tableName}: ${error.message}`);
    }
  };
  if (hasApparelTable) await resetIfSafe("apparel_items");
  if (!hasApparelTable && hasProductsTable) await resetIfSafe("products");
  await resetIfSafe("orders");
  await resetIfSafe("returns");
}

router.post("/clear-demo-data", asyncHandler(async (req, res) => {
  await ensureProductInventoryColumns();
  const productImages = await query("SELECT image_url FROM products WHERE image_url IS NOT NULL AND image_url <> ''");

  await query("DELETE FROM returns");
  await query("DELETE FROM reviews WHERE order_id IS NOT NULL OR product_id IS NOT NULL");
  await query("DELETE FROM notifications WHERE type IN ('order', 'refund', 'new_product', 'inventory', 'feedback')");
  await query("DELETE FROM orders");
  await query("DELETE FROM products");
  await query("DELETE FROM conversations WHERE is_archived = TRUE OR is_deleted = TRUE");
  await query("DELETE FROM broadcasts WHERE is_deleted = TRUE");
  await resetBusinessAutoIncrements();

  const deletedUploadCount = await deleteProductUploads(productImages);
  req.app.get("io")?.emit("inventory:update", { type: "inventory", action: "cleared" });
  req.app.get("io")?.emit("retela:data-change", { type: "demo-data-cleared" });

  res.json({
    message: "Demo data cleared successfully. System is ready for client deployment.",
    deletedUploadCount
  });
}));

router.get("/backup", asyncHandler(async (req, res) => {
  const { config, encryptedOpenAiApiKey } = await loadSystemSettings();
  const backup = {
    app: "RETELA AI Ecommerce System",
    version: 1,
    generatedAt: new Date().toISOString(),
    settings: sanitizeSystemSettings(config, encryptedOpenAiApiKey),
    data: {
      users: await query("SELECT id, username, display_name, email, phone_number, location, birthday, gender, role, status, created_at, updated_at FROM users ORDER BY id ASC"),
      products: await query("SELECT * FROM products ORDER BY id ASC"),
      orders: await query("SELECT * FROM orders ORDER BY id ASC"),
      order_items: await query("SELECT * FROM order_items ORDER BY id ASC"),
      notifications: await query("SELECT * FROM notifications ORDER BY id ASC LIMIT 1000"),
      reviews: await query("SELECT * FROM reviews ORDER BY id ASC"),
      returns: await query("SELECT * FROM returns ORDER BY id ASC")
    }
  };
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  res
    .attachment(`retela-backup-${stamp}.json`)
    .type("application/json")
    .send(JSON.stringify(backup, null, 2));
}));

router.post("/restore", asyncHandler(async (req, res) => {
  const schema = z.object({
    backup: z.object({
      settings: z.any().optional()
    }).passthrough().optional(),
    settings: z.any().optional()
  });
  const input = schema.parse(req.body);
  const sourceSettings = input.settings || input.backup?.settings;
  if (!sourceSettings) throw new HttpError(400, "Backup file does not contain settings data");

  const normalized = normalizeSystemSettings({
    ...sourceSettings,
    databaseStatus: undefined
  });
  const saved = await saveSystemSettings(normalized);
  const databaseStatus = await getDatabaseStatus();
  res.json({
    message: "Settings restored from backup",
    settings: await buildSettingsResponse(saved.config, saved.encryptedOpenAiApiKey, databaseStatus)
  });
}));

router.get("/logs", asyncHandler(async (req, res) => {
  const [outLog, errLog] = await Promise.all([
    fs.readFile(path.join(backendRoot, "backend-out.log"), "utf8").catch(() => ""),
    fs.readFile(path.join(backendRoot, "backend-err.log"), "utf8").catch(() => "")
  ]);
  const body = [
    "RETELA System Logs",
    `Generated: ${new Date().toISOString()}`,
    "",
    "=== backend-out.log ===",
    outLog || "No output log entries.",
    "",
    "=== backend-err.log ===",
    errLog || "No error log entries."
  ].join("\n");
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  res
    .attachment(`retela-system-logs-${stamp}.txt`)
    .type("text/plain")
    .send(body);
}));

router.get("/defaults", asyncHandler(async (req, res) => {
  res.json(DEFAULT_SYSTEM_SETTINGS);
}));

export default router;
