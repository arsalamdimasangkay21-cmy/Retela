-- Retela messaging identity repair.
-- Run manually on production MySQL after taking a database backup.
-- This script is non-deleting. It aborts if duplicate/invalid IDs make repair unsafe.
--
-- Inspection queries to run before this migration:
-- SHOW CREATE TABLE conversations;
-- DESCRIBE conversations;
-- SHOW INDEX FROM conversations;
-- SHOW CREATE TABLE messages;
-- DESCRIBE messages;
-- SHOW INDEX FROM messages;

DROP PROCEDURE IF EXISTS retela_repair_messaging_identity;
DROP PROCEDURE IF EXISTS retela_drop_fk_if_exists;
DROP PROCEDURE IF EXISTS retela_add_fk_if_missing;

DELIMITER //

CREATE PROCEDURE retela_drop_fk_if_exists(
  IN table_name_value VARCHAR(64),
  IN referenced_table_value VARCHAR(64),
  IN column_name_value VARCHAR(64),
  IN referenced_column_value VARCHAR(64)
)
BEGIN
  SET @retela_fk_name = NULL;

  SELECT CONSTRAINT_NAME
    INTO @retela_fk_name
  FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
  WHERE CONSTRAINT_SCHEMA = DATABASE()
    AND TABLE_NAME = table_name_value
    AND REFERENCED_TABLE_NAME = referenced_table_value
    AND COLUMN_NAME = column_name_value
    AND REFERENCED_COLUMN_NAME = referenced_column_value
  LIMIT 1;

  IF @retela_fk_name IS NOT NULL THEN
    SET @retela_sql = CONCAT('ALTER TABLE `', table_name_value, '` DROP FOREIGN KEY `', @retela_fk_name, '`');
    PREPARE retela_stmt FROM @retela_sql;
    EXECUTE retela_stmt;
    DEALLOCATE PREPARE retela_stmt;
  END IF;

  SET @retela_fk_name = NULL;
END //

CREATE PROCEDURE retela_add_fk_if_missing(
  IN table_name_value VARCHAR(64),
  IN fk_name_value VARCHAR(64),
  IN column_name_value VARCHAR(64),
  IN referenced_table_value VARCHAR(64),
  IN referenced_column_value VARCHAR(64),
  IN delete_rule_value VARCHAR(32)
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = table_name_value
      AND REFERENCED_TABLE_NAME = referenced_table_value
      AND COLUMN_NAME = column_name_value
      AND REFERENCED_COLUMN_NAME = referenced_column_value
  ) THEN
    SET @retela_sql = CONCAT(
      'ALTER TABLE `', table_name_value, '` ',
      'ADD CONSTRAINT `', fk_name_value, '` FOREIGN KEY (`', column_name_value, '`) ',
      'REFERENCES `', referenced_table_value, '` (`', referenced_column_value, '`) ',
      'ON DELETE ', delete_rule_value
    );
    PREPARE retela_stmt FROM @retela_sql;
    EXECUTE retela_stmt;
    DEALLOCATE PREPARE retela_stmt;
  END IF;
END //

CREATE PROCEDURE retela_repair_messaging_identity(IN table_name_value VARCHAR(64))
BEGIN
  DECLARE table_exists_count INT DEFAULT 0;
  DECLARE table_type_value VARCHAR(32) DEFAULT NULL;
  DECLARE invalid_id_count INT DEFAULT 0;
  DECLARE duplicate_id_count INT DEFAULT 0;
  DECLARE pk_columns_value TEXT DEFAULT '';
  DECLARE auto_columns_value TEXT DEFAULT '';
  DECLARE old_pk_columns_value TEXT DEFAULT '';
  DECLARE id_column_type_value TEXT DEFAULT 'int';

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

    SELECT COALESCE(COLUMN_TYPE, 'int')
      INTO id_column_type_value
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = table_name_value
      AND COLUMN_NAME = 'id'
    LIMIT 1;

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

    SET @retela_sql = CONCAT('ALTER TABLE `', table_name_value, '` MODIFY id ', id_column_type_value, ' NOT NULL AUTO_INCREMENT');
    PREPARE retela_stmt FROM @retela_sql;
    EXECUTE retela_stmt;
    DEALLOCATE PREPARE retela_stmt;
  END IF;
END //

DELIMITER ;

CALL retela_drop_fk_if_exists('messages', 'conversations', 'conversation_id', 'id');
CALL retela_repair_messaging_identity('conversations');
CALL retela_repair_messaging_identity('messages');
CALL retela_add_fk_if_missing('messages', 'fk_messages_conversation', 'conversation_id', 'conversations', 'id', 'CASCADE');

DROP PROCEDURE retela_repair_messaging_identity;
DROP PROCEDURE retela_drop_fk_if_exists;
DROP PROCEDURE retela_add_fk_if_missing;
