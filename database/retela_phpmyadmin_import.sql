CREATE DATABASE IF NOT EXISTS retela_new CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE retela_new;

SET FOREIGN_KEY_CHECKS = 0;
DROP TABLE IF EXISTS returns;
DROP TABLE IF EXISTS reviews;
DROP TABLE IF EXISTS notifications;
DROP TABLE IF EXISTS messages;
DROP TABLE IF EXISTS conversations;
DROP TABLE IF EXISTS order_items;
DROP TABLE IF EXISTS orders;
DROP VIEW IF EXISTS products;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS apparel_items;
DROP TABLE IF EXISTS shipping_settings;
DROP TABLE IF EXISTS system_settings;
DROP TABLE IF EXISTS users;
SET FOREIGN_KEY_CHECKS = 1;

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  username VARCHAR(80) NOT NULL UNIQUE,
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
  role ENUM('admin','customer') NOT NULL DEFAULT 'customer',
  status ENUM('pending_otp','pending','approved','rejected','suspended') NOT NULL DEFAULT 'pending_otp',
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
);

CREATE TABLE system_settings (
  id TINYINT PRIMARY KEY,
  config_json LONGTEXT NOT NULL,
  openai_api_key_encrypted TEXT NULL,
  gcash_qr_data LONGBLOB NULL,
  gcash_qr_mime VARCHAR(100) NULL,
  gcash_qr_updated_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE shipping_settings (
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
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE apparel_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  brand VARCHAR(120) DEFAULT 'Other',
  category VARCHAR(40) NOT NULL DEFAULT 'T-Shirts',
  gender VARCHAR(40) DEFAULT 'Unisex',
  size VARCHAR(40) DEFAULT 'Free Size',
  color VARCHAR(80) NOT NULL DEFAULT 'Other',
  price DECIMAL(10,2) NOT NULL,
  stock INT NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'In Stock',
  image_url VARCHAR(255) NULL,
  `condition` VARCHAR(120) NOT NULL,
  description TEXT NULL,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
  deleted_at DATETIME NULL,
  deleted_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_apparel_items_stock (stock),
  INDEX idx_apparel_items_created (created_at),
  INDEX idx_apparel_items_deleted (is_deleted)
);

CREATE OR REPLACE VIEW products AS
SELECT
  id,
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
  `condition`,
  description,
  is_active,
  is_deleted,
  deleted_at,
  deleted_by,
  created_at,
  updated_at
FROM apparel_items;

CREATE TABLE orders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  order_channel ENUM('online','pos') NOT NULL DEFAULT 'online',
  status ENUM('pending','awaiting_payment','paid','approved','processing','ready','completed','cancelled','payment_failed','rejected') NOT NULL DEFAULT 'pending',
  payment_method ENUM('cod','cash','gcash','qrph','debit','credit','maya') NOT NULL DEFAULT 'cod',
  payment_status ENUM('unpaid','awaiting_payment','paid','failed','expired','cancelled','refunded') NOT NULL DEFAULT 'unpaid',
  payment_reference VARCHAR(160) NULL,
  transaction_id VARCHAR(160) NULL,
  paid_at DATETIME NULL,
  inventory_deducted_at DATETIME NULL,
  payment_provider VARCHAR(40) NULL,
  checkout_session_id VARCHAR(160) NULL,
  checkout_url TEXT NULL,
  payment_intent_id VARCHAR(160) NULL,
  payment_method_id VARCHAR(160) NULL,
  qr_code_url LONGTEXT NULL,
  payment_expires_at DATETIME NULL,
  rejection_reason VARCHAR(255) NULL,
  rejected_at DATETIME NULL,
  payment_review_required_at DATETIME NULL,
  payment_review_note VARCHAR(255) NULL,
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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_orders_user (user_id),
  INDEX idx_orders_status (status),
  INDEX idx_orders_created (created_at),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE order_items (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  product_id INT NOT NULL,
  quantity INT NOT NULL,
  price DECIMAL(10,2) NOT NULL,
  INDEX idx_order_items_order (order_id),
  INDEX idx_order_items_product (product_id),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES apparel_items(id)
);

CREATE TABLE conversations (
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
  INDEX idx_conversations_customer (customer_id),
  FOREIGN KEY (customer_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  conversation_id INT NOT NULL,
  sender_id INT NULL,
  sender_type ENUM('customer','admin','ai') NOT NULL,
  mode ENUM('ai','admin') NOT NULL DEFAULT 'admin',
  ai_provider VARCHAR(20) NULL,
  response_time_ms INT NULL,
  token_usage INT NULL,
  body TEXT NOT NULL,
  delivery_status ENUM('sent','delivered','seen') NOT NULL DEFAULT 'sent',
  delivered_at DATETIME NULL,
  seen_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_messages_conversation (conversation_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE SET NULL
);

CREATE TABLE notifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  product_id INT NULL,
  type ENUM('approval','customer_registration','order','message','refund','new_product','inventory','system','feedback','broadcast') NOT NULL,
  title VARCHAR(160) NOT NULL,
  body VARCHAR(255) NOT NULL,
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_notifications_user (user_id),
  INDEX idx_notifications_read (is_read),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES apparel_items(id) ON DELETE SET NULL
);

CREATE TABLE reviews (
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
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_reviews_user (user_id),
  INDEX idx_reviews_customer (customer_id),
  INDEX idx_reviews_order (order_id),
  INDEX idx_reviews_product (product_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id) REFERENCES apparel_items(id) ON DELETE SET NULL
);

CREATE TABLE returns (
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
  INDEX idx_returns_status (status),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT INTO users (username, email, password_hash, role, status)
VALUES
('admin', 'admin@retela.local', '$2a$12$/v7ZPMocx86ByjSVFeiW6.VF8xe/HqsHfXUYsCuV5KxCQm1uVSrw6', 'admin', 'approved'),
('AdministratorRetela', 'administrator@retela.local', '$2a$12$K.QOgyK6w1cQPqS7HSRjW.mSzKhRLaxL0oN4BIzkPe68/1X.U354W', 'admin', 'approved');
