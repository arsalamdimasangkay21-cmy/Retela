-- Retela production identity and barcode repair.
-- Run manually on Railway MySQL after taking a database backup.
-- This script is non-deleting. It aborts if duplicate/invalid IDs make an automatic repair unsafe.
--
-- Inspection queries to run before this migration:
-- SHOW CREATE TABLE products;
-- DESCRIBE products;
-- SHOW INDEX FROM products;
-- SHOW CREATE TABLE apparel_items;
-- DESCRIBE apparel_items;
-- SHOW INDEX FROM apparel_items;
-- SHOW CREATE TABLE broadcasts;
-- DESCRIBE broadcasts;
-- SHOW INDEX FROM broadcasts;
--
-- Duplicate checks to review before adding unique barcode indexes:
-- SELECT sku, COUNT(*) AS duplicate_count FROM products WHERE sku IS NOT NULL AND TRIM(sku) <> '' GROUP BY sku HAVING COUNT(*) > 1;
-- SELECT sku, COUNT(*) AS duplicate_count FROM apparel_items WHERE sku IS NOT NULL AND TRIM(sku) <> '' GROUP BY sku HAVING COUNT(*) > 1;

DROP PROCEDURE IF EXISTS retela_repair_identity;
DROP PROCEDURE IF EXISTS retela_repair_product_barcode;
DROP PROCEDURE IF EXISTS retela_add_unique_index_if_absent;

DELIMITER //

CREATE PROCEDURE retela_repair_identity(IN table_name_value VARCHAR(64))
BEGIN
  DECLARE table_exists_count INT DEFAULT 0;
  DECLARE table_type_value VARCHAR(32) DEFAULT NULL;
  DECLARE invalid_id_count INT DEFAULT 0;
  DECLARE duplicate_id_count INT DEFAULT 0;
  DECLARE pk_columns_value TEXT DEFAULT '';
  DECLARE auto_columns_value TEXT DEFAULT '';
  DECLARE old_pk_columns_value TEXT DEFAULT '';

  SELECT COUNT(*), MAX(TABLE_TYPE)
    INTO table_exists_count, table_type_value
  FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = table_name_value;

  IF table_exists_count = 0 OR table_type_value <> 'BASE TABLE' THEN
    SELECT CONCAT('Skipping ', table_name_value, ': table is missing or is not a base table') AS migration_note;
  ELSE
    IF NOT EXISTS (
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = table_name_value
        AND COLUMN_NAME = 'id'
    ) THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Identity repair aborted: id column is missing';
    END IF;

    SET @retela_sql = CONCAT(
      'SELECT ',
      'SUM(id IS NULL OR id <= 0), ',
      'COUNT(*) - COUNT(DISTINCT id) ',
      'INTO @retela_invalid_id_count, @retela_duplicate_id_count ',
      'FROM `', table_name_value, '`'
    );
    PREPARE retela_stmt FROM @retela_sql;
    EXECUTE retela_stmt;
    DEALLOCATE PREPARE retela_stmt;
    SET invalid_id_count = COALESCE(@retela_invalid_id_count, 0);
    SET duplicate_id_count = COALESCE(@retela_duplicate_id_count, 0);

    IF invalid_id_count > 0 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Identity repair aborted: table has NULL, zero, or negative IDs';
    END IF;

    IF duplicate_id_count > 0 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Identity repair aborted: table has duplicate IDs';
    END IF;

    SELECT COALESCE(GROUP_CONCAT(CONCAT('`', COLUMN_NAME, '`') ORDER BY ORDINAL_POSITION), '')
      INTO old_pk_columns_value
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = table_name_value
      AND CONSTRAINT_NAME = 'PRIMARY';

    SELECT COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION), '')
      INTO pk_columns_value
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = table_name_value
      AND CONSTRAINT_NAME = 'PRIMARY';

    SELECT COALESCE(GROUP_CONCAT(COLUMN_NAME ORDER BY ORDINAL_POSITION), '')
      INTO auto_columns_value
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = table_name_value
      AND EXTRA LIKE '%auto_increment%';

    IF auto_columns_value <> '' AND auto_columns_value <> 'id' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Identity repair aborted: another AUTO_INCREMENT column exists';
    END IF;

    IF pk_columns_value <> '' AND pk_columns_value <> 'id' THEN
      SET @retela_unique_name = CONCAT('uq_', table_name_value, '_previous_primary');
      IF NOT EXISTS (
        SELECT 1
        FROM INFORMATION_SCHEMA.STATISTICS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = table_name_value
          AND INDEX_NAME = @retela_unique_name
      ) THEN
        SET @retela_sql = CONCAT('ALTER TABLE `', table_name_value, '` ADD UNIQUE INDEX `', @retela_unique_name, '` (', old_pk_columns_value, ')');
        PREPARE retela_stmt FROM @retela_sql;
        EXECUTE retela_stmt;
        DEALLOCATE PREPARE retela_stmt;
      END IF;
      SET @retela_sql = CONCAT('ALTER TABLE `', table_name_value, '` DROP PRIMARY KEY');
      PREPARE retela_stmt FROM @retela_sql;
      EXECUTE retela_stmt;
      DEALLOCATE PREPARE retela_stmt;
    END IF;

    IF pk_columns_value <> 'id' THEN
      SET @retela_sql = CONCAT('ALTER TABLE `', table_name_value, '` ADD PRIMARY KEY (id)');
      PREPARE retela_stmt FROM @retela_sql;
      EXECUTE retela_stmt;
      DEALLOCATE PREPARE retela_stmt;
    END IF;

    SET @retela_sql = CONCAT('ALTER TABLE `', table_name_value, '` MODIFY id INT UNSIGNED NOT NULL AUTO_INCREMENT');
    PREPARE retela_stmt FROM @retela_sql;
    EXECUTE retela_stmt;
    DEALLOCATE PREPARE retela_stmt;
  END IF;
