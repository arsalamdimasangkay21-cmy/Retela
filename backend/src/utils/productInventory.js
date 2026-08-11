import { query, requireUsableAutoIncrementId } from "../config/db.js";

let productInventoryColumnsReady;

function warnProductMigrationSkipped(action, reason) {
  console.warn(`[product inventory schema] Skipping ${action}: ${reason}`);
}

async function safeProductMigration(action, callback) {
  try {
    return await callback();
  } catch (error) {
    warnProductMigrationSkipped(action, error.message);
    return undefined;
  }
}

export function productSkuForId(id) {
  return `RETELA-${String(Number(id || 0)).padStart(6, "0")}`;
}

export function normalizeProductMatchValue(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLowerCase();
}

export function productStatusForStock(stock) {
  const quantity = Number(stock || 0);
  if (quantity <= 0) return "Out of Stock";
  if (quantity <= 5) return "Low Stock";
  return "In Stock";
}

export function nonDeletedProductWhere(alias = "") {
  return `${alias}is_deleted = FALSE`;
}

export function availableProductWhere(alias = "") {
  return `${nonDeletedProductWhere(alias)} AND ${alias}stock > 0 AND ${alias}is_active = TRUE`;
}

export function inventoryStatusSql(stockExpression = "stock") {
  return `CASE
    WHEN ${stockExpression} <= 0 THEN 'Out of Stock'
    WHEN ${stockExpression} <= 5 THEN 'Low Stock'
    ELSE 'In Stock'
  END`;
}

export async function getProductStorageTable() {
  const rows = await query(
    `SELECT TABLE_NAME, TABLE_TYPE
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN ('apparel_items', 'products')`
  );
  const productsTable = rows.find((row) => row.TABLE_NAME === "products" && row.TABLE_TYPE === "BASE TABLE");
  if (productsTable) return "products";
  const apparelTable = rows.find((row) => row.TABLE_NAME === "apparel_items" && row.TABLE_TYPE === "BASE TABLE");
  if (apparelTable) return "apparel_items";
  return "products";
}

export async function productWriteTable() {
  await ensureProductInventoryColumns();
  return getProductStorageTable();
}

async function ensureProductsViewIncludesSku(storageTable) {
  if (storageTable !== "apparel_items") {
    return;
  }

  try {
    const rows = await query(
      `SELECT TABLE_NAME, TABLE_TYPE
       FROM INFORMATION_SCHEMA.TABLES
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = 'products'
       LIMIT 1`
    );
    if (rows[0]?.TABLE_TYPE === "BASE TABLE") return;

    await query(`
      CREATE OR REPLACE VIEW products AS
      SELECT
        id,
        sku,
        name,
        brand,
        category,
        gender,
        size,
        color,
        price,
        stock,
        status,
        image_url,
        image_data,
        image_mime,
        \`condition\`,
        description,
        is_active,
        is_deleted,
        deleted_at,
        deleted_by,
        sale_enabled,
        sale_discount_percent,
        sale_product_ids_json,
        sale_starts_at,
        sale_ends_at,
        created_at,
        updated_at
      FROM apparel_items
    `);
  } catch (err) {
    console.log("Skipping products view creation:", err.message);
  }
}

