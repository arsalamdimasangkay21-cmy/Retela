import crypto from "crypto";
import fs from "fs/promises";
import path from "path";
import { z } from "zod";
import { query } from "../config/db.js";
import { UPLOAD_ROOT } from "../config/uploads.js";
import { DEFAULT_FREE_DELIVERY_MUNICIPALITIES, normalizeMunicipalityList } from "./shippingCalculator.js";

export const GCASH_QR_URL = "/api/settings/gcash-qr";

export const DEFAULT_SYSTEM_SETTINGS = {
  general: {
    shopName: "Tela to Pera Thrift Shop",
    shopLogoUrl: "",
    shopDescription: "AI-assisted thrift ecommerce for curated apparel and customer support.",
    contactNumber: "",
    emailAddress: "",
    shopAddress: "",
    shopMunicipality: "",
    shopProvince: "",
    shopRegion: "",
    shopPlaceId: "",
    shopLatitude: null,
    shopLongitude: null,
    currency: "PHP",
    language: "English"
  },
  ai: {
    openaiApiKey: "",
    openaiApiKeySaved: false,
    aiProvider: "auto",
    aiAssistant: true,
    aiAutoReply: true,
    aiRecommendation: true,
    aiChatTemperature: 0.35
  },
  notifications: {
    newOrderNotifications: true,
    lowStockAlerts: true,
    outOfStockAlerts: true,
    refundAlerts: true,
    emailNotifications: true,
    pushNotifications: true,
    soundNotifications: true,
    meetup24HourReminder: true,
    meetup1HourReminder: true
  },
  payment: {
    gcashNumber: "",
    gcashQrUrl: "",
    codEnabled: true,
    onlinePaymentEnabled: true,
    paymentVerificationAutomation: true,
    shippingFeeType: "fixed",
    shippingRateName: "Standard Shipping",
    shippingFeeEnabled: true,
    shippingFee: 0,
    freeDeliveryMunicipalities: DEFAULT_FREE_DELIVERY_MUNICIPALITIES,
    freeDeliveryRadiusKm: 15,
    outsideAreaShippingFee: 0,
    coupons: []
  },
  security: {
    twoFactorAuthentication: false,
    sessionTimeout: 60,
    loginActivity: true,
    adminAccessControl: true
  },
  inventory: {
    lowStockThreshold: 3,
    autoRestockAlert: true,
    barcodeEnabled: true,
    skuGeneratorEnabled: true
  },
  reports: {
    autoGenerateReports: false,
    dailyReports: true,
    weeklyReports: true,
    monthlyReports: true,
    exportPdf: true,
    exportExcel: true
  },
  appearance: {
    darkMode: false,
    themeColor: "#22C55E",
    dashboardLayout: "Comfortable",
    sidebarCollapse: false
  },
  customers: {
    customerRegistrationApproval: false,
    autoWelcomeMessage: true,
    loyaltyRewards: false,
    customerBroadcastNotifications: true
  },
  about: {
    mission: "To provide affordable, quality, and sustainable thrift fashion products while improving customer experience using modern technology.",
    vision: "To become a trusted AI-powered thrift ecommerce platform in the Philippines.",
    fullAddress: "Tela to Pera Thrift Shop, Philippines",
    landmark: "Near the local community market",
    facebookPage: "https://facebook.com/telatopera",
    instagramLink: "https://instagram.com/telatopera",
    messengerLink: "https://m.me/telatopera",
    businessDays: "Monday to Sunday",
    openingTime: "9:00 AM",
    closingTime: "7:00 PM",
    paymentMethods: "GCash, Cash on Delivery, Online Payments",
    deliveryAreas: "Selected nearby areas and customer pickup points",
    estimatedDeliveryTime: "1 to 3 business days after order confirmation",
    returnConditions: "Return allowed within 7 days. Apparel must not be heavily damaged.",
    refundProcess: "Refund approval depends on admin verification and proof review.",
    supportChannels: "Live chat, AI assistant support, and admin support",
    deliverySafetyPolicy: "For everyone's safety, customers and delivery personnel should meet only at the confirmed delivery or meeting location shown in the order. Verify the order and customer/delivery identity before handing over or accepting an item. Avoid changing the meetup location through unofficial messages. Keep communication inside RETELA whenever possible. Do not share OTPs, passwords, or sensitive account information. If the location feels unsafe, contact the other party through RETELA and arrange a safer public meeting point before completing the order.",
    ownerProfile: "Tela to Pera Thrift Shop Admin",
    developers: "RETELA Development Team",
    thesisMembers: "RETELA Thesis Members"
  }
};

