USE retela_db;

ALTER TABLE users
  ADD COLUMN shop_description TEXT NULL AFTER location;
