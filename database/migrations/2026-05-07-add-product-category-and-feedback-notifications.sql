USE retela_db;

ALTER TABLE products
  ADD COLUMN IF NOT EXISTS category VARCHAR(40) NOT NULL DEFAULT 'T-shirt' AFTER brand;

ALTER TABLE notifications
  MODIFY type ENUM('approval','customer_registration','order','message','refund','new_product','inventory','system','feedback','broadcast') NOT NULL;
