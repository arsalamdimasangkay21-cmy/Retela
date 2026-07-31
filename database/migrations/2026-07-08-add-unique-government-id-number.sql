SET @index_exists := (
  SELECT COUNT(*)
  FROM INFORMATION_SCHEMA.STATISTICS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'identity_verifications'
    AND INDEX_NAME = 'uq_identity_id_number'
);

SET @statement := IF(
  @index_exists = 0,
  'ALTER TABLE identity_verifications ADD UNIQUE KEY uq_identity_id_number (id_number)',
  'SELECT 1'
);

PREPARE statement FROM @statement;
EXECUTE statement;
DEALLOCATE PREPARE statement;
