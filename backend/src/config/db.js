import mysql from "mysql2/promise";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { AsyncLocalStorage } from "async_hooks";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.join(__dirname, "../../.env") });
dotenv.config();

const requestContext = new AsyncLocalStorage();

function databaseSslConfig() {
  const sslMode = String(process.env.DB_SSL || process.env.MYSQL_SSL || "").trim().toLowerCase();
  if (!["true", "1", "required", "require"].includes(sslMode)) return undefined;
  return {
    rejectUnauthorized: String(process.env.DB_SSL_REJECT_UNAUTHORIZED || "true").toLowerCase() !== "false",
    ...(process.env.MYSQL_SSL_CA ? { ca: process.env.MYSQL_SSL_CA } : {})
  };
}

function databaseConnectionConfig() {
  const ssl = databaseSslConfig();
  return {
    host: process.env.DB_HOST || "localhost",
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || "root",
    password: process.env.DB_PASSWORD || "",
    database: process.env.DB_NAME || "retela_db",
    waitForConnections: true,
    connectionLimit: Number(process.env.DB_CONNECTION_LIMIT || 10),
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    namedPlaceholders: true,
    ...(ssl ? { ssl } : {})
  };
}

function isSchemaMigrationSql(sql) {
  const normalized = String(sql || "").trim().replace(/\s+/g, " ").toUpperCase();
  return /^(ALTER TABLE|CREATE TABLE|CREATE VIEW|CREATE INDEX|CREATE UNIQUE INDEX|DROP VIEW|DROP TABLE)\b/.test(normalized);
}

export const pool = mysql.createPool({
  ...databaseConnectionConfig()
});

export function requestContextMiddleware(req, res, next) {
  requestContext.run({
    method: req.method,
    route: req.originalUrl,
    startedAt: new Date().toISOString()
  }, next);
}

function attachSqlContext(err, sql, params) {
  err.sqlText = sql;
  err.sqlParams = params;
  err.requestContext = requestContext.getStore() || null;
  return err;
}

function sanitizeParams(params = {}) {
  const sensitivePattern = /(password|token|secret|key|otp|authorization|cookie|imagedata|governmentiddata|selfiedata|image_data|_data$|blob|buffer)/i;
  return Object.fromEntries(Object.entries(params || {}).map(([key, value]) => [
    key,
    sensitivePattern.test(key) ? "[redacted]" : value
  ]));
}

export function isDatabaseConnectionError(error) {
  return [
    "ECONNREFUSED",
    "PROTOCOL_CONNECTION_LOST",
    "ER_CON_COUNT_ERROR",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN"
  ].includes(error?.code);
}

export function isDatabaseSchemaError(error) {
  return [
    "ER_NO_SUCH_TABLE",
    "ER_BAD_FIELD_ERROR",
    "ER_PARSE_ERROR",
    "ER_NO_DEFAULT_FOR_FIELD",
    "ER_TRUNCATED_WRONG_VALUE",
    "ER_DATA_TOO_LONG"
  ].includes(error?.code);
}

export async function query(sql, params = {}) {
  try {
    const [rows] = await pool.execute(sql, params);
    return rows;
  } catch (err) {
    attachSqlContext(err, sql, params);
    if (isSchemaMigrationSql(sql)) {
      console.warn(`[schema migration] Skipping failed schema statement: ${err.message}`);
      console.warn("SQL:", sql);
      console.warn("Parameters:", JSON.stringify(params, null, 2));
      return [];
    }
    const context = err.requestContext || {};
    console.error("======================================");
    console.error("DATABASE ERROR");
    console.error("======================================");
    console.error("Time:", new Date().toISOString());
    console.error("Route:", context.route || "startup/bootstrap");
    console.error("Method:", context.method || "system");
    console.error("SQL:");
    console.error(sql);
    console.error("--------------------------------------");
    console.error("PARAMETERS:");
    console.error(JSON.stringify(sanitizeParams(params), null, 2));
    console.error("--------------------------------------");
    console.error("MYSQL ERROR:");
    console.error("Code:", err.code);
    console.error("Errno:", err.errno);
    console.error("SQL State:", err.sqlState);
    console.error("Message:", err.sqlMessage);
    console.error("Stack:");
    console.error(err.stack);
    console.error(err);
    console.error("======================================");
    throw err;
  }
}

export async function transaction(callback) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const run = async (sql, params = {}) => {
      try {
        const [rows] = await connection.execute(sql, params);
        return rows;
      } catch (err) {
        throw attachSqlContext(err, sql, params);
      }
    };

    const result = await callback(run, connection);

    await connection.commit();
    return result;
  } catch (error) {
    try {
      await connection.rollback();
    } catch (rollbackError) {
      console.error("[db-transaction] rollback failed", {
        message: rollbackError?.message,
        code: rollbackError?.code
      });
    }
    throw error;
  } finally {
    connection.release();
  }
}

export async function checkDatabaseConnection() {
  const [row] = await query("SELECT 1 AS ok, DATABASE() AS database_name, NOW() AS checked_at");
  return {
    connected: Number(row?.ok) === 1,
    databaseName: row?.database_name || process.env.DB_NAME || "retela_db",
    checkedAt: row?.checked_at || new Date().toISOString()
  };
}

export async function testDatabaseConnection() {
  const [row] = await query("SELECT 1 AS ok");
  return Number(row?.ok) === 1;
}

async function listTables(names) {
  const params = Object.fromEntries(names.map((name, index) => [`name${index}`, name]));
  const placeholders = names.map((_, index) => `:name${index}`).join(", ");
  return query(
    `SELECT TABLE_NAME, TABLE_TYPE
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME IN (${placeholders})`,
    params
  );
}

async function tableInfo(name) {
  const rows = await query(
    `SELECT TABLE_NAME, TABLE_TYPE
     FROM INFORMATION_SCHEMA.TABLES
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :name
     LIMIT 1`,
    { name }
  );
  return rows[0] || null;
}

async function baseTableExists(name) {
  const info = await tableInfo(name);
  return info?.TABLE_TYPE === "BASE TABLE";
}

async function tableOrViewExists(name) {
  return Boolean(await tableInfo(name));
}

async function columnSet(tableName) {
  const rows = await query(
    `SELECT COLUMN_NAME, EXTRA, COLUMN_KEY, DATA_TYPE, COLUMN_TYPE, IS_NULLABLE, COLUMN_DEFAULT, CHARACTER_MAXIMUM_LENGTH
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :tableName`,
    { tableName }
  );
  return new Map(rows.map((row) => [row.COLUMN_NAME, row]));
}

async function primaryKeyColumns(tableName) {
  const keyUsageRows = await query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = :tableName
       AND CONSTRAINT_NAME = 'PRIMARY'
     ORDER BY ORDINAL_POSITION`,
    { tableName }
  );
  if (keyUsageRows.length) return keyUsageRows.map((row) => row.COLUMN_NAME);

  const statisticRows = await query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :tableName
       AND INDEX_NAME = 'PRIMARY'
     ORDER BY SEQ_IN_INDEX`,
    { tableName }
  );
  if (statisticRows.length) return statisticRows.map((row) => row.COLUMN_NAME);

  const columns = await columnSet(tableName);
  return [...columns.values()]
    .filter((column) => String(column.COLUMN_KEY || "").toUpperCase() === "PRI")
    .map((column) => column.COLUMN_NAME);
}

