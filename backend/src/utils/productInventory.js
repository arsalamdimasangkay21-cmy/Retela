import { query } from "../config/db.js";

let productInventoryColumnsReady;

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

async function getProductStorageTable() {
  const rows = await query(
    `SELECT TABLE_NAME, TABLE_TYPE
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN ('apparel_items', 'products')`
  );
  const apparelTable = rows.find((row) => row.TABLE_NAME === "apparel_items" && row.TABLE_TYPE === "BASE TABLE");
  if (apparelTable) return "apparel_items";
  return "products";
}

async function ensureProductsViewIncludesSku(storageTable) {
  // Railway already uses a real "products" table.
  // Only create the view if apparel_items exists.
  // If using the existing products table, don't create a view.
  if (storageTable !== "apparel_items") {
    return;
  }

  try {
    await query("DROP VIEW IF EXISTS products");

    await query(`
      CREATE VIEW products AS
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
        \`condition\`,
        description,
        is_active,
        is_deleted,
        deleted_at,
        deleted_by,
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
    const storageTable = await getProductStorageTable();
    const rows = await query(
      `SELECT COLUMN_NAME, CHARACTER_MAXIMUM_LENGTH
       FROM INFORMATION_SCHEMA.COLUMNS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = :storageTable
         AND COLUMN_NAME IN ('sku', 'brand', 'category', 'gender', 'size', 'color', 'description', 'status', 'is_active', 'is_deleted', 'deleted_at', 'deleted_by')`,
      { storageTable }
    );
    const columns = new Set(rows.map((row) => row.COLUMN_NAME));
    const columnLengths = new Map(rows.map((row) => [row.COLUMN_NAME, Number(row.CHARACTER_MAXIMUM_LENGTH || 0)]));

    if (!columns.has("sku")) {
      await query(`ALTER TABLE ${storageTable} ADD COLUMN sku VARCHAR(32) NULL AFTER id`);
    }
    if (!columns.has("brand")) {
      await query(`ALTER TABLE ${storageTable} ADD COLUMN brand VARCHAR(120) NOT NULL DEFAULT 'Other' AFTER name`);
    }
    if (!columns.has("category")) {
      await query(`ALTER TABLE ${storageTable} ADD COLUMN category VARCHAR(80) NOT NULL DEFAULT 'T-Shirts' AFTER brand`);
    } else if (columnLengths.get("category") && columnLengths.get("category") < 80) {
      await query(`ALTER TABLE ${storageTable} MODIFY category VARCHAR(80) NOT NULL DEFAULT 'T-Shirts'`);
    }
    if (!columns.has("gender")) {
      await query(`ALTER TABLE ${storageTable} ADD COLUMN gender VARCHAR(80) DEFAULT 'Other' AFTER category`);
    } else if (columnLengths.get("gender") && columnLengths.get("gender") < 80) {
      await query(`ALTER TABLE ${storageTable} MODIFY gender VARCHAR(80) DEFAULT 'Other'`);
    }
    if (!columns.has("size")) {
      await query(`ALTER TABLE ${storageTable} ADD COLUMN size VARCHAR(80) DEFAULT 'Free Size' AFTER gender`);
    } else if (columnLengths.get("size") && columnLengths.get("size") < 80) {
      await query(`ALTER TABLE ${storageTable} MODIFY size VARCHAR(80) DEFAULT 'Free Size'`);
    }
    if (!columns.has("color")) {
      await query(`ALTER TABLE ${storageTable} ADD COLUMN color VARCHAR(80) NOT NULL DEFAULT 'Other' AFTER size`);
    }
    if (!columns.has("description")) {
      await query(`ALTER TABLE ${storageTable} ADD COLUMN description TEXT NULL AFTER \`condition\``);
    }
    if (!columns.has("status")) {
      await query(`ALTER TABLE ${storageTable} ADD COLUMN status VARCHAR(20) NOT NULL DEFAULT 'In Stock' AFTER stock`);
    }
    if (!columns.has("is_active")) {
      await query(`ALTER TABLE ${storageTable} ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE AFTER description`);
    }
    if (!columns.has("is_deleted")) {
      await query(`ALTER TABLE ${storageTable} ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE AFTER is_active`);
    }
    if (!columns.has("deleted_at")) {
      await query(`ALTER TABLE ${storageTable} ADD COLUMN deleted_at DATETIME NULL AFTER is_deleted`);
    }
    if (!columns.has("deleted_by")) {
      await query(`ALTER TABLE ${storageTable} ADD COLUMN deleted_by INT NULL AFTER deleted_at`);
    }

    await query(`UPDATE ${storageTable}
      SET status = ${inventoryStatusSql("stock")},
          is_active = COALESCE(is_active, TRUE),
          is_deleted = COALESCE(is_deleted, FALSE),
          sku = CASE WHEN sku IS NULL OR sku = '' THEN CONCAT('RETELA-', LPAD(id, 6, '0')) ELSE sku END,
          deleted_at = CASE WHEN is_deleted = TRUE AND deleted_at IS NULL THEN NOW() ELSE deleted_at END`);

    const skuIndexes = await query(
      `SELECT INDEX_NAME
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = :storageTable
         AND INDEX_NAME = :indexName`,
      { storageTable, indexName: `idx_${storageTable}_sku` }
    );
    if (!skuIndexes.length) {
      await query(`CREATE UNIQUE INDEX idx_${storageTable}_sku ON ${storageTable} (sku)`);
    }

    await ensureProductsViewIncludesSku(storageTable);
  })().catch((error) => {
    productInventoryColumnsReady = undefined;
    throw error;
  });

  return productInventoryColumnsReady;
}