const settingsSchema = z.object({
  general: z.object({
    shopName: z.string().trim().min(2, "Shop name is required").max(120),
    shopLogoUrl: z.string().trim().max(255).optional().default(""),
    shopDescription: z.string().trim().max(1200).optional().default(""),
    contactNumber: z.string().trim().max(30).optional().default(""),
    emailAddress: z.string().trim().email("Use a valid email address").or(z.literal("")).default(""),
    shopAddress: z.string().trim().max(255).optional().default(""),
    shopMunicipality: z.string().trim().max(120).optional().default(""),
    shopProvince: z.string().trim().max(120).optional().default(""),
    shopRegion: z.string().trim().max(120).optional().default(""),
    shopPlaceId: z.string().trim().max(255).optional().default(""),
    shopLatitude: z.preprocess((value) => value === "" || value == null ? null : Number(value), z.number().min(-90).max(90).nullable()).optional().default(null),
    shopLongitude: z.preprocess((value) => value === "" || value == null ? null : Number(value), z.number().min(-180).max(180).nullable()).optional().default(null),
    currency: z.enum(["PHP"]).default("PHP"),
    language: z.enum(["English", "Filipino"]).default("English")
  }),
  ai: z.object({
    openaiApiKey: z.string().trim().max(300).optional().default(""),
    openaiApiKeySaved: z.boolean().optional().default(false),
    aiProvider: z.enum(["openai", "gemini", "auto"]).optional().default("auto"),
    aiAssistant: z.boolean(),
    aiAutoReply: z.boolean(),
    aiRecommendation: z.boolean(),
    aiChatTemperature: z.coerce.number().min(0).max(2)
  }),
  notifications: z.object({
    newOrderNotifications: z.boolean(),
    lowStockAlerts: z.boolean(),
    outOfStockAlerts: z.boolean(),
    refundAlerts: z.boolean(),
    emailNotifications: z.boolean(),
    pushNotifications: z.boolean(),
    soundNotifications: z.boolean(),
    meetup24HourReminder: z.boolean().optional().default(true),
    meetup1HourReminder: z.boolean().optional().default(true)
  }),
  payment: z.object({
    gcashNumber: z.string().trim().max(30).optional().default(""),
    gcashQrUrl: z.string().trim().max(255).optional().default(""),
    codEnabled: z.boolean(),
    onlinePaymentEnabled: z.boolean(),
    paymentVerificationAutomation: z.boolean(),
    shippingFeeType: z.enum(["fixed", "free"]).optional().default("fixed"),
    shippingRateName: z.string().trim().max(120).optional().default("Standard Shipping"),
    shippingFeeEnabled: z.boolean().optional().default(true),
    shippingFee: z.coerce.number().min(0).max(99999).optional().default(0),
    freeDeliveryMunicipalities: z.array(z.string().trim().min(1).max(120)).max(100).optional().default(DEFAULT_FREE_DELIVERY_MUNICIPALITIES),
    freeDeliveryRadiusKm: z.coerce.number().min(0).max(1000).optional().default(15),
    outsideAreaShippingFee: z.coerce.number().min(0).max(99999).optional().default(0),
    coupons: z.array(z.object({
      code: z.string().trim().min(2).max(40),
      discountPercent: z.coerce.number().min(0).max(100).optional().default(0),
      freeShipping: z.boolean().optional().default(false),
      expiresAt: z.string().trim().optional().default(""),
      active: z.boolean().optional().default(true)
    })).optional().default([])
  }),
  security: z.object({
    twoFactorAuthentication: z.boolean(),
    sessionTimeout: z.coerce.number().int().min(5).max(1440),
    loginActivity: z.boolean(),
    adminAccessControl: z.boolean()
  }),
  inventory: z.object({
    lowStockThreshold: z.coerce.number().int().min(0).max(999),
    autoRestockAlert: z.boolean(),
    barcodeEnabled: z.boolean(),
    skuGeneratorEnabled: z.boolean()
  }),
  reports: z.object({
    autoGenerateReports: z.boolean(),
    dailyReports: z.boolean(),
    weeklyReports: z.boolean(),
    monthlyReports: z.boolean(),
    exportPdf: z.boolean(),
    exportExcel: z.boolean()
  }),
  appearance: z.object({
    darkMode: z.boolean(),
    themeColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Use a valid theme color"),
    dashboardLayout: z.enum(["Comfortable", "Compact", "Analytics Focus"]),
    sidebarCollapse: z.boolean()
  }),
  customers: z.object({
    customerRegistrationApproval: z.boolean(),
    autoWelcomeMessage: z.boolean(),
    loyaltyRewards: z.boolean(),
    customerBroadcastNotifications: z.boolean()
  }),
  about: z.object({
    mission: z.string().trim().max(1200),
    vision: z.string().trim().max(1200),
    fullAddress: z.string().trim().max(255),
    landmark: z.string().trim().max(160),
    facebookPage: z.string().trim().max(255),
    instagramLink: z.string().trim().max(255),
    messengerLink: z.string().trim().max(255),
    businessDays: z.string().trim().max(120),
    openingTime: z.string().trim().max(40),
    closingTime: z.string().trim().max(40),
    paymentMethods: z.string().trim().max(255),
    deliveryAreas: z.string().trim().max(500),
    estimatedDeliveryTime: z.string().trim().max(160),
    returnConditions: z.string().trim().max(800),
    refundProcess: z.string().trim().max(800),
    supportChannels: z.string().trim().max(255),
    deliverySafetyPolicy: z.string().trim().max(1800),
    ownerProfile: z.string().trim().max(255),
    developers: z.string().trim().max(500),
    thesisMembers: z.string().trim().max(500)
  })
});

