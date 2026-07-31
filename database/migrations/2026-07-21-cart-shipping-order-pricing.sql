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
  INDEX idx_cart_user_active (user_id, checked_out_at),
  CONSTRAINT fk_cart_items_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_cart_items_product FOREIGN KEY (product_id) REFERENCES apparel_items(id)
);

ALTER TABLE orders
  ADD COLUMN subtotal_amount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER fulfillment_method,
  ADD COLUMN coupon_discount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER subtotal_amount,
  ADD COLUMN sale_discount DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER coupon_discount,
  ADD COLUMN shipping_fee DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER sale_discount,
  ADD COLUMN coupon_code VARCHAR(40) NULL AFTER shipping_fee;
