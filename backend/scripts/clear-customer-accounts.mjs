import { pool, query } from "../src/config/db.js";

const notificationResult = await query(
  `DELETE FROM notifications
   WHERE title IN ('New customer registration', 'New customer message')
      OR type IN ('message', 'feedback')`
);
const userResult = await query("DELETE FROM users WHERE role = 'customer'");

console.log(JSON.stringify({
  deletedCustomers: userResult.affectedRows,
  deletedNotifications: notificationResult.affectedRows
}));

await pool.end();