let settingsTableReady;

function secretKey() {
  return crypto
    .createHash("sha256")
    .update(process.env.SETTINGS_SECRET || process.env.JWT_SECRET || "dev_secret_change_me")
    .digest();
}

export function encryptSecret(value) {
  if (!value) return null;
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", secretKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

export function decryptSecret(value) {
  if (!value) return "";
  const [version, iv, tag, encrypted] = String(value).split(":");
  if (version !== "v1" || !iv || !tag || !encrypted) return "";
  const decipher = crypto.createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(encrypted, "base64")),
    decipher.final()
  ]).toString("utf8");
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepMerge(base, input) {
  if (!isPlainObject(input)) return { ...base };
  return Object.entries(base).reduce((merged, [key, value]) => {
    if (isPlainObject(value)) {
      merged[key] = deepMerge(value, input[key]);
      return merged;
    }
    merged[key] = input[key] ?? value;
    return merged;
  }, {});
}

function parseStoredConfig(value) {
  try {
    return JSON.parse(value || "{}");
  } catch {
    return {};
  }
}

function legacyQrUpload(config) {
  const rawUrl = String(config?.payment?.gcashQrUrl || "").trim();
  if (!rawUrl || rawUrl === GCASH_QR_URL) return null;
  let pathname = rawUrl;
  try {
    pathname = new URL(rawUrl, "http://retela.local").pathname;
  } catch {
    return null;
  }
  if (!pathname.startsWith("/uploads/")) return null;
  const filename = path.basename(pathname);
  if (!filename) return null;
  const extension = path.extname(filename).toLowerCase();
  const mime = extension === ".png" ? "image/png" : extension === ".webp" ? "image/webp" : "image/jpeg";
  return { filename, mime };
}

async function migrateLegacyGcashQr(config) {
  const legacy = legacyQrUpload(config);
  if (!legacy) return false;
  try {
    const data = await fs.readFile(path.join(UPLOAD_ROOT, legacy.filename));
    if (!data.length) return false;
    await query(
      `UPDATE system_settings
       SET gcash_qr_data = :data,
           gcash_qr_mime = :mime,
           gcash_qr_updated_at = NOW()
       WHERE id = 1`,
      { data, mime: legacy.mime }
    );
    return true;
  } catch (error) {
    if (error?.code !== "ENOENT") {
      console.warn("[settings] Legacy GCash QR migration failed", { code: error?.code, message: error?.message });
    }
    return false;
  }
}

