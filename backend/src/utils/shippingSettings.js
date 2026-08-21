import { ensureAutoIncrementId, query, transaction } from "../config/db.js";
import { loadSystemSettings } from "./systemSettings.js";

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
  }).catch((error) => {
    shippingSettingsTableReady = undefined;
    throw error;
  });
  return shippingSettingsTableReady;
}

function normalizeShippingConfig(row) {
  return {
    id: row?.id ? Number(row.id) : null,
    rateName: row?.rate_name || "",
    fixedFee: Math.max(0, Number(row?.fixed_fee || 0)),
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
    fixedFee: enabled ? Math.max(0, Number(config.payment.shippingFee || 0)) : 0,
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
    `INSERT INTO shipping_settings (rate_name, fixed_fee, is_enabled, is_active)
     VALUES (:rateName, :fixedFee, :enabled, TRUE)`,
    fallback
  );
  return { id: result.insertId, active: true, updatedAt: null, ...fallback };
}

export async function saveActiveShippingSettings(input, userId = null) {
  const fixedFee = Math.max(0, Number(input.fixedFee ?? input.fixed_fee ?? 0));
  const rateName = String(input.rateName ?? input.rate_name ?? "").trim().slice(0, 120);
  const enabled = Boolean(input.enabled ?? input.is_enabled);
  await ensureShippingSettingsTable();

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
         SET rate_name = :rateName, fixed_fee = :fixedFee, is_enabled = :enabled, is_active = TRUE, created_by = :userId
         WHERE id = :id`,
        { id: activeId, rateName: rateName || null, fixedFee, enabled, userId }
      );
      result = { insertId: activeId };
    } else {
      await run("UPDATE shipping_settings SET is_active = FALSE WHERE is_active = TRUE");
      result = await run(
        `INSERT INTO shipping_settings (rate_name, fixed_fee, is_enabled, is_active, created_by)
         VALUES (:rateName, :fixedFee, :enabled, TRUE, :userId)`,
        { rateName: rateName || null, fixedFee, enabled, userId }
      );
    }
    return {
      id: Number(result.insertId || activeId),
      rateName,
      fixedFee,
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
    name: settings.rateName || "Shipping",
    enabled: settings.enabled
  };
}
