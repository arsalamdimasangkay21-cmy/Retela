ALTER TABLE broadcasts ADD COLUMN sale_enabled BOOLEAN NOT NULL DEFAULT FALSE AFTER deleted_by;
ALTER TABLE broadcasts ADD COLUMN sale_discount_percent DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER sale_enabled;
ALTER TABLE broadcasts ADD COLUMN sale_product_ids_json JSON NULL AFTER sale_discount_percent;
ALTER TABLE broadcasts ADD COLUMN sale_starts_at DATETIME NULL AFTER sale_product_ids_json;
ALTER TABLE broadcasts ADD COLUMN sale_ends_at DATETIME NULL AFTER sale_starts_at;