async function indexSummaries(tableName) {
  return query(
    `SELECT INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS COLUMNS
     FROM INFORMATION_SCHEMA.STATISTICS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :tableName
     GROUP BY INDEX_NAME, NON_UNIQUE
     ORDER BY INDEX_NAME`,
    { tableName }
  );
}

async function tableConstraints(tableName) {
  return query(
    `SELECT CONSTRAINT_NAME, CONSTRAINT_TYPE
     FROM INFORMATION_SCHEMA.TABLE_CONSTRAINTS
     WHERE CONSTRAINT_SCHEMA = DATABASE()
       AND TABLE_NAME = :tableName`,
    { tableName }
  );
}

async function autoIncrementColumns(tableName) {
  const rows = await query(
    `SELECT COLUMN_NAME
     FROM INFORMATION_SCHEMA.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE()
       AND TABLE_NAME = :tableName
       AND EXTRA LIKE '%auto_increment%'`,
    { tableName }
  );
  return rows.map((row) => row.COLUMN_NAME);
}

function warnMigrationSkipped(tableName, action, reason) {
  console.warn(`[schema bootstrap] Skipping ${action} on ${tableName}: ${reason}`);
}

async function runSchemaMigration(tableName, action, callback) {
  try {
    return await callback();
  } catch (error) {
    console.warn(`[schema bootstrap] Skipping ${action} on ${tableName}: ${error.message}`);
    return undefined;
  }
}

async function ensureTable(tableName, ddl) {
  await runSchemaMigration(tableName, "table creation", async () => {
    if (await tableOrViewExists(tableName)) return;
    await query(ddl);
  });
}

async function ensureColumn(tableName, columnName, definition) {
  await runSchemaMigration(tableName, `column ${columnName}`, async () => {
    if (!(await baseTableExists(tableName))) return;
    const columns = await columnSet(tableName);
    if (!columns.has(columnName)) {
      await query(`ALTER TABLE \`${tableName}\` ADD COLUMN ${definition}`);
    }
  });
}

async function ensureIndex(tableName, indexName, ddl, expectedColumns = []) {
  await runSchemaMigration(tableName, `index ${indexName}`, async () => {
    if (!(await baseTableExists(tableName))) return;
    const rows = await query(
      `SELECT INDEX_NAME, NON_UNIQUE, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) AS COLUMNS
       FROM INFORMATION_SCHEMA.STATISTICS
       WHERE TABLE_SCHEMA = DATABASE()
         AND TABLE_NAME = :tableName
       GROUP BY INDEX_NAME, NON_UNIQUE`,
      { tableName }
    );
    if (rows.some((row) => row.INDEX_NAME === indexName)) return;
    if (expectedColumns.length) {
      const expected = expectedColumns.join(",");
      if (rows.some((row) => String(row.COLUMNS || "") === expected)) return;
    }
    await query(ddl);
  });
}

export async function safeModifyColumn(tableName, columnName, action, sql) {
  await runSchemaMigration(tableName, action, async () => {
    if (!(await baseTableExists(tableName))) return;
    const columns = await columnSet(tableName);
    await tableConstraints(tableName);
    if (!columns.has(columnName)) {
      warnMigrationSkipped(tableName, action, `${columnName} column does not exist`);
      return;
    }
    await query(sql);
  });
}

async function safeDataMigration(tableName, action, sql, params = {}) {
  await runSchemaMigration(tableName, action, async () => {
    if (!(await baseTableExists(tableName))) return;
    await query(sql, params);
  });
}

export async function ensureAutoIncrementId(tableName) {
  await runSchemaMigration(tableName, "id AUTO_INCREMENT", async () => {
    if (!(await baseTableExists(tableName))) return;
    const columns = await columnSet(tableName);
    const id = columns.get("id");
    if (!id) {
      warnMigrationSkipped(tableName, "id AUTO_INCREMENT", "id column does not exist");
      return;
    }
    if (String(id.EXTRA || "").includes("auto_increment")) return;

    const pkColumns = await primaryKeyColumns(tableName);
    if (pkColumns.length !== 1 || pkColumns[0] !== "id") {
      warnMigrationSkipped(tableName, "id AUTO_INCREMENT", "id is not the single-column PRIMARY KEY");
      return;
    }

    const autoColumns = await autoIncrementColumns(tableName);
    if (autoColumns.length > 0) {
      warnMigrationSkipped(tableName, "id AUTO_INCREMENT", `another AUTO_INCREMENT column exists: ${autoColumns.join(", ")}`);
      return;
    }

    const idType = String(id.COLUMN_TYPE || "int").trim() || "int";
    await query(`ALTER TABLE \`${tableName}\` MODIFY id ${idType} NOT NULL AUTO_INCREMENT`);
  });
}

export async function inspectIdentityColumn(tableName) {
  const info = await tableInfo(tableName);
  if (!info) {
    return {
      tableName,
      exists: false,
      tableType: null,
      id: null,
      primaryKeyColumns: [],
      autoIncrementColumns: []
    };
  }
  const columns = info.TABLE_TYPE === "BASE TABLE" ? await columnSet(tableName) : new Map();
  return {
    tableName,
    exists: true,
    tableType: info.TABLE_TYPE,
    id: columns.get("id") || null,
    primaryKeyColumns: info.TABLE_TYPE === "BASE TABLE" ? await primaryKeyColumns(tableName) : [],
    autoIncrementColumns: info.TABLE_TYPE === "BASE TABLE" ? await autoIncrementColumns(tableName) : [],
    indexes: info.TABLE_TYPE === "BASE TABLE" ? await indexSummaries(tableName) : []
  };
}

export async function requireUsableAutoIncrementId(tableName) {
  const identity = await inspectIdentityColumn(tableName);
  if (!identity.exists || identity.tableType !== "BASE TABLE") return identity;

  const idExtra = String(identity.id?.EXTRA || "").toLowerCase();
  const primaryKeyColumnsNormalized = identity.primaryKeyColumns.map((column) => String(column || "").toLowerCase());
  const isUsable = identity.id
    && identity.primaryKeyColumns.length === 1
    && primaryKeyColumnsNormalized[0] === "id"
    && idExtra.includes("auto_increment");

  if (!isUsable) {
    console.error("[schema bootstrap] Identity column validation failed", {
      tableName,
      tableType: identity.tableType,
      id: identity.id ? {
        columnType: identity.id.COLUMN_TYPE,
        extra: identity.id.EXTRA,
        columnKey: identity.id.COLUMN_KEY,
        nullable: identity.id.IS_NULLABLE
      } : null,
      primaryKeyColumns: identity.primaryKeyColumns,
      autoIncrementColumns: identity.autoIncrementColumns,
      indexes: identity.indexes
    });
    const error = new Error(
      `[schema bootstrap] ${tableName}.id is not usable. Expected id as the single-column AUTO_INCREMENT PRIMARY KEY. ` +
      `Primary key: ${identity.primaryKeyColumns.join(", ") || "<none>"}. ` +
      `AUTO_INCREMENT columns: ${identity.autoIncrementColumns.join(", ") || "<none>"}.`
    );
    error.code = "SCHEMA_ID_INVALID";
    error.tableName = tableName;
    error.identity = identity;
    throw error;
  }

  return identity;
}

