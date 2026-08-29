-- Retela production-readiness repair migration.
-- Non-destructive: creates missing support tables, columns, and indexes used by current routes.

CREATE TABLE IF NOT EXISTS system_settings (
  id INT PRIMARY KEY,
  config_json JSON NULL,
  openai_api_key_encrypted TEXT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

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
);

DROP PROCEDURE IF EXISTS retela_add_column_if_missing;
DROP PROCEDURE IF EXISTS retela_add_index_if_missing;
DROP PROCEDURE IF EXISTS retela_modify_column_if_exists;

DELIMITER //

CREATE PROCEDURE retela_add_column_if_missing(
  IN table_name_value VARCHAR(64),
  IN column_name_value VARCHAR(64),
  IN column_definition_value TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = table_name_value
      AND COLUMN_NAME = column_name_value
  ) THEN
    SET @retela_sql = CONCAT('ALTER TABLE `', table_name_value, '` ADD COLUMN ', column_definition_value);
    PREPARE retela_stmt FROM @retela_sql;
    EXECUTE retela_stmt;
    DEALLOCATE PREPARE retela_stmt;
  END IF;
END //

CREATE PROCEDURE retela_add_index_if_missing(
  IN table_name_value VARCHAR(64),
  IN index_name_value VARCHAR(64),
  IN index_sql_value TEXT
)
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = table_name_value
      AND INDEX_NAME = index_name_value
  ) THEN
    SET @retela_sql = index_sql_value;
    PREPARE retela_stmt FROM @retela_sql;
    EXECUTE retela_stmt;
    DEALLOCATE PREPARE retela_stmt;
  END IF;
END //

CREATE PROCEDURE retela_modify_column_if_exists(
  IN table_name_value VARCHAR(64),
  IN column_name_value VARCHAR(64),
  IN column_definition_value TEXT
)
BEGIN
  IF EXISTS (
    SELECT 1
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = table_name_value
      AND COLUMN_NAME = column_name_value
  ) THEN
    SET @retela_sql = CONCAT('ALTER TABLE `', table_name_value, '` MODIFY ', column_name_value, ' ', column_definition_value);
    PREPARE retela_stmt FROM @retela_sql;
    EXECUTE retela_stmt;
    DEALLOCATE PREPARE retela_stmt;
  END IF;
END //

DELIMITER ;

CALL retela_add_column_if_missing('products', 'is_active', 'is_active BOOLEAN NOT NULL DEFAULT TRUE');
CALL retela_add_column_if_missing('products', 'is_deleted', 'is_deleted BOOLEAN NOT NULL DEFAULT FALSE');
CALL retela_add_column_if_missing('products', 'deleted_at', 'deleted_at DATETIME NULL');
CALL retela_add_column_if_missing('products', 'deleted_by', 'deleted_by INT NULL');
CALL retela_add_column_if_missing('products', 'sale_enabled', 'sale_enabled BOOLEAN NOT NULL DEFAULT FALSE');
CALL retela_add_column_if_missing('products', 'sale_discount_percent', 'sale_discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0');
CALL retela_add_column_if_missing('products', 'sale_product_ids_json', 'sale_product_ids_json JSON NULL');
CALL retela_add_column_if_missing('products', 'sale_starts_at', 'sale_starts_at DATETIME NULL');
CALL retela_add_column_if_missing('products', 'sale_ends_at', 'sale_ends_at DATETIME NULL');
CALL retela_add_index_if_missing('products', 'idx_products_deleted', 'CREATE INDEX idx_products_deleted ON products (is_deleted)');

