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
  INDEX idx_shipping_settings_active (is_active, updated_at),
  CONSTRAINT fk_shipping_settings_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE system_settings
  ADD COLUMN IF NOT EXISTS gcash_qr_data LONGBLOB NULL,
  ADD COLUMN IF NOT EXISTS gcash_qr_mime VARCHAR(100) NULL,
  ADD COLUMN IF NOT EXISTS gcash_qr_updated_at DATETIME NULL;

ALTER TABLE shipping_settings
  ADD COLUMN IF NOT EXISTS free_municipalities_json LONGTEXT NULL,
  ADD COLUMN IF NOT EXISTS free_radius_km DECIMAL(8,2) NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS outside_area_fee DECIMAL(10,2) NOT NULL DEFAULT 0;

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS formatted_address VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS delivery_barangay VARCHAR(160) NULL,
  ADD COLUMN IF NOT EXISTS delivery_municipality VARCHAR(160) NULL,
  ADD COLUMN IF NOT EXISTS delivery_province VARCHAR(160) NULL,
  ADD COLUMN IF NOT EXISTS delivery_region VARCHAR(160) NULL,
  ADD COLUMN IF NOT EXISTS delivery_postal_code VARCHAR(20) NULL,
  ADD COLUMN IF NOT EXISTS delivery_place_id VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS delivery_location_source VARCHAR(40) NULL,
  ADD COLUMN IF NOT EXISTS delivery_latitude DECIMAL(10,7) NULL,
  ADD COLUMN IF NOT EXISTS delivery_longitude DECIMAL(10,7) NULL;

ALTER TABLE orders
  ADD COLUMN IF NOT EXISTS delivery_address VARCHAR(500) NULL,
  ADD COLUMN IF NOT EXISTS delivery_latitude DECIMAL(10,7) NULL,
  ADD COLUMN IF NOT EXISTS delivery_longitude DECIMAL(10,7) NULL,
  ADD COLUMN IF NOT EXISTS delivery_municipality VARCHAR(160) NULL,
  ADD COLUMN IF NOT EXISTS delivery_province VARCHAR(160) NULL,
  ADD COLUMN IF NOT EXISTS delivery_region VARCHAR(160) NULL,
  ADD COLUMN IF NOT EXISTS delivery_postal_code VARCHAR(20) NULL,
  ADD COLUMN IF NOT EXISTS delivery_place_id VARCHAR(255) NULL,
  ADD COLUMN IF NOT EXISTS shipping_zone VARCHAR(20) NULL,
  ADD COLUMN IF NOT EXISTS shipping_distance_km DECIMAL(10,2) NULL,
  ADD COLUMN IF NOT EXISTS shipping_rule VARCHAR(40) NULL;

UPDATE shipping_settings
SET outside_area_fee = fixed_fee
WHERE outside_area_fee = 0 AND fixed_fee > 0;

UPDATE shipping_settings
SET free_municipalities_json = '["Midsayap","Libungan","Pigcawayan"]'
WHERE free_municipalities_json IS NULL OR TRIM(free_municipalities_json) = '';