async function getProductStorageTable() {
  const rows = await listTables(["products", "apparel_items"]);
  const productsBase = rows.some((row) => row.TABLE_NAME === "products" && row.TABLE_TYPE === "BASE TABLE");
  if (productsBase) return "products";
  const apparelBase = rows.some((row) => row.TABLE_NAME === "apparel_items" && row.TABLE_TYPE === "BASE TABLE");
  if (apparelBase) return "apparel_items";
  return "apparel_items";
}

async function ensureProductAlias(storageTable) {
  await runSchemaMigration("products", "products view creation", async () => {
    const productsInfo = await tableInfo("products");
    if (storageTable !== "apparel_items") return;
    if (productsInfo?.TABLE_TYPE === "BASE TABLE") return;
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
  });
}

async function ensureProductColumns(storageTable) {
  await ensureColumn(storageTable, "sku", "sku VARCHAR(50) NULL AFTER id");
  await safeModifyColumn(storageTable, "sku", "product sku length", `ALTER TABLE \`${storageTable}\` MODIFY sku VARCHAR(50) NULL`);
  await ensureColumn(storageTable, "name", "name VARCHAR(160) NOT NULL DEFAULT 'Untitled Apparel' AFTER sku");
  await ensureColumn(storageTable, "brand", "brand VARCHAR(120) NOT NULL DEFAULT 'Other' AFTER name");
  await ensureColumn(storageTable, "category", "category VARCHAR(80) NOT NULL DEFAULT 'T-Shirts' AFTER brand");
  await ensureColumn(storageTable, "gender", "gender VARCHAR(80) DEFAULT 'Other' AFTER category");
  await ensureColumn(storageTable, "size", "size VARCHAR(80) DEFAULT 'Free Size' AFTER gender");
  await ensureColumn(storageTable, "color", "color VARCHAR(80) NOT NULL DEFAULT 'Other' AFTER size");
  await ensureColumn(storageTable, "price", "price DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER color");
  await ensureColumn(storageTable, "stock", "stock INT NOT NULL DEFAULT 0 AFTER price");
  await ensureColumn(storageTable, "status", "status VARCHAR(20) NOT NULL DEFAULT 'In Stock' AFTER stock");
  await ensureColumn(storageTable, "image_url", "image_url VARCHAR(255) NULL AFTER status");
  await ensureColumn(storageTable, "image_data", "image_data LONGBLOB NULL AFTER image_url");
  await ensureColumn(storageTable, "image_mime", "image_mime VARCHAR(100) NULL AFTER image_data");
  await ensureColumn(storageTable, "condition", "`condition` VARCHAR(120) NOT NULL DEFAULT 'Good' AFTER image_mime");
  await ensureColumn(storageTable, "description", "description TEXT NULL AFTER `condition`");
  await ensureColumn(storageTable, "is_active", "is_active BOOLEAN NOT NULL DEFAULT TRUE AFTER description");
  await ensureColumn(storageTable, "is_deleted", "is_deleted BOOLEAN NOT NULL DEFAULT FALSE AFTER is_active");
  await ensureColumn(storageTable, "deleted_at", "deleted_at DATETIME NULL AFTER is_deleted");
  await ensureColumn(storageTable, "deleted_by", "deleted_by INT NULL AFTER deleted_at");
  await ensureColumn(storageTable, "sale_enabled", "sale_enabled BOOLEAN NOT NULL DEFAULT FALSE AFTER deleted_by");
  await ensureColumn(storageTable, "sale_discount_percent", "sale_discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER sale_enabled");
  await ensureColumn(storageTable, "sale_product_ids_json", "sale_product_ids_json JSON NULL AFTER sale_discount_percent");
  await ensureColumn(storageTable, "sale_starts_at", "sale_starts_at DATETIME NULL AFTER sale_product_ids_json");
  await ensureColumn(storageTable, "sale_ends_at", "sale_ends_at DATETIME NULL AFTER sale_starts_at");
  await ensureAutoIncrementId(storageTable);
  await safeDataMigration(storageTable, "product inventory defaults", `UPDATE \`${storageTable}\`
    SET sku = CASE WHEN sku IS NULL OR sku = '' OR sku = 'RETELA-000000' THEN CONCAT('RETELA-', LPAD(id, 6, '0')) ELSE sku END,
        is_active = COALESCE(is_active, TRUE),
        is_deleted = COALESCE(is_deleted, FALSE),
        status = CASE WHEN stock <= 0 THEN 'Out of Stock' WHEN stock <= 3 THEN 'Low Stock' ELSE 'In Stock' END`);
  await ensureIndex(storageTable, `idx_${storageTable}_sku`, `CREATE UNIQUE INDEX idx_${storageTable}_sku ON \`${storageTable}\` (sku)`, ["sku"]);
  await ensureIndex(storageTable, `idx_${storageTable}_deleted`, `CREATE INDEX idx_${storageTable}_deleted ON \`${storageTable}\` (is_deleted)`, ["is_deleted"]);
}

