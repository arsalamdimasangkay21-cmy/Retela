import { query } from "../config/db.js";

let customerLocationColumnsReady;

export async function ensureCustomerLocationColumns() {
  customerLocationColumnsReady ||= (async () => {
    const rows = await query(
      `SELECT COLUMN_NAME
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'users'
         AND COLUMN_NAME IN ('formatted_address', 'delivery_barangay', 'delivery_municipality',
           'delivery_province', 'delivery_region', 'delivery_postal_code', 'delivery_place_id',
           'delivery_location_source', 'delivery_latitude', 'delivery_longitude', 'delivery_area_override')`
    );
    const columns = new Set(rows.map((row) => row.COLUMN_NAME));
    const definitions = [
      ["formatted_address", "formatted_address VARCHAR(500) NULL AFTER location"],
      ["delivery_barangay", "delivery_barangay VARCHAR(160) NULL AFTER formatted_address"],
      ["delivery_municipality", "delivery_municipality VARCHAR(160) NULL AFTER delivery_barangay"],
      ["delivery_province", "delivery_province VARCHAR(160) NULL AFTER delivery_municipality"],
      ["delivery_region", "delivery_region VARCHAR(160) NULL AFTER delivery_province"],
      ["delivery_postal_code", "delivery_postal_code VARCHAR(20) NULL AFTER delivery_region"],
      ["delivery_place_id", "delivery_place_id VARCHAR(255) NULL AFTER delivery_postal_code"],
      ["delivery_location_source", "delivery_location_source VARCHAR(40) NULL AFTER delivery_place_id"],
      ["delivery_latitude", "delivery_latitude DECIMAL(10,7) NULL AFTER delivery_location_source"],
      ["delivery_longitude", "delivery_longitude DECIMAL(10,7) NULL AFTER delivery_latitude"],
      ["delivery_area_override", "delivery_area_override ENUM('nearby','outside') NULL AFTER delivery_notes"]
    ];
    for (const [column, definition] of definitions) {
      if (!columns.has(column)) await query(`ALTER TABLE users ADD COLUMN ${definition}`);
    }
  })().catch((error) => {
    customerLocationColumnsReady = undefined;
    throw error;
  });
  return customerLocationColumnsReady;
}

function nullableText(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function nullableNumber(value) {
  if (value === "" || value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function customerLocationFromRow(row = {}) {
  const formattedAddress = nullableText(row.formatted_address ?? row.formattedAddress ?? row.location);
  return {
    formattedAddress,
    address: formattedAddress,
    barangay: nullableText(row.delivery_barangay ?? row.barangay),
    municipality: nullableText(row.delivery_municipality ?? row.municipality ?? row.city),
    province: nullableText(row.delivery_province ?? row.province),
    region: nullableText(row.delivery_region ?? row.region),
    postalCode: nullableText(row.delivery_postal_code ?? row.postalCode ?? row.postal_code),
    placeId: nullableText(row.delivery_place_id ?? row.placeId ?? row.place_id),
    latitude: nullableNumber(row.delivery_latitude ?? row.latitude),
    longitude: nullableNumber(row.delivery_longitude ?? row.longitude),
    landmark: nullableText(row.delivery_landmark ?? row.landmark),
    notes: nullableText(row.delivery_notes ?? row.notes),
    source: nullableText(row.delivery_location_source ?? row.locationSource ?? row.location_source) || "legacy"
  };
}

export async function loadCustomerDeliveryLocation(userId, executor = query) {
  if (executor === query) await ensureCustomerLocationColumns();
  const rows = await executor(
    `SELECT id, username, display_name, location, formatted_address,
       delivery_barangay, delivery_municipality, delivery_province, delivery_region,
       delivery_postal_code, delivery_place_id, delivery_latitude, delivery_longitude,
       delivery_landmark, delivery_notes, delivery_location_source, delivery_area_override
     FROM users
     WHERE id = :userId AND role = 'customer'
     LIMIT 1`,
    { userId }
  );
  const user = rows[0];
  if (!user) return null;
  return {
    userId: Number(user.id),
    name: user.display_name || user.username || "Customer",
    deliveryAreaOverride: ["nearby", "outside"].includes(String(user.delivery_area_override || "").toLowerCase())
      ? String(user.delivery_area_override).toLowerCase()
      : null,
    ...customerLocationFromRow(user)
  };
}