export async function ensureProductInventoryColumns() {
  productInventoryColumnsReady ||= (async () => {
    const storageTable = await safeProductMigration("product table detection", getProductStorageTable);
    if (!storageTable) return;
    const rows = await safeProductMigration("product column inspection", () => query(
      `SELECT COLUMN_NAME, CHARACTER_MAXIMUM_LENGTH
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = :storageTable
         AND COLUMN_NAME IN ('sku', 'name', 'brand', 'category', 'gender', 'size', 'color', 'price', 'stock', 'status', 'image_url', 'image_data', 'image_mime', 'condition', 'description', 'is_active', 'is_deleted', 'deleted_at', 'deleted_by', 'sale_enabled', 'sale_discount_percent', 'sale_product_ids_json', 'sale_starts_at', 'sale_ends_at', 'created_at', 'updated_at')`,
      { storageTable }
    ));
    if (!rows) return;
    const constraints = await safeProductMigration("product constraint inspection", () => query(
      `SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE
       FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
       WHERE CONSTRAINT_SCHEMA = DATABASE()
         AND TABLE_NAME = :storageTable`,
      { storageTable }
    ));
    if (!constraints) return;
    const columns = new Set(rows.map((row) => row.COLUMN_NAME));
    const columnLengths = new Map(rows.map((row) => [row.COLUMN_NAME, Number(row.CHARACTER_MAXIMUM_LENGTH || 0)]));

    if (!columns.has("sku")) {
      await safeProductMigration("sku column", () => query(`ALTER TABLE \`${storageTable}\` ADD COLUMN sku VARCHAR(50) NULL AFTER id`));
    } else if (columnLengths.get("sku") && columnLengths.get("sku") < 50) {
      await safeProductMigration("sku column length", () => query(`ALTER TABLE \`${storageTable}\` MODIFY sku VARCHAR(50) NULL`));
    }
    if (!columns.has("name")) {
      await safeProductMigration("name column", () => query(`ALTER TABLE \`${storageTable}\` ADD COLUMN name VARCHAR(160) NOT NULL DEFAULT 'Untitled Apparel' AFTER sku`));
    }
    if (!columns.has("brand")) {
      await safeProductMigration("brand column", () => query(`ALTER TABLE \`${storageTable}\` ADD COLUMN brand VARCHAR(120) NOT NULL DEFAULT 'Other' AFTER name`));
    }
    if (!columns.has("category")) {
      await safeProductMigration("category column", () => query(`ALTER TABLE \`${storageTable}\` ADD COLUMN category VARCHAR(80) NOT NULL DEFAULT 'T-Shirts' AFTER brand`));
    } else if (columnLengths.get("category") && columnLengths.get("category") < 80) {
      await safeProductMigration("category column length", () => query(`ALTER TABLE \`${storageTable}\` MODIFY category VARCHAR(80) NOT NULL DEFAULT 'T-Shirts'`));
    }
    if (!columns.has("gender")) {
      await safeProductMigration("gender column", () => query(`ALTER TABLE \`${storageTable}\` ADD COLUMN gender VARCHAR(80) DEFAULT 'Other' AFTER category`));
    } else if (columnLengths.get("gender") && columnLengths.get("gender") < 80) {
      await safeProductMigration("gender column length", () => query(`ALTER TABLE \`${storageTable}\` MODIFY gender VARCHAR(80) DEFAULT 'Other'`));
    }
    if (!columns.has("size")) {
      await safeProductMigration("size column", () => query(`ALTER TABLE \`${storageTable}\` ADD COLUMN size VARCHAR(80) DEFAULT 'Free Size' AFTER gender`));
    } else if (columnLengths.get("size") && columnLengths.get("size") < 80) {
      await safeProductMigration("size column length", () => query(`ALTER TABLE \`${storageTable}\` MODIFY size VARCHAR(80) DEFAULT 'Free Size'`));
    }
    if (!columns.has("color")) {
      await safeProductMigration("color column", () => query(`ALTER TABLE \`${storageTable}\` ADD COLUMN color VARCHAR(80) NOT NULL DEFAULT 'Other' AFTER size`));
    }
    if (!columns.has("price")) {
      await safeProductMigration("price column", () => query(`ALTER TABLE \`${storageTable}\` ADD COLUMN price DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER color`));
    }
    if (!columns.has("stock")) {
      await safeProductMigration("stock column", () => query(`ALTER TABLE \`${storageTable}\` ADD COLUMN stock INT NOT NULL DEFAULT 0 AFTER price`));
    }
    if (!columns.has("status")) {
      await safeProductMigration("status column", () => query(`ALTER TABLE \`${storageTable}\` ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'In Stock' AFTER stock`));
    }
    if (!columns.has("image_url")) {
      await safeProductMigration("image_url column", () => query(`ALTER TABLE \`${storageTable}\` ADD COLUMN image_url VARCHAR(255) NULL AFTER status`));
    }
    if (!columns.has("image_data")) {
      await safeProductMigration("image_data column", () => query(`ALTER TABLE \`${storageTable}\` ADD COLUMN image_data LONGBLOB NULL AFTER image_url`));
    }
    if (!columns.has("image_mime")) {
      await safeProductMigration("image_mime column", () => query(`ALTER TABLE \`${storageTable}\` ADD COLUMN image_mime VARCHAR(100) NULL AFTER image_data`));
    }
    if (!columns.has("condition")) {
      await safeProductMigration("condition column", () => query(`ALTER TABLE \`${storageTable}\` ADD COLUMN \`condition\` VARCHAR(120) NOT NULL DEFAULT 'Good' AFTER image_mime`));
    }
    if (!columns.has("description")) {
      await safeProductMigration("description column", () => query(`ALTER TABLE \`${storageTable}\` ADD COLUMN description TEXT NULL AFTER \`condition\``));
    }
    if (!columns.has("is_active")) {
      await safeProductMigration("is_active column", () => query(`ALTER TABLE \`${storageTable}\` ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE AFTER description`));
    }
    if (!columns.has("is_deleted")) {
      await safeProductMigration("is_deleted column", () => query(`ALTER TABLE \`${storageTable}\` ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE AFTER is_active`));
    }
    if (!columns.has("deleted_at")) {
      await safeProductMigration("deleted_at column", () => query(`ALTER TABLE \`${storageTable}\` ADD COLUMN deleted_at DATETIME NULL AFTER is_deleted`));
    }
    if (!columns.has("deleted_by")) {
      await safeProductMigration("deleted_by column", () => query(`ALTER TABLE \`${storageTable}\` ADD COLUMN deleted_by INT NULL AFTER deleted_at`));
    }
    if (!columns.has("sale_enabled")) {
      await safeProductMigration("sale_enabled column", () => query(`ALTER TABLE \`${storageTable}\` ADD COLUMN sale_enabled BOOLEAN NOT NULL DEFAULT FALSE AFTER deleted_by`));
    }
    if (!columns.has("sale_discount_percent")) {
      await safeProductMigration("sale_discount_percent column", () => query(`ALTER TABLE \`${storageTable}\` ADD COLUMN sale_discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER sale_enabled`));
    }
    if (!columns.has("sale_product_ids_json")) {
      await safeProductMigration("sale_product_ids_json column", () => query(`ALTER TABLE \`${storageTable}\` ADD COLUMN sale_product_ids_json JSON NULL AFTER sale_discount_percent`));
    }
    if (!columns.has("sale_starts_at")) {
      await safeProductMigration("sale_starts_at column", () => query(`ALTER TABLE \`${storageTable}\` ADD COLUMN sale_starts_at DATETIME NULL AFTER sale_product_ids_json`));
    }
    if (!columns.has("sale_ends_at")) {
      await safeProductMigration("sale_ends_at column", () => query(`ALTER TABLE \`${storageTable}\` ADD COLUMN sale_ends_at DATETIME NULL AFTER sale_starts_at`));
    }

    await safeProductMigration("product inventory defaults", () => query(`UPDATE \`${storageTable}\`
      SET status = ${inventoryStatusSql("stock")},
          is_active = COALESCE(is_active, TRUE),
          is_deleted = COALESCE(is_deleted, FALSE),
          sku = CASE WHEN sku IS NULL OR sku = '' OR sku = 'RETELA-000000' THEN CONCAT('RETELA-', LPAD(id, 6, '0')) ELSE sku END,
          deleted_at = CASE WHEN is_deleted = TRUE AND deleted_at IS NULL THEN NOW() ELSE deleted_at END`));

    await requireUsableAutoIncrementId(storageTable);

    const skuIndexes = await safeProductMigration("sku index inspection", () => query(
      `SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS COLUMNS
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = :storageTable
       GROUP BY INDEX_NAME`,
      { storageTable }
    ));
    const hasSkuIndex = skuIndexes?.some((row) => row.INDEX_NAME === `idx_${storageTable}_sku` || row.COLUMNS === "sku");
    if (skuIndexes && !hasSkuIndex) {
      await safeProductMigration("sku unique index", () => query(`CREATE UNIQUE INDEX idx_${storageTable}_sku ON \`${storageTable}\` (sku)`));
    }

    await ensureProductsViewIncludesSku(storageTable);
  })().catch((error) => {
    productInventoryColumnsReady = undefined;
    warnProductMigrationSkipped("product inventory bootstrap", error.message);
    throw error;
  });

  return productInventoryColumnsReady;
}