async function ensureCoreTables() {
  await ensureTable("users", `
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      username VARCHAR(80) NOT NULL UNIQUE,
      display_name VARCHAR(120) NULL,
      email VARCHAR(160) NULL UNIQUE,
      phone_number VARCHAR(20) NULL UNIQUE,
      location VARCHAR(255) NULL,
      formatted_address VARCHAR(500) NULL,
      delivery_barangay VARCHAR(160) NULL,
      delivery_municipality VARCHAR(160) NULL,
      delivery_province VARCHAR(160) NULL,
      delivery_region VARCHAR(160) NULL,
      delivery_postal_code VARCHAR(20) NULL,
      delivery_place_id VARCHAR(255) NULL,
      delivery_location_source VARCHAR(40) NULL,
      delivery_latitude DECIMAL(10,7) NULL,
      delivery_longitude DECIMAL(10,7) NULL,
      delivery_landmark VARCHAR(255) NULL,
      delivery_notes TEXT NULL,
      delivery_area_override ENUM('nearby','outside') NULL,
      birthday DATE NULL,
      gender VARCHAR(40) NULL,
      shop_description TEXT NULL,
      profile_photo_url VARCHAR(255) NULL,
      gcash_number VARCHAR(20) NULL,
      debit_account_name VARCHAR(120) NULL,
      debit_account_number VARCHAR(40) NULL,
      password_hash VARCHAR(255) NOT NULL,
      role ENUM('admin','staff','customer') NOT NULL DEFAULT 'customer',
      status ENUM('pending_otp','pending','approved','rejected','suspended') NOT NULL DEFAULT 'pending_otp',
      is_verified BOOLEAN NOT NULL DEFAULT false,
      otp_code VARCHAR(6) NULL,
      otp_expires_at DATETIME NULL,
      password_reset_otp_code VARCHAR(6) NULL,
      password_reset_otp_expires_at DATETIME NULL,
      password_reset_verified_until DATETIME NULL,
      preferences JSON NULL,
      last_active_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_users_role_status (role, status),
      INDEX idx_users_last_active (last_active_at)
    )
  `);
  await ensureAutoIncrementId("users");
  await ensureColumn("users", "display_name", "display_name VARCHAR(120) NULL AFTER username");
  await ensureColumn("users", "phone_number", "phone_number VARCHAR(20) NULL UNIQUE AFTER email");
  await ensureColumn("users", "location", "location VARCHAR(255) NULL AFTER phone_number");
  await ensureColumn("users", "formatted_address", "formatted_address VARCHAR(500) NULL AFTER location");
  await ensureColumn("users", "delivery_barangay", "delivery_barangay VARCHAR(160) NULL AFTER formatted_address");
  await ensureColumn("users", "delivery_municipality", "delivery_municipality VARCHAR(160) NULL AFTER delivery_barangay");
  await ensureColumn("users", "delivery_province", "delivery_province VARCHAR(160) NULL AFTER delivery_municipality");
  await ensureColumn("users", "delivery_region", "delivery_region VARCHAR(160) NULL AFTER delivery_province");
  await ensureColumn("users", "delivery_postal_code", "delivery_postal_code VARCHAR(20) NULL AFTER delivery_region");
  await ensureColumn("users", "delivery_place_id", "delivery_place_id VARCHAR(255) NULL AFTER delivery_postal_code");
  await ensureColumn("users", "delivery_location_source", "delivery_location_source VARCHAR(40) NULL AFTER delivery_place_id");
  await ensureColumn("users", "delivery_latitude", "delivery_latitude DECIMAL(10,7) NULL AFTER location");
  await ensureColumn("users", "delivery_longitude", "delivery_longitude DECIMAL(10,7) NULL AFTER delivery_latitude");
  await ensureColumn("users", "delivery_landmark", "delivery_landmark VARCHAR(255) NULL AFTER delivery_longitude");
  await ensureColumn("users", "delivery_notes", "delivery_notes TEXT NULL AFTER delivery_landmark");
  await ensureColumn("users", "delivery_area_override", "delivery_area_override ENUM('nearby','outside') NULL AFTER delivery_notes");
  await ensureColumn("users", "birthday", "birthday DATE NULL AFTER location");
  await ensureColumn("users", "gender", "gender VARCHAR(40) NULL AFTER birthday");
  await ensureColumn("users", "shop_description", "shop_description TEXT NULL AFTER gender");
  await ensureColumn("users", "profile_photo_url", "profile_photo_url VARCHAR(255) NULL AFTER shop_description");
  await ensureColumn("users", "gcash_number", "gcash_number VARCHAR(20) NULL AFTER profile_photo_url");
  await ensureColumn("users", "debit_account_name", "debit_account_name VARCHAR(120) NULL AFTER gcash_number");
  await ensureColumn("users", "debit_account_number", "debit_account_number VARCHAR(40) NULL AFTER debit_account_name");
  await ensureColumn("users", "is_verified", "is_verified BOOLEAN NOT NULL DEFAULT false AFTER status");
  await ensureColumn("users", "otp_code", "otp_code VARCHAR(6) NULL AFTER is_verified");
  await ensureColumn("users", "otp_expires_at", "otp_expires_at DATETIME NULL AFTER otp_code");
  await ensureColumn("users", "password_reset_otp_code", "password_reset_otp_code VARCHAR(6) NULL AFTER otp_expires_at");
  await ensureColumn("users", "password_reset_otp_expires_at", "password_reset_otp_expires_at DATETIME NULL AFTER password_reset_otp_code");
  await ensureColumn("users", "password_reset_verified_until", "password_reset_verified_until DATETIME NULL AFTER password_reset_otp_expires_at");
  await ensureColumn("users", "preferences", "preferences JSON NULL AFTER password_reset_verified_until");
  await ensureColumn("users", "last_active_at", "last_active_at DATETIME NULL AFTER preferences");
  await safeModifyColumn("users", "role", "role enum update", "ALTER TABLE users MODIFY role ENUM('admin','staff','customer') NOT NULL DEFAULT 'customer'");
  await safeModifyColumn("users", "email", "email nullable update", "ALTER TABLE users MODIFY email VARCHAR(160) NULL");
  await safeModifyColumn("users", "status", "status enum update", "ALTER TABLE users MODIFY status ENUM('pending_otp','pending','approved','rejected','suspended') NOT NULL DEFAULT 'pending_otp'");

  const storageTable = await getProductStorageTable();
  if (!(await baseTableExists(storageTable))) {
    await ensureTable(storageTable, `
      CREATE TABLE IF NOT EXISTS \`${storageTable}\` (
        id INT AUTO_INCREMENT PRIMARY KEY,
        sku VARCHAR(50) NULL,
        name VARCHAR(160) NOT NULL,
        brand VARCHAR(120) NOT NULL DEFAULT 'Other',
        category VARCHAR(80) NOT NULL DEFAULT 'T-Shirts',
        gender VARCHAR(80) DEFAULT 'Other',
        size VARCHAR(80) DEFAULT 'Free Size',
        color VARCHAR(80) NOT NULL DEFAULT 'Other',
        price DECIMAL(10,2) NOT NULL DEFAULT 0,
        stock INT NOT NULL DEFAULT 0,
        status VARCHAR(20) NOT NULL DEFAULT 'In Stock',
        image_url VARCHAR(255) NULL,
        image_data LONGBLOB NULL,
        image_mime VARCHAR(100) NULL,
        \`condition\` VARCHAR(120) NOT NULL DEFAULT 'Good',
        description TEXT NULL,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
        deleted_at DATETIME NULL,
        deleted_by INT NULL,
        sale_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        sale_discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
        sale_product_ids_json JSON NULL,
        sale_starts_at DATETIME NULL,
        sale_ends_at DATETIME NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        UNIQUE INDEX idx_${storageTable}_sku (sku),
        INDEX idx_${storageTable}_stock (stock),
        INDEX idx_${storageTable}_deleted (is_deleted)
      )
    `);
  }
  await ensureProductColumns(storageTable);
  await requireUsableAutoIncrementId(storageTable);
  await ensureProductAlias(storageTable);

  await ensureTable("product_additional_images", `
    CREATE TABLE IF NOT EXISTS product_additional_images (
      id INT AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL,
      image_data LONGBLOB NOT NULL,
      image_mime VARCHAR(100) NOT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_product_additional_images_product (product_id),
      INDEX idx_product_additional_images_order (product_id, sort_order, id)
    )
  `);

  await ensureTable("system_settings", `
    CREATE TABLE IF NOT EXISTS system_settings (
      id TINYINT PRIMARY KEY,
      config_json LONGTEXT NOT NULL,
      openai_api_key_encrypted TEXT NULL,
      shop_logo_data LONGBLOB NULL,
      shop_logo_mime VARCHAR(100) NULL,
      shop_logo_updated_at DATETIME NULL,
      gcash_qr_data LONGBLOB NULL,
      gcash_qr_mime VARCHAR(100) NULL,
      gcash_qr_updated_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  await ensureColumn("system_settings", "openai_api_key_encrypted", "openai_api_key_encrypted TEXT NULL AFTER config_json");
  await ensureColumn("system_settings", "shop_logo_data", "shop_logo_data LONGBLOB NULL AFTER openai_api_key_encrypted");
  await ensureColumn("system_settings", "shop_logo_mime", "shop_logo_mime VARCHAR(100) NULL AFTER shop_logo_data");
  await ensureColumn("system_settings", "shop_logo_updated_at", "shop_logo_updated_at DATETIME NULL AFTER shop_logo_mime");
  await ensureColumn("system_settings", "gcash_qr_data", "gcash_qr_data LONGBLOB NULL AFTER openai_api_key_encrypted");
  await ensureColumn("system_settings", "gcash_qr_mime", "gcash_qr_mime VARCHAR(100) NULL AFTER gcash_qr_data");
  await ensureColumn("system_settings", "gcash_qr_updated_at", "gcash_qr_updated_at DATETIME NULL AFTER gcash_qr_mime");

  await ensureTable("shipping_settings", `
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
      INDEX idx_shipping_settings_active (is_active, updated_at)
    )
  `);
  await ensureAutoIncrementId("shipping_settings");
  await ensureColumn("shipping_settings", "free_municipalities_json", "free_municipalities_json LONGTEXT NULL AFTER fixed_fee");
  await ensureColumn("shipping_settings", "free_radius_km", "free_radius_km DECIMAL(8,2) NOT NULL DEFAULT 15 AFTER free_municipalities_json");
  await ensureColumn("shipping_settings", "outside_area_fee", "outside_area_fee DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER free_radius_km");
  await safeDataMigration(
    "shipping_settings",
    "default free delivery municipalities",
    `UPDATE shipping_settings
     SET free_municipalities_json = '["Midsayap","Libungan","Pigcawayan"]'
     WHERE free_municipalities_json IS NULL OR TRIM(free_municipalities_json) = ''`
  );
  await safeDataMigration("shipping_settings", "legacy outside shipping fee", "UPDATE shipping_settings SET outside_area_fee = fixed_fee WHERE outside_area_fee = 0 AND fixed_fee > 0");

  for (const tableName of ["categories", "types", "sizes", "conditions", "brands", "colors"]) {
    await ensureTable(tableName, `
      CREATE TABLE IF NOT EXISTS \`${tableName}\` (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(120) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
        is_system BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_${tableName}_name (name)
      )
    `);
    await ensureAutoIncrementId(tableName);
    await ensureColumn(tableName, "is_system", "is_system BOOLEAN NOT NULL DEFAULT FALSE AFTER name");
    await ensureIndex(tableName, `uq_${tableName}_name`, `CREATE UNIQUE INDEX uq_${tableName}_name ON \`${tableName}\` (name)`, ["name"]);
  }

  await ensureTable("orders", `
    CREATE TABLE IF NOT EXISTS orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NULL,
      order_channel ENUM('online','pos') NOT NULL DEFAULT 'online',
      status ENUM('pending','awaiting_payment','paid','approved','processing','ready','completed','cancelled','payment_failed') NOT NULL DEFAULT 'pending',
      payment_method ENUM('cod','cash','gcash','qrph','debit','credit','maya') NOT NULL DEFAULT 'cod',
      payment_status ENUM('unpaid','awaiting_payment','paid','failed','cancelled','refunded') NOT NULL DEFAULT 'unpaid',
      payment_reference VARCHAR(160) NULL,
      transaction_id VARCHAR(160) NULL,
      paid_at DATETIME NULL,
      payment_provider VARCHAR(40) NULL,
      checkout_session_id VARCHAR(160) NULL,
      checkout_url TEXT NULL,
      payment_intent_id VARCHAR(160) NULL,
      payment_method_id VARCHAR(160) NULL,
      qr_code_url LONGTEXT NULL,
      payment_expires_at DATETIME NULL,
      tracking_number VARCHAR(120) NULL,
      fulfillment_method ENUM('delivery','pickup') NOT NULL DEFAULT 'delivery',
      delivery_address VARCHAR(500) NULL,
      delivery_latitude DECIMAL(10,7) NULL,
      delivery_longitude DECIMAL(10,7) NULL,
      delivery_municipality VARCHAR(160) NULL,
      delivery_province VARCHAR(160) NULL,
      delivery_region VARCHAR(160) NULL,
      delivery_postal_code VARCHAR(20) NULL,
      delivery_place_id VARCHAR(255) NULL,
      delivery_landmark VARCHAR(255) NULL,
      delivery_notes TEXT NULL,
      subtotal_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      coupon_discount DECIMAL(10,2) NOT NULL DEFAULT 0,
      sale_discount DECIMAL(10,2) NOT NULL DEFAULT 0,
      shipping_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
      shipping_zone VARCHAR(20) NULL,
      shipping_distance_km DECIMAL(10,2) NULL,
      shipping_rule VARCHAR(40) NULL,
      coupon_code VARCHAR(40) NULL,
      total_amount DECIMAL(10,2) NOT NULL DEFAULT 0,
      cash_received DECIMAL(10,2) NULL,
      change_amount DECIMAL(10,2) NULL,
      pos_cashier_id INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_orders_user (user_id),
      INDEX idx_orders_status (status),
      INDEX idx_orders_created (created_at)
    )
  `);
  await ensureAutoIncrementId("orders");
  await safeModifyColumn("orders", "status", "status enum update", "ALTER TABLE orders MODIFY status ENUM('pending','awaiting_payment','paid','approved','processing','ready','completed','cancelled','payment_failed') NOT NULL DEFAULT 'pending'");
  await safeModifyColumn("orders", "payment_method", "payment_method enum update", "ALTER TABLE orders MODIFY payment_method ENUM('cod','cash','gcash','qrph','debit','credit','maya') NOT NULL DEFAULT 'cod'");
  await ensureColumn("orders", "order_channel", "order_channel ENUM('online','pos') NOT NULL DEFAULT 'online' AFTER user_id");
  await ensureColumn("orders", "payment_status", "payment_status ENUM('unpaid','awaiting_payment','paid','failed','cancelled','refunded') NOT NULL DEFAULT 'unpaid' AFTER payment_method");
  await ensureColumn("orders", "payment_reference", "payment_reference VARCHAR(160) NULL AFTER payment_status");
  await ensureColumn("orders", "transaction_id", "transaction_id VARCHAR(160) NULL AFTER payment_reference");
  await ensureColumn("orders", "paid_at", "paid_at DATETIME NULL AFTER transaction_id");
  await ensureColumn("orders", "payment_provider", "payment_provider VARCHAR(40) NULL AFTER paid_at");
  await ensureColumn("orders", "checkout_session_id", "checkout_session_id VARCHAR(160) NULL AFTER payment_provider");
  await ensureColumn("orders", "checkout_url", "checkout_url TEXT NULL AFTER checkout_session_id");
  await ensureColumn("orders", "payment_intent_id", "payment_intent_id VARCHAR(160) NULL AFTER checkout_session_id");
  await ensureColumn("orders", "payment_method_id", "payment_method_id VARCHAR(160) NULL AFTER payment_intent_id");
  await ensureColumn("orders", "qr_code_url", "qr_code_url LONGTEXT NULL AFTER checkout_url");
  await ensureColumn("orders", "payment_expires_at", "payment_expires_at DATETIME NULL AFTER qr_code_url");
  await ensureColumn("orders", "tracking_number", "tracking_number VARCHAR(120) NULL AFTER checkout_url");
  await ensureColumn("orders", "fulfillment_method", "fulfillment_method ENUM('delivery','pickup') NOT NULL DEFAULT 'delivery' AFTER tracking_number");
  await ensureColumn("orders", "delivery_address", "delivery_address VARCHAR(500) NULL AFTER fulfillment_method");
  await ensureColumn("orders", "delivery_latitude", "delivery_latitude DECIMAL(10,7) NULL AFTER delivery_address");
  await ensureColumn("orders", "delivery_longitude", "delivery_longitude DECIMAL(10,7) NULL AFTER delivery_latitude");
  await ensureColumn("orders", "delivery_municipality", "delivery_municipality VARCHAR(160) NULL AFTER delivery_longitude");
  await ensureColumn("orders", "delivery_province", "delivery_province VARCHAR(160) NULL AFTER delivery_municipality");
  await ensureColumn("orders", "delivery_region", "delivery_region VARCHAR(160) NULL AFTER delivery_province");
  await ensureColumn("orders", "delivery_postal_code", "delivery_postal_code VARCHAR(20) NULL AFTER delivery_region");
  await ensureColumn("orders", "delivery_place_id", "delivery_place_id VARCHAR(255) NULL AFTER delivery_postal_code");
  await ensureColumn("orders", "delivery_landmark", "delivery_landmark VARCHAR(255) NULL AFTER delivery_longitude");
  await ensureColumn("orders", "delivery_notes", "delivery_notes TEXT NULL AFTER delivery_landmark");
  await ensureColumn("orders", "subtotal_amount", "subtotal_amount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER fulfillment_method");
  await ensureColumn("orders", "coupon_discount", "coupon_discount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER subtotal_amount");
  await ensureColumn("orders", "sale_discount", "sale_discount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER coupon_discount");
  await ensureColumn("orders", "shipping_fee", "shipping_fee DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER sale_discount");
  await ensureColumn("orders", "shipping_zone", "shipping_zone VARCHAR(20) NULL AFTER shipping_fee");
  await ensureColumn("orders", "shipping_distance_km", "shipping_distance_km DECIMAL(10,2) NULL AFTER shipping_zone");
  await ensureColumn("orders", "shipping_rule", "shipping_rule VARCHAR(40) NULL AFTER shipping_distance_km");
  await ensureColumn("orders", "coupon_code", "coupon_code VARCHAR(40) NULL AFTER shipping_fee");
  await ensureColumn("orders", "total_amount", "total_amount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER coupon_code");
  await ensureColumn("orders", "cash_received", "cash_received DECIMAL(10,2) NULL AFTER total_amount");
  await ensureColumn("orders", "change_amount", "change_amount DECIMAL(10,2) NULL AFTER cash_received");
  await ensureColumn("orders", "pos_cashier_id", "pos_cashier_id INT NULL AFTER change_amount");

  await ensureTable("cart_items", `
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
  `);
  await ensureAutoIncrementId("cart_items");
  await ensureColumn("cart_items", "selected", "selected BOOLEAN NOT NULL DEFAULT TRUE AFTER quantity");
  await ensureColumn("cart_items", "checked_out_at", "checked_out_at DATETIME NULL AFTER selected");
  await ensureIndex("cart_items", "uq_cart_user_product", "CREATE UNIQUE INDEX uq_cart_user_product ON cart_items (user_id, product_id)", ["user_id", "product_id"]);

  await ensureTable("order_items", `
    CREATE TABLE IF NOT EXISTS order_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      product_id INT NOT NULL,
      quantity INT NOT NULL,
      price DECIMAL(10,2) NOT NULL,
      INDEX idx_order_items_order (order_id),
      INDEX idx_order_items_product (product_id)
    )
  `);
  await ensureAutoIncrementId("order_items");

  await ensureTable("inventory", `
    CREATE TABLE IF NOT EXISTS inventory (
      id INT AUTO_INCREMENT PRIMARY KEY,
      product_id INT NOT NULL,
      quantity INT NOT NULL DEFAULT 0,
      adjustment_type VARCHAR(40) NOT NULL DEFAULT 'manual',
      note VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_inventory_product (product_id),
      INDEX idx_inventory_created (created_at)
    )
  `);
  await ensureAutoIncrementId("inventory");
}