export async function ensureSettingsTable() {
  settingsTableReady ||= (async () => {
    await query(`
      CREATE TABLE IF NOT EXISTS system_settings (
        id TINYINT PRIMARY KEY,
        config_json LONGTEXT NOT NULL,
        openai_api_key_encrypted TEXT NULL,
        gcash_qr_data LONGBLOB NULL,
        gcash_qr_mime VARCHAR(100) NULL,
        gcash_qr_updated_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
      )
    `);
    const rows = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'system_settings'
         AND COLUMN_NAME IN ('gcash_qr_data', 'gcash_qr_mime', 'gcash_qr_updated_at')`
    );
    const columns = new Set(rows.map((row) => row.COLUMN_NAME));
    if (!columns.has("gcash_qr_data")) await query("ALTER TABLE system_settings ADD COLUMN gcash_qr_data LONGBLOB NULL AFTER openai_api_key_encrypted");
    if (!columns.has("gcash_qr_mime")) await query("ALTER TABLE system_settings ADD COLUMN gcash_qr_mime VARCHAR(100) NULL AFTER gcash_qr_data");
    if (!columns.has("gcash_qr_updated_at")) await query("ALTER TABLE system_settings ADD COLUMN gcash_qr_updated_at DATETIME NULL AFTER gcash_qr_mime");
  })().catch((error) => {
    settingsTableReady = undefined;
    throw error;
  });
  return settingsTableReady;
}

export function normalizeSystemSettings(settings) {
  const source = isPlainObject(settings) ? settings : {};
  const sourcePayment = isPlainObject(source.payment) ? source.payment : {};
  const migratedSettings = {
    ...source,
    payment: {
      ...sourcePayment,
      outsideAreaShippingFee: sourcePayment.outsideAreaShippingFee
        ?? sourcePayment.shippingFee
        ?? DEFAULT_SYSTEM_SETTINGS.payment.outsideAreaShippingFee,
      freeDeliveryMunicipalities: normalizeMunicipalityList(
        sourcePayment.freeDeliveryMunicipalities ?? DEFAULT_FREE_DELIVERY_MUNICIPALITIES
      )
    }
  };
  const merged = deepMerge(DEFAULT_SYSTEM_SETTINGS, migratedSettings);
  return settingsSchema.parse(merged);
}

export function sanitizeSystemSettings(settings, encryptedOpenAiApiKey, databaseStatus = null) {
  return {
    ...settings,
    ai: {
      ...settings.ai,
      openaiApiKey: "",
      openaiApiKeySaved: Boolean(encryptedOpenAiApiKey)
    },
    databaseStatus
  };
}

export async function loadSystemSettings() {
  await ensureSettingsTable();
  const rows = await query("SELECT config_json, openai_api_key_encrypted, gcash_qr_data IS NOT NULL AS has_gcash_qr FROM system_settings WHERE id = 1");
  if (!rows.length) {
    const config = normalizeSystemSettings(DEFAULT_SYSTEM_SETTINGS);
    await query(
      `INSERT INTO system_settings (id, config_json, openai_api_key_encrypted)
       VALUES (1, :configJson, NULL)
       ON DUPLICATE KEY UPDATE config_json = config_json`,
      { configJson: JSON.stringify({ ...config, ai: { ...config.ai, openaiApiKey: "", openaiApiKeySaved: false } }) }
    );
    return { config, encryptedOpenAiApiKey: null };
  }
  const config = normalizeSystemSettings(parseStoredConfig(rows[0].config_json));
  const hasPersistedQr = Boolean(rows[0].has_gcash_qr) || await migrateLegacyGcashQr(config);
  if (hasPersistedQr) {
    config.payment.gcashQrUrl = GCASH_QR_URL;
  } else if (config.payment.gcashQrUrl === GCASH_QR_URL) {
    config.payment.gcashQrUrl = "";
  }
  return { config, encryptedOpenAiApiKey: rows[0].openai_api_key_encrypted || null };
}

export async function saveSystemSettings(nextSettings, options = {}) {
  await ensureSettingsTable();
  const current = await loadSystemSettings();
  const config = normalizeSystemSettings(nextSettings);
  const cleanConfig = {
    ...config,
    ai: {
      ...config.ai,
      openaiApiKey: "",
      openaiApiKeySaved: false
    }
  };
  const nextEncryptedKey = options.clearOpenAiApiKey
    ? null
    : options.openaiApiKey
      ? encryptSecret(options.openaiApiKey)
      : current.encryptedOpenAiApiKey;

  await query(
    `INSERT INTO system_settings (id, config_json, openai_api_key_encrypted)
     VALUES (1, :configJson, :openaiApiKey)
     ON DUPLICATE KEY UPDATE
       config_json = VALUES(config_json),
       openai_api_key_encrypted = VALUES(openai_api_key_encrypted)`,
    {
      configJson: JSON.stringify(cleanConfig),
      openaiApiKey: nextEncryptedKey
    }
  );
  return { config: cleanConfig, encryptedOpenAiApiKey: nextEncryptedKey };
}

export async function resetSystemSettings() {
  await ensureSettingsTable();
  const current = await loadSystemSettings();
  const qrRows = await query("SELECT gcash_qr_data IS NOT NULL AS has_gcash_qr FROM system_settings WHERE id = 1");
  const preservedQrUrl = Boolean(qrRows[0]?.has_gcash_qr)
    ? GCASH_QR_URL
    : current.config.payment.gcashQrUrl;
  const config = normalizeSystemSettings({
    ...DEFAULT_SYSTEM_SETTINGS,
    payment: {
      ...DEFAULT_SYSTEM_SETTINGS.payment,
      gcashQrUrl: preservedQrUrl || ""
    }
  });
  await query(
    `INSERT INTO system_settings (id, config_json, openai_api_key_encrypted)
     VALUES (1, :configJson, NULL)
     ON DUPLICATE KEY UPDATE config_json = VALUES(config_json), openai_api_key_encrypted = NULL`,
    { configJson: JSON.stringify(config) }
  );
  return { config, encryptedOpenAiApiKey: null };
}

export async function getGcashQrImage() {
  await ensureSettingsTable();
  const rows = await query(
    "SELECT gcash_qr_data, gcash_qr_mime, gcash_qr_updated_at FROM system_settings WHERE id = 1 LIMIT 1"
  );
  const row = rows[0];
  if (!Buffer.isBuffer(row?.gcash_qr_data) || row.gcash_qr_data.length === 0) return null;
  return {
    data: row.gcash_qr_data,
    mime: row.gcash_qr_mime || "image/png",
    updatedAt: row.gcash_qr_updated_at || null
  };
}

export async function saveGcashQrImage(file) {
  if (!Buffer.isBuffer(file?.buffer) || file.buffer.length === 0) {
    throw new Error("GCash QR image data is required");
  }
  await ensureSettingsTable();
  await query(
    `UPDATE system_settings
     SET gcash_qr_data = :imageData,
         gcash_qr_mime = :imageMime,
         gcash_qr_updated_at = NOW()
     WHERE id = 1`,
    { imageData: file.buffer, imageMime: file.mimetype || "image/png" }
  );
}

export async function removeGcashQrImage() {
  const { config } = await loadSystemSettings();
  const saved = await saveSystemSettings({
    ...config,
    payment: { ...config.payment, gcashQrUrl: "" }
  });
  await query(
    `UPDATE system_settings
     SET gcash_qr_data = NULL,
         gcash_qr_mime = NULL,
         gcash_qr_updated_at = NULL
     WHERE id = 1`
  );
  return saved;
}

export async function getOpenAiRuntimeSettings() {
  try {
    const { config, encryptedOpenAiApiKey } = await loadSystemSettings();
    return {
      apiKey: decryptSecret(encryptedOpenAiApiKey) || process.env.OPENAI_API_KEY || "",
      aiAssistant: Boolean(config.ai.aiAssistant),
      aiAutoReply: Boolean(config.ai.aiAutoReply),
      aiRecommendation: Boolean(config.ai.aiRecommendation),
      temperature: Number(config.ai.aiChatTemperature ?? 0.35)
    };
  } catch {
    return {
      apiKey: process.env.OPENAI_API_KEY || "",
      aiAssistant: true,
      aiAutoReply: true,
      aiRecommendation: true,
      temperature: 0.35
    };
  }
}