CALL retela_add_column_if_missing('orders', 'fulfillment_method', 'fulfillment_method ENUM(''delivery'',''pickup'') NOT NULL DEFAULT ''delivery''');
CALL retela_add_column_if_missing('orders', 'subtotal_amount', 'subtotal_amount DECIMAL(10,2) NOT NULL DEFAULT 0');
CALL retela_add_column_if_missing('orders', 'coupon_discount', 'coupon_discount DECIMAL(10,2) NOT NULL DEFAULT 0');
CALL retela_add_column_if_missing('orders', 'sale_discount', 'sale_discount DECIMAL(10,2) NOT NULL DEFAULT 0');
CALL retela_add_column_if_missing('orders', 'shipping_fee', 'shipping_fee DECIMAL(10,2) NOT NULL DEFAULT 0');
CALL retela_add_column_if_missing('orders', 'coupon_code', 'coupon_code VARCHAR(40) NULL');
CALL retela_modify_column_if_exists('orders', 'status', 'ENUM(''pending'',''awaiting_payment'',''paid'',''approved'',''processing'',''ready'',''completed'',''cancelled'',''payment_failed'',''rejected'') NOT NULL DEFAULT ''pending''');
CALL retela_modify_column_if_exists('orders', 'payment_status', 'ENUM(''unpaid'',''awaiting_payment'',''paid'',''failed'',''expired'',''cancelled'',''refunded'') NOT NULL DEFAULT ''unpaid''');
CALL retela_add_column_if_missing('orders', 'payment_status', 'payment_status ENUM(''unpaid'',''awaiting_payment'',''paid'',''failed'',''expired'',''cancelled'',''refunded'') NOT NULL DEFAULT ''unpaid''');
CALL retela_add_column_if_missing('orders', 'payment_reference', 'payment_reference VARCHAR(160) NULL');
CALL retela_add_column_if_missing('orders', 'transaction_id', 'transaction_id VARCHAR(160) NULL');
CALL retela_add_column_if_missing('orders', 'paid_at', 'paid_at DATETIME NULL');
CALL retela_add_column_if_missing('orders', 'payment_provider', 'payment_provider VARCHAR(40) NULL');
CALL retela_add_column_if_missing('orders', 'checkout_session_id', 'checkout_session_id VARCHAR(160) NULL');
CALL retela_add_column_if_missing('orders', 'checkout_url', 'checkout_url TEXT NULL');
CALL retela_add_column_if_missing('orders', 'payment_intent_id', 'payment_intent_id VARCHAR(160) NULL');
CALL retela_add_column_if_missing('orders', 'payment_method_id', 'payment_method_id VARCHAR(160) NULL');
CALL retela_add_column_if_missing('orders', 'qr_code_url', 'qr_code_url LONGTEXT NULL');
CALL retela_add_column_if_missing('orders', 'payment_expires_at', 'payment_expires_at DATETIME NULL');
CALL retela_add_column_if_missing('orders', 'rejection_reason', 'rejection_reason VARCHAR(255) NULL');
CALL retela_add_column_if_missing('orders', 'rejected_at', 'rejected_at DATETIME NULL');
CALL retela_add_column_if_missing('orders', 'payment_review_required_at', 'payment_review_required_at DATETIME NULL');
CALL retela_add_column_if_missing('orders', 'payment_review_note', 'payment_review_note VARCHAR(255) NULL');
CALL retela_add_column_if_missing('orders', 'tracking_number', 'tracking_number VARCHAR(120) NULL');

UPDATE orders
SET status = 'payment_failed'
WHERE status NOT IN ('payment_failed', 'rejected', 'cancelled')
  AND LOWER(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(payment_method, '')), ' ', ''), '_', ''), '-', '')) NOT IN ('cod','cash','cashondelivery','cashupondelivery','payondelivery','paymentondelivery')
  AND LOWER(REPLACE(REPLACE(REPLACE(TRIM(COALESCE(payment_status, '')), ' ', ''), '_', ''), '-', '')) IN ('failed','paymentfailed','unpaid','cancelled','canceled','expired');

CALL retela_add_column_if_missing('reviews', 'customer_id', 'customer_id INT NULL');
CALL retela_add_column_if_missing('reviews', 'order_id', 'order_id INT NULL');
CALL retela_add_column_if_missing('reviews', 'brand_id', 'brand_id INT NULL');
CALL retela_add_column_if_missing('reviews', 'brand_name', 'brand_name VARCHAR(120) NULL');
CALL retela_add_column_if_missing('reviews', 'product_name', 'product_name VARCHAR(180) NULL');
CALL retela_add_column_if_missing('reviews', 'order_number', 'order_number VARCHAR(40) NULL');
CALL retela_add_column_if_missing('reviews', 'amount_paid', 'amount_paid DECIMAL(10,2) NULL');
CALL retela_add_column_if_missing('reviews', 'category', 'category VARCHAR(80) NOT NULL DEFAULT ''Overall Experience''');
CALL retela_add_index_if_missing('reviews', 'idx_reviews_customer', 'CREATE INDEX idx_reviews_customer ON reviews (customer_id)');
CALL retela_add_index_if_missing('reviews', 'idx_reviews_order', 'CREATE INDEX idx_reviews_order ON reviews (order_id)');
CALL retela_add_index_if_missing('reviews', 'idx_reviews_product', 'CREATE INDEX idx_reviews_product ON reviews (product_id)');

DROP PROCEDURE retela_add_column_if_missing;
DROP PROCEDURE retela_add_index_if_missing;