async function ensureCommunicationTables() {
  await ensureTable("identity_verifications", `
    CREATE TABLE IF NOT EXISTS identity_verifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      id_type VARCHAR(80) NOT NULL,
      id_number VARCHAR(120) NOT NULL,
      id_image VARCHAR(255) NULL,
      government_id_data LONGBLOB NULL,
      government_id_mime VARCHAR(100) NULL,
      selfie_image VARCHAR(255) NULL,
      selfie_data LONGBLOB NULL,
      selfie_mime VARCHAR(100) NULL,
      face_match_score DECIMAL(5,2) NOT NULL DEFAULT 0,
      otp_verified BOOLEAN NOT NULL DEFAULT false,
      identity_verified BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_identity_user (user_id),
      UNIQUE KEY uq_identity_id_number (id_number)
    )
  `);
  await ensureAutoIncrementId("identity_verifications");
  await ensureColumn("identity_verifications", "government_id_data", "government_id_data LONGBLOB NULL AFTER id_image");
  await ensureColumn("identity_verifications", "government_id_mime", "government_id_mime VARCHAR(100) NULL AFTER government_id_data");
  await ensureColumn("identity_verifications", "selfie_data", "selfie_data LONGBLOB NULL AFTER selfie_image");
  await ensureColumn("identity_verifications", "selfie_mime", "selfie_mime VARCHAR(100) NULL AFTER selfie_data");
  await ensureIndex("identity_verifications", "uq_identity_id_number", "CREATE UNIQUE INDEX uq_identity_id_number ON identity_verifications (id_number)", ["id_number"]);

  await ensureTable("otp_codes", `
    CREATE TABLE IF NOT EXISTS otp_codes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      contact VARCHAR(160) NOT NULL,
      purpose VARCHAR(40) NOT NULL DEFAULT 'registration',
      otp_code VARCHAR(6) NOT NULL,
      expires_at DATETIME NOT NULL,
      resend_available_at DATETIME NOT NULL,
      attempts INT NOT NULL DEFAULT 0,
      max_attempts INT NOT NULL DEFAULT 5,
      consumed_at DATETIME NULL,
      registration_payload JSON NULL,
      id_image_path VARCHAR(255) NULL,
      id_image_data LONGBLOB NULL,
      id_image_mime VARCHAR(100) NULL,
      selfie_image_path VARCHAR(255) NULL,
      selfie_image_data LONGBLOB NULL,
      selfie_image_mime VARCHAR(100) NULL,
      face_match_score DECIMAL(5,2) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_otp_contact_purpose (contact, purpose),
      INDEX idx_otp_expires (expires_at)
    )
  `);
  await ensureAutoIncrementId("otp_codes");
  await ensureColumn("otp_codes", "id_image_data", "id_image_data LONGBLOB NULL AFTER id_image_path");
  await ensureColumn("otp_codes", "id_image_mime", "id_image_mime VARCHAR(100) NULL AFTER id_image_data");
  await ensureColumn("otp_codes", "selfie_image_data", "selfie_image_data LONGBLOB NULL AFTER selfie_image_path");
  await ensureColumn("otp_codes", "selfie_image_mime", "selfie_image_mime VARCHAR(100) NULL AFTER selfie_image_data");

  await ensureTable("conversations", `
    CREATE TABLE IF NOT EXISTS conversations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      customer_id INT NOT NULL,
      admin_takeover BOOLEAN NOT NULL DEFAULT FALSE,
      ai_processing BOOLEAN NOT NULL DEFAULT FALSE,
      is_archived BOOLEAN NOT NULL DEFAULT FALSE,
      archived_at DATETIME NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
      deleted_at DATETIME NULL,
      deleted_by INT NULL,
      last_ai_provider VARCHAR(20) NULL,
      last_ai_response_time_ms INT NULL,
      last_ai_token_usage INT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_conversations_customer (customer_id)
    )
  `);
  await ensureAutoIncrementId("conversations");
  await ensureColumn("conversations", "ai_processing", "ai_processing BOOLEAN NOT NULL DEFAULT FALSE AFTER admin_takeover");
  await ensureColumn("conversations", "is_archived", "is_archived BOOLEAN NOT NULL DEFAULT FALSE AFTER ai_processing");
  await ensureColumn("conversations", "archived_at", "archived_at DATETIME NULL AFTER is_archived");
  await ensureColumn("conversations", "is_deleted", "is_deleted BOOLEAN NOT NULL DEFAULT FALSE AFTER archived_at");
  await ensureColumn("conversations", "deleted_at", "deleted_at DATETIME NULL AFTER is_deleted");
  await ensureColumn("conversations", "deleted_by", "deleted_by INT NULL AFTER deleted_at");
  await ensureColumn("conversations", "last_ai_provider", "last_ai_provider VARCHAR(20) NULL AFTER deleted_by");
  await ensureColumn("conversations", "last_ai_response_time_ms", "last_ai_response_time_ms INT NULL AFTER last_ai_provider");
  await ensureColumn("conversations", "last_ai_token_usage", "last_ai_token_usage INT NULL AFTER last_ai_response_time_ms");

  await ensureTable("messages", `
    CREATE TABLE IF NOT EXISTS messages (
      id INT AUTO_INCREMENT PRIMARY KEY,
      conversation_id INT NOT NULL,
      sender_id INT NULL,
      sender_type ENUM('customer','admin','ai') NOT NULL,
      mode ENUM('ai','admin') NOT NULL DEFAULT 'admin',
      ai_provider VARCHAR(20) NULL,
      response_time_ms INT NULL,
      token_usage INT NULL,
      product_action JSON NULL,
      body TEXT NOT NULL,
      delivery_status ENUM('sent','delivered','seen') NOT NULL DEFAULT 'sent',
      delivered_at DATETIME NULL,
      seen_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_messages_conversation (conversation_id)
    )
  `);
  await ensureAutoIncrementId("messages");
  await ensureColumn("messages", "mode", "mode ENUM('ai','admin') NOT NULL DEFAULT 'admin' AFTER sender_type");
  await ensureColumn("messages", "ai_provider", "ai_provider VARCHAR(20) NULL AFTER mode");
  await ensureColumn("messages", "response_time_ms", "response_time_ms INT NULL AFTER ai_provider");
  await ensureColumn("messages", "token_usage", "token_usage INT NULL AFTER response_time_ms");
  await ensureColumn("messages", "product_action", "product_action JSON NULL AFTER token_usage");
  await ensureColumn("messages", "delivery_status", "delivery_status ENUM('sent','delivered','seen') NOT NULL DEFAULT 'sent' AFTER body");
  await ensureColumn("messages", "delivered_at", "delivered_at DATETIME NULL AFTER delivery_status");
  await ensureColumn("messages", "seen_at", "seen_at DATETIME NULL AFTER delivered_at");

  await ensureTable("broadcasts", `
    CREATE TABLE IF NOT EXISTS broadcasts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      title VARCHAR(160) NOT NULL,
      message TEXT NOT NULL,
      image_url VARCHAR(255) NULL,
      image_urls_json JSON NULL,
      promo_code VARCHAR(80) NULL,
      audience ENUM('all_customers','by_location','by_product_interest','active_customers','new_customers','customers_with_orders','vip_customers') NOT NULL DEFAULT 'all_customers',
      audience_filter VARCHAR(160) NULL,
      broadcast_type ENUM('new_arrival','new_product_drop','promo_sale','flash_sale','restock_alert','holiday_promo','order_update','event_announcement','ai_marketing_campaign') NOT NULL DEFAULT 'promo_sale',
      status ENUM('draft','scheduled','sending','sent','failed') NOT NULL DEFAULT 'draft',
      channels_json JSON NOT NULL,
      scheduled_at DATETIME NULL,
      sent_at DATETIME NULL,
      ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
      created_by INT NULL,
      is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
      deleted_at DATETIME NULL,
      deleted_by INT NULL,
      sale_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      sale_discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0,
      sale_product_ids_json JSON NULL,
      sale_starts_at DATETIME NULL,
      sale_ends_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_broadcasts_status_schedule (status, scheduled_at),
      INDEX idx_broadcasts_created (created_at)
    )
  `);
  await ensureAutoIncrementId("broadcasts");
  await requireUsableAutoIncrementId("broadcasts");
  await ensureColumn("broadcasts", "audience_filter", "audience_filter VARCHAR(160) NULL AFTER audience");
  await ensureColumn("broadcasts", "image_urls_json", "image_urls_json JSON NULL AFTER image_url");
  await ensureColumn("broadcasts", "is_deleted", "is_deleted BOOLEAN NOT NULL DEFAULT FALSE AFTER created_by");
  await ensureColumn("broadcasts", "deleted_at", "deleted_at DATETIME NULL AFTER is_deleted");
  await ensureColumn("broadcasts", "deleted_by", "deleted_by INT NULL AFTER deleted_at");
  await ensureColumn("broadcasts", "sale_enabled", "sale_enabled BOOLEAN NOT NULL DEFAULT FALSE AFTER deleted_by");
  await ensureColumn("broadcasts", "sale_discount_percent", "sale_discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER sale_enabled");
  await ensureColumn("broadcasts", "sale_product_ids_json", "sale_product_ids_json JSON NULL AFTER sale_discount_percent");
  await ensureColumn("broadcasts", "sale_starts_at", "sale_starts_at DATETIME NULL AFTER sale_product_ids_json");
  await ensureColumn("broadcasts", "sale_ends_at", "sale_ends_at DATETIME NULL AFTER sale_starts_at");

  await ensureTable("notifications", `
    CREATE TABLE IF NOT EXISTS notifications (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NULL,
      product_id INT NULL,
      broadcast_id INT NULL,
      type ENUM('approval','customer_registration','registration','order','order_cancelled','payment','message','feedback','refund','return','new_product','inventory','system','broadcast') NOT NULL,
      title VARCHAR(160) NOT NULL,
      body VARCHAR(255) NOT NULL,
      is_read BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_notifications_user (user_id),
      INDEX idx_notifications_read (is_read),
      INDEX idx_notifications_broadcast (broadcast_id)
    )
  `);
  await ensureAutoIncrementId("notifications");
  await ensureColumn("notifications", "broadcast_id", "broadcast_id INT NULL AFTER product_id");
  await ensureIndex("notifications", "idx_notifications_broadcast", "CREATE INDEX idx_notifications_broadcast ON notifications (broadcast_id)", ["broadcast_id"]);
  await safeModifyColumn("notifications", "type", "type enum update", "ALTER TABLE notifications MODIFY type ENUM('approval','customer_registration','registration','order','order_cancelled','payment','message','feedback','refund','return','new_product','inventory','system','broadcast') NOT NULL");

  await ensureTable("broadcast_deliveries", `
    CREATE TABLE IF NOT EXISTS broadcast_deliveries (
      id INT AUTO_INCREMENT PRIMARY KEY,
      broadcast_id INT NOT NULL,
      user_id INT NOT NULL,
      notification_id INT NULL,
      channel ENUM('in_app','email','sms','ai_chat') NOT NULL,
      delivery_status ENUM('sent','failed','skipped') NOT NULL DEFAULT 'sent',
      delivered_at DATETIME NULL,
      opened_at DATETIME NULL,
      clicked_at DATETIME NULL,
      error_message VARCHAR(255) NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_broadcast_deliveries_broadcast (broadcast_id),
      INDEX idx_broadcast_deliveries_user (user_id),
      INDEX idx_broadcast_deliveries_notification (notification_id)
    )
  `);
  await ensureAutoIncrementId("broadcast_deliveries");

  await ensureTable("reviews", `
    CREATE TABLE IF NOT EXISTS reviews (
      id INT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NOT NULL,
      customer_id INT NULL,
      order_id INT NULL,
      product_id INT NULL,
      brand_id INT NULL,
      brand_name VARCHAR(120) NULL,
      product_name VARCHAR(180) NULL,
      order_number VARCHAR(40) NULL,
      amount_paid DECIMAL(10,2) NULL,
      rating TINYINT NOT NULL,
      category VARCHAR(80) NOT NULL DEFAULT 'Overall Experience',
      comment TEXT NOT NULL,
      image_url VARCHAR(255) NULL,
      image_urls_json JSON NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_reviews_user (user_id),
      INDEX idx_reviews_customer (customer_id),
      INDEX idx_reviews_order (order_id),
      INDEX idx_reviews_product (product_id)
    )
  `);
  await ensureAutoIncrementId("reviews");
  await ensureColumn("reviews", "image_urls_json", "image_urls_json JSON NULL AFTER image_url");

  await ensureTable("returns", `
    CREATE TABLE IF NOT EXISTS returns (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      user_id INT NOT NULL,
      customer_id INT NULL,
      product_id INT NULL,
      brand_id INT NULL,
      brand_name VARCHAR(120) NULL,
      product_name VARCHAR(180) NULL,
      order_number VARCHAR(40) NULL,
      amount DECIMAL(10,2) NULL,
      reason TEXT NOT NULL,
      reason_category VARCHAR(80) NOT NULL DEFAULT 'Other',
      refund_type VARCHAR(40) NOT NULL DEFAULT 'Refund',
      shipping_fee DECIMAL(10,2) NOT NULL DEFAULT 0,
      estimated_refund DECIMAL(10,2) NOT NULL DEFAULT 0,
      image_url VARCHAR(255) NULL,
      proof_images JSON NULL,
      status ENUM('pending','under_review','approved','rejected','refunded') NOT NULL DEFAULT 'pending',
      admin_note TEXT NULL,
      decided_at DATETIME NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_returns_order (order_id),
      INDEX idx_returns_user (user_id),
      INDEX idx_returns_customer (customer_id),
      INDEX idx_returns_product (product_id),
      INDEX idx_returns_status (status)
    )
  `);
  await ensureAutoIncrementId("returns");
  await safeModifyColumn("returns", "status", "status enum update", "ALTER TABLE returns MODIFY status ENUM('pending','under_review','approved','rejected','refunded') NOT NULL DEFAULT 'pending'");

  await ensureTable("pos_transaction_logs", `
    CREATE TABLE IF NOT EXISTS pos_transaction_logs (
      id INT AUTO_INCREMENT PRIMARY KEY,
      order_id INT NOT NULL,
      transaction_number VARCHAR(160) NOT NULL,
      cashier_id INT NULL,
      payment_method ENUM('cash','gcash') NOT NULL,
      total_amount DECIMAL(10,2) NOT NULL,
      cash_received DECIMAL(10,2) NULL,
      change_amount DECIMAL(10,2) NULL,
      gcash_reference_number VARCHAR(160) NULL,
      payment_received_at DATETIME NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_pos_logs_order (order_id),
      INDEX idx_pos_logs_transaction (transaction_number),
      INDEX idx_pos_logs_payment (payment_method)
    )
  `);
  await ensureAutoIncrementId("pos_transaction_logs");
}

