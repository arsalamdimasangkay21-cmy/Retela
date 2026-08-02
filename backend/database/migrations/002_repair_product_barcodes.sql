-- Repair Retela apparel/product barcode values.
-- The current application stores barcode values in the product `sku` column.
-- Non-destructive: existing unique, valid sku values are preserved.

DROP PROCEDURE IF EXISTS retela_repair_product_barcodes;

DELIMITER //

CREATE PROCEDURE retela_repair_product_barcodes(IN table_name_value VARCHAR(64))
BEGIN
  IF EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.TABLES
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = table_name_value
      AND TABLE_TYPE = 'BASE TABLE'
  ) THEN
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
      'WHERE sku IS NULL OR TRIM(sku) = '''' OR sku = ''RETELA-000000'''
    );
    PREPARE retela_stmt FROM @retela_sql;
    EXECUTE retela_stmt;
    DEALLOCATE PREPARE retela_stmt;

    SET @retela_sql = CONCAT(
      'UPDATE `', table_name_value, '` target ',
      'JOIN (',
      '  SELECT id, sku, ',
      '         ROW_NUMBER() OVER (PARTITION BY sku ORDER BY id) AS duplicate_rank, ',
      '         COUNT(*) OVER (PARTITION BY sku) AS duplicate_count ',
      '  FROM `', table_name_value, '` ',
      '  WHERE sku IS NOT NULL AND TRIM(sku) <> ''''',
      ') duplicates ON duplicates.id = target.id ',
      'SET target.sku = CONCAT(''RETELA-'', LPAD(target.id, 6, ''0'')) ',
      'WHERE duplicates.duplicate_count > 1 AND duplicates.duplicate_rank > 1'
    );
    PREPARE retela_stmt FROM @retela_sql;
    EXECUTE retela_stmt;
    DEALLOCATE PREPARE retela_stmt;

    IF NOT EXISTS (
      SELECT 1
      FROM INFORMATION_SCHEMA.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
        AND TABLE_NAME = table_name_value
        AND COLUMN_NAME = 'sku'
        AND NON_UNIQUE = 0
    ) THEN
      SET @retela_sql = CONCAT('CREATE UNIQUE INDEX idx_', table_name_value, '_sku ON `', table_name_value, '` (sku)');
      PREPARE retela_stmt FROM @retela_sql;
      EXECUTE retela_stmt;
      DEALLOCATE PREPARE retela_stmt;
    END IF;
  END IF;
END //

DELIMITER ;

CALL retela_repair_product_barcodes('products');
CALL retela_repair_product_barcodes('apparel_items');

DROP PROCEDURE retela_repair_product_barcodes;
