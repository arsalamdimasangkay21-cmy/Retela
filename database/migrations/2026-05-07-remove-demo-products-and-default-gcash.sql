USE retela_db;

DELETE oi FROM order_items oi
JOIN products p ON p.id = oi.product_id
WHERE p.name IN ('Vintage Denim Jacket', 'Corduroy Button Shirt');

DELETE FROM products
WHERE name IN ('Vintage Denim Jacket', 'Corduroy Button Shirt');

UPDATE users
SET gcash_number = NULL
WHERE role = 'admin' AND gcash_number = '09306319696';