async function seedMissingOptionData() {
  const defaults = {
    categories: ["T-Shirts", "Jackets", "Caps", "Other"],
    types: ["Men", "Women", "Kids", "Vintage", "Oversized", "Streetwear", "Sportswear", "Formal", "Casual", "Unisex", "Other"],
    sizes: ["XS", "S", "M", "L", "XL", "XXL", "Free Size", "Other"],
    conditions: ["Like New", "Excellent", "Very Good", "Good", "Fair", "Other"],
    brands: ["Adidas", "Nike", "Lacoste", "Essentials", "Uniqlo", "H&M", "Zara", "Bench", "Penshoppe", "Champion", "Puma", "Reebok", "Under Armour", "Jordan", "Levi's", "Ralph Lauren", "Tommy Hilfiger", "GAP", "Old Navy", "Dickies", "Carhartt", "Stussy", "Converse", "Vans", "New Balance", "Gildan", "Hanes", "Fruit of the Loom", "Blue Corner", "Regatta", "Other"],
    colors: ["Black", "White", "Gray", "Red", "Blue", "Green", "Yellow", "Brown", "Pink", "Purple", "Orange", "Other"]
  };
  for (const [tableName, names] of Object.entries(defaults)) {
    for (const name of names) {
      await safeDataMigration(
        tableName,
        `default option seed "${name}"`,
        `INSERT INTO \`${tableName}\` (name, is_system)
         SELECT :name, TRUE
         WHERE NOT EXISTS (
           SELECT 1 FROM \`${tableName}\` WHERE LOWER(name) = LOWER(:name)
         )`,
        { name }
      );
      await safeDataMigration(
        tableName,
        `default option protect "${name}"`,
        `UPDATE \`${tableName}\` SET is_system = TRUE WHERE LOWER(name) = LOWER(:name)`,
        { name }
      );
    }
  }
}

export async function initializeDatabase() {
  await testDatabaseConnection();
  await ensureCoreTables();
  await ensureCommunicationTables();
  await seedMissingOptionData();
  console.log("Retela database bootstrap complete");
}
