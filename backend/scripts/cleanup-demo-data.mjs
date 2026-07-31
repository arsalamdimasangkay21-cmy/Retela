import { query } from "../src/config/db.js";

await query(`
  DELETE oi FROM order_items oi
  JOIN products p ON p.id = oi.product_id
  WHERE p.name IN ('Vintage Denim Jacket', 'Corduroy Button Shirt')
`);
await query("DELETE FROM products WHERE name IN ('Vintage Denim Jacket', 'Corduroy Button Shirt')");
await query("UPDATE users SET gcash_number = NULL WHERE role = 'admin' AND gcash_number = '09306319696'");

const products = await query("SELECT name FROM products WHERE name IN ('Vintage Denim Jacket', 'Corduroy Button Shirt')");
const admins = await query("SELECT gcash_number FROM users WHERE role = 'admin' LIMIT 3");

console.log(JSON.stringify({
  removedProductsRemaining: products.length,
  adminGcash: admins
}, null, 2));

process.exit(0);
