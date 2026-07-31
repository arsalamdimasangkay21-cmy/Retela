ALTER TABLE products
  ADD COLUMN IF NOT EXISTS status VARCHAR(20) NOT NULL DEFAULT 'In Stock' AFTER stock,
  ADD COLUMN IF NOT EXISTS is_deleted BOOLEAN NOT NULL DEFAULT FALSE AFTER description,
  ADD COLUMN IF NOT EXISTS deleted_at DATETIME NULL AFTER is_deleted;

UPDATE products
SET status = CASE
  WHEN stock <= 0 THEN 'Out of Stock'
  WHEN stock <= 5 THEN 'Low Stock'
  ELSE 'In Stock'
END
WHERE status IS NULL OR status = '' OR status IN ('In Stock', 'Low Stock', 'Out of Stock');
