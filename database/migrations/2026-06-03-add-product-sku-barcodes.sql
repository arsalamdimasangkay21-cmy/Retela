ALTER TABLE apparel_items ADD COLUMN sku VARCHAR(32) NULL AFTER id;

UPDATE apparel_items
SET sku = CONCAT('RETELA-', LPAD(id, 6, '0'))
WHERE sku IS NULL OR sku = '';

CREATE UNIQUE INDEX idx_apparel_items_sku ON apparel_items (sku);

CREATE OR REPLACE VIEW products AS
SELECT
  id,
  sku,
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
