import { ensureAutoIncrementId, query, transaction } from "../config/db.js";
import { loadSystemSettings } from "./systemSettings.js";
import {
  classifyShippingLocation,
  DEFAULT_FREE_DELIVERY_MUNICIPALITIES,
  normalizeMunicipalityList
} from "./shippingCalculator.js";

let shippingSettingsTableReady;

async function repairShippingSettingsIdentity() {
  const columns = await query("SHOW COLUMNS FROM shipping_settings");
  const idColumn = columns.find((column) => column.Field === "id");
  if (!idColumn) throw new Error("shipping_settings.id column is missing");

  const indexes = await query("SHOW INDEX FROM shipping_settings");
  const hasPrimaryKey = indexes.some((index) => index.Key_name === "PRIMARY" && index.Column_name === "id");
  if (!hasPrimaryKey) {
    const anyPrimaryKey = indexes.some((index) => index.Key_name === "PRIMARY");
    if (!anyPrimaryKey) {
      await query("ALTER TABLE shipping_settings ADD PRIMARY KEY (id)");
    } else {
      console.warn("[shipping-settings] Existing primary key does not use id; AUTO_INCREMENT repair skipped.");
      return;
    }
  }
  await ensureAutoIncrementId("shipping_settings");
}

export async function ensureShippingSettingsTable() {
  shippingSettingsTableReady ||= query(`
    CREATE TABLE IF NOT EXISTS shipping_settings (
      id INT AUTO_INCREMENT PRIMARY KEY,
      rate_name VARCHAR(120) NULL,
      fixed_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
      free_municipalities_json LONGTEXT NULL,
      free_radius_km DECIMAL(8,2) NOT NULL DEFAULT 15,
      outside_area_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
      is_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      created_by INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_shipping_settings_active (is_active, updated_at),
      CONSTRAINT fk_shipping_settings_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    )
  `).then(async () => {
    await repairShippingSettingsIdentity();
    const rows = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'shipping_settings'
         AND COLUMN_NAME IN ('free_municipalities_json', 'free_radius_km', 'outside_area_fee')`
    );
    const columns = new Set(rows.map((row) => row.COLUMN_NAME));
    if (!columns.has("free_municipalities_json")) await query("ALTER TABLE shipping_settings ADD COLUMN free_municipalities_json LONGTEXT NULL AFTER fixed_fee");
    if (!columns.has("free_radius_km")) await query("ALTER TABLE shipping_settings ADD COLUMN free_radius_km DECIMAL(8,2) NOT NULL DEFAULT 15 AFTER free_municipalities_json");
    if (!columns.has("outside_area_fee")) {
      await query("ALTER TABLE shipping_settings ADD COLUMN outside_area_fee DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER free_radius_km");
      await query("UPDATE shipping_settings SET outside_area_fee = fixed_fee WHERE outside_area_fee = 0 AND fixed_fee > 0");
    }
  }).catch((error) => {
    shippingSettingsTableReady = undefined;
    throw error;
  });
  return shippingSettingsTableReady;
}

function normalizeShippingConfig(row) {
  let municipalities = DEFAULT_FREE_DELIVERY_MUNICIPALITIES;
  try {
    const parsed = typeof row?.free_municipalities_json === "string"
      ? JSON.parse(row.free_municipalities_json)
      : row?.free_municipalities_json;
    if (Array.isArray(parsed)) municipalities = normalizeMunicipalityList(parsed);
  } catch {
    municipalities = DEFAULT_FREE_DELIVERY_MUNICIPALITIES;
  }
  const outsideAreaShippingFee = Math.max(0, Number(row?.outside_area_fee ?? row?.fixed_fee ?? 0));
  return {
    id: row?.id ? Number(row.id) : null,
    rateName: row?.rate_name || "",
    fixedFee: outsideAreaShippingFee,
    outsideAreaShippingFee,
    freeDeliveryMunicipalities: municipalities,
    freeDeliveryRadiusKm: Math.max(0, Number(row?.free_radius_km ?? 15)),
    enabled: Boolean(row?.is_enabled),
    active: Boolean(row?.is_active ?? true),
    updatedAt: row?.updated_at || null
  };
}

async function defaultShippingFromSystemSettings() {
  const { config } = await loadSystemSettings();
  const enabled = config.payment.shippingFeeType !== "free";
  return {
    rateName: config.payment.shippingRateName || "Standard Shipping",
    fixedFee: enabled ? Math.max(0, Number(config.payment.outsideAreaShippingFee ?? config.payment.shippingFee ?? 0)) : 0,
    outsideAreaShippingFee: enabled ? Math.max(0, Number(config.payment.outsideAreaShippingFee ?? config.payment.shippingFee ?? 0)) : 0,
    freeDeliveryMunicipalities: normalizeMunicipalityList(config.payment.freeDeliveryMunicipalities),
    freeDeliveryRadiusKm: Math.max(0, Number(config.payment.freeDeliveryRadiusKm ?? 15)),
    enabled
  };
}

export async function getActiveShippingSettings() {
  await ensureShippingSettingsTable();
  const rows = await query(
    `SELECT *
     FROM shipping_settings
     WHERE is_active = TRUE
     ORDER BY updated_at DESC, id DESC
     LIMIT 1`
  );
  if (rows.length) return normalizeShippingConfig(rows[0]);

  const fallback = await defaultShippingFromSystemSettings();
  const result = await query(
    `INSERT INTO shipping_settings
      (rate_name, fixed_fee, free_municipalities_json, free_radius_km, outside_area_fee, is_enabled, is_active)
     VALUES
      (:rateName, :fixedFee, :freeMunicipalitiesJson, :freeRadiusKm, :outsideAreaShippingFee, :enabled, TRUE)`,
    {
      ...fallback,
      freeMunicipalitiesJson: JSON.stringify(fallback.freeDeliveryMunicipalities),
      freeRadiusKm: fallback.freeDeliveryRadiusKm
    }
  );
  return { id: result.insertId, active: true, updatedAt: null, ...fallback };
}

export async function saveActiveShippingSettings(input, userId = null) {
  await ensureShippingSettingsTable();
  const currentRows = await query(
    "SELECT * FROM shipping_settings WHERE is_active = TRUE ORDER BY updated_at DESC, id DESC LIMIT 1"
  );
  const current = currentRows.length ? normalizeShippingConfig(currentRows[0]) : await defaultShippingFromSystemSettings();
  const fixedFee = Math.max(0, Number(
    input.outsideAreaShippingFee ?? input.outside_area_fee ?? input.fixedFee ?? input.fixed_fee
      ?? current.outsideAreaShippingFee ?? 0
  ));
  const rateName = String(input.rateName ?? input.rate_name ?? current.rateName ?? "").trim().slice(0, 120);
  const enabled = Boolean(input.enabled ?? input.is_enabled ?? current.enabled ?? true);
  const freeDeliveryMunicipalities = normalizeMunicipalityList(
    input.freeDeliveryMunicipalities ?? input.free_municipalities ?? current.freeDeliveryMunicipalities
  );
  const freeDeliveryRadiusKm = Math.max(0, Number(
    input.freeDeliveryRadiusKm ?? input.free_radius_km ?? current.freeDeliveryRadiusKm ?? 15
  ));
  const freeMunicipalitiesJson = JSON.stringify(freeDeliveryMunicipalities);

  return transaction(async (run) => {
    const activeRows = await run(
      "SELECT id FROM shipping_settings WHERE is_active = TRUE ORDER BY updated_at DESC, id DESC LIMIT 1"
    );
    const activeId = activeRows[0]?.id;
    let result;
    if (activeId) {
      await run("UPDATE shipping_settings SET is_active = FALSE WHERE is_active = TRUE AND id <> :id", { id: activeId });
      await run(
        `UPDATE shipping_settings
         SET rate_name = :rateName,
             fixed_fee = :fixedFee,
             free_municipalities_json = :freeMunicipalitiesJson,
             free_radius_km = :freeDeliveryRadiusKm,
             outside_area_fee = :fixedFee,
             is_enabled = :enabled,
             is_active = TRUE,
             created_by = :userId
         WHERE id = :id`,
        { id: activeId, rateName: rateName || null, fixedFee, freeMunicipalitiesJson, freeDeliveryRadiusKm, enabled, userId }
      );
      result = { insertId: activeId };
    } else {
      await run("UPDATE shipping_settings SET is_active = FALSE WHERE is_active = TRUE");
      result = await run(
        `INSERT INTO shipping_settings
          (rate_name, fixed_fee, free_municipalities_json, free_radius_km, outside_area_fee, is_enabled, is_active, created_by)
         VALUES
          (:rateName, :fixedFee, :freeMunicipalitiesJson, :freeDeliveryRadiusKm, :fixedFee, :enabled, TRUE, :userId)`,
        { rateName: rateName || null, fixedFee, freeMunicipalitiesJson, freeDeliveryRadiusKm, enabled, userId }
      );
    }
    return {
      id: Number(result.insertId || activeId),
      rateName,
      fixedFee,
      outsideAreaShippingFee: fixedFee,
      freeDeliveryMunicipalities,
      freeDeliveryRadiusKm,
      enabled,
      active: true,
      updatedAt: null
    };
  });
}

export async function shippingSummary() {
  const settings = await getActiveShippingSettings();
  return {
    type: settings.enabled ? "fixed" : "free",
    fee: settings.enabled ? settings.fixedFee : 0,
    outsideAreaShippingFee: settings.enabled ? settings.outsideAreaShippingFee : 0,
    freeDeliveryMunicipalities: settings.freeDeliveryMunicipalities,
    freeDeliveryRadiusKm: settings.freeDeliveryRadiusKm,
    name: settings.rateName || "Shipping",
    enabled: settings.enabled
  };
}

export async function getShippingPolicy() {
  const [{ config }, shipping] = await Promise.all([
    loadSystemSettings(),
    getActiveShippingSettings()
  ]);
  return {
    shopAddress: config.general.shopAddress,
    shopMunicipality: config.general.shopMunicipality,
    shopProvince: config.general.shopProvince,
    shopRegion: config.general.shopRegion,
    shopLatitude: config.general.shopLatitude,
    shopLongitude: config.general.shopLongitude,
    freeDeliveryMunicipalities: shipping.freeDeliveryMunicipalities,
    freeDeliveryRadiusKm: shipping.freeDeliveryRadiusKm,
    outsideAreaShippingFee: shipping.enabled ? shipping.outsideAreaShippingFee : 0,
    enabled: shipping.enabled
  };
}

export function quoteShippingLocation(location, policy, options = {}) {
  return classifyShippingLocation(location, {
    ...policy,
    fulfillmentMethod: options.fulfillmentMethod || "delivery",
    couponFreeShipping: Boolean(options.couponFreeShipping),
    deliveryAreaOverride: options.deliveryAreaOverride
      ?? location?.deliveryAreaOverride
      ?? location?.delivery_area_override
      ?? null
  });
}

export async function calculateShippingQuote(location, options = {}) {
  return quoteShippingLocation(location, await getShippingPolicy(), options);
}
