RENAME TABLE products TO apparel_items;

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
  is_deleted,
  deleted_at,
  created_at,
  updated_at
FROM apparel_items;

