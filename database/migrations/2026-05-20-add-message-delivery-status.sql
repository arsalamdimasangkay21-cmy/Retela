ALTER TABLE messages
  ADD COLUMN delivery_status ENUM('sent','delivered','seen') NOT NULL DEFAULT 'sent' AFTER body,
  ADD COLUMN delivered_at DATETIME NULL AFTER delivery_status,
  ADD COLUMN seen_at DATETIME NULL AFTER delivered_at;

UPDATE messages
SET delivery_status = 'delivered',
    delivered_at = COALESCE(delivered_at, created_at)
WHERE delivery_status = 'sent';