END //

CREATE PROCEDURE retela_repair_product_barcode(IN table_name_value VARCHAR(64))
BEGIN
  DECLARE table_exists_count INT DEFAULT 0;
  DECLARE table_type_value VARCHAR(32) DEFAULT NULL;

  SELECT COUNT(*), MAX(TABLE_TYPE)
    INTO table_exists_count, table_type_value
  FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = table_name_value;

  IF table_exists_count > 0 AND table_type_value = 'BASE TABLE' THEN
    IF NOT EXISTS (
      SELECT 1
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = table_name_value
        AND COLUMN_NAME = 'sku'
    ) THEN
      SET @retela_sql = CONCAT('ALTER TABLE `', table_name_value, '` ADD COLUMN sku VARCHAR(50) NULL AFTER id');
      PREPARE retela_stmt FROM @retela_sql;
      EXECUTE retela_stmt;
      DEALLOCATE PREPARE retela_stmt;
    END IF;

    SET @retela_sql = CONCAT('ALTER TABLE `', table_name_value, '` MODIFY sku VARCHAR(50) NULL');
    PREPARE retela_stmt FROM @retela_sql;
    EXECUTE retela_stmt;
    DEALLOCATE PREPARE retela_stmt;

    SET @retela_sql = CONCAT(
      'UPDATE `', table_name_value, '` ',
      'SET sku = CONCAT(''RETELA-'', LPAD(id, 6, ''0'')) ',
      'WHERE id IS NOT NULL AND id > 0 ',
      'AND (sku IS NULL OR TRIM(sku) = '''' OR sku = ''RETELA-000000'')'
    );
    PREPARE retela_stmt FROM @retela_sql;
    EXECUTE retela_stmt;
    DEALLOCATE PREPARE retela_stmt;
  END IF;
END //

CREATE PROCEDURE retela_add_unique_index_if_absent(
  IN table_name_value VARCHAR(64),
  IN index_name_value VARCHAR(64),
  IN column_name_value VARCHAR(64)
)
BEGIN
  DECLARE duplicate_count INT DEFAULT 0;
  DECLARE table_exists_count INT DEFAULT 0;
  DECLARE table_type_value VARCHAR(32) DEFAULT NULL;

  SELECT COUNT(*), MAX(TABLE_TYPE)
    INTO table_exists_count, table_type_value
  FROM INFORMATION_SCHEMA.TABLES
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = table_name_value;

  IF table_exists_count > 0 AND table_type_value = 'BASE TABLE' THEN
    SET @retela_sql = CONCAT(
      'SELECT COUNT(*) INTO @retela_duplicate_barcode_count FROM (',
      'SELECT `', column_name_value, '` FROM `', table_name_value, '` ',
      'WHERE `', column_name_value, '` IS NOT NULL AND TRIM(`', column_name_value, '`) <> '''' ',
      'GROUP BY `', column_name_value, '` HAVING COUNT(*) > 1',
      ') duplicates'
    );
    PREPARE retela_stmt FROM @retela_sql;
    EXECUTE retela_stmt;
    DEALLOCATE PREPARE retela_stmt;
    SET duplicate_count = COALESCE(@retela_duplicate_barcode_count, 0);

    IF duplicate_count > 0 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'Unique index repair aborted: duplicate barcode values remain';
    END IF;

    IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = table_name_value
      AND INDEX_NAME = index_name_value
    ) THEN
      SET @retela_sql = CONCAT('CREATE UNIQUE INDEX `', index_name_value, '` ON `', table_name_value, '` (`', column_name_value, '`)');
      PREPARE retela_stmt FROM @retela_sql;
      EXECUTE retela_stmt;
      DEALLOCATE PREPARE retela_stmt;
    END IF;
  END IF;
END //

DELIMITER ;

CALL retela_repair_identity('products');
CALL retela_repair_identity('apparel_items');
CALL retela_repair_identity('broadcasts');

CALL retela_repair_product_barcode('products');
CALL retela_repair_product_barcode('apparel_items');

CALL retela_add_unique_index_if_absent('products', 'idx_products_sku', 'sku');
CALL retela_add_unique_index_if_absent('apparel_items', 'idx_apparel_items_sku', 'sku');

DROP PROCEDURE retela_repair_identity;
DROP PROCEDURE retela_repair_product_barcode;
DROP PROCEDURE retela_add_unique_index_if_absent;
