CREATE TABLE IF NOT EXISTS broadcasts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(160) NOT NULL,
  message TEXT NOT NULL,
  image_url VARCHAR(255) NULL,
  promo_code VARCHAR(80) NULL,
  audience ENUM('all_customers','new_customers','active_customers','customers_with_orders','vip_customers') NOT NULL DEFAULT 'all_customers',
  broadcast_type ENUM('new_product_drop','promo_sale','flash_sale','restock_alert','order_update','event_announcement','ai_marketing_campaign') NOT NULL DEFAULT 'promo_sale',
  status ENUM('draft','scheduled','sending','sent','failed') NOT NULL DEFAULT 'draft',
  channels_json JSON NOT NULL,
  scheduled_at DATETIME NULL,
  sent_at DATETIME NULL,
  ai_generated BOOLEAN NOT NULL DEFAULT FALSE,
  created_by INT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_broadcasts_status_schedule (status, scheduled_at),
  INDEX idx_broadcasts_created (created_at),
  CONSTRAINT fk_broadcasts_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
);

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS broadcast_id INT NULL AFTER product_id;

ALTER TABLE notifications
  MODIFY type ENUM('approval','customer_registration','order','message','refund','new_product','inventory','system','feedback','broadcast') NOT NULL;

CREATE INDEX IF NOT EXISTS idx_notifications_broadcast ON notifications (broadcast_id);

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
  INDEX idx_broadcast_deliveries_notification (notification_id),
  CONSTRAINT fk_broadcast_deliveries_broadcast FOREIGN KEY (broadcast_id) REFERENCES broadcasts(id) ON DELETE CASCADE,
  CONSTRAINT fk_broadcast_deliveries_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT fk_broadcast_deliveries_notification FOREIGN KEY (notification_id) REFERENCES notifications(id) ON DELETE SET NULL
);
