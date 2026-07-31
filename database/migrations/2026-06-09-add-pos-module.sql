ALTER TABLE users
  MODIFY role ENUM('admin','staff','customer') NOT NULL DEFAULT 'customer';

ALTER TABLE orders
  MODIFY user_id INT NULL,
  MODIFY payment_method ENUM('cod','cash','gcash','debit','credit','maya') NOT NULL DEFAULT 'cod';

ALTER TABLE orders
  ADD COLUMN order_channel ENUM('online','pos') NOT NULL DEFAULT 'online' AFTER user_id,
  ADD COLUMN cash_received DECIMAL(10,2) NULL AFTER total_amount,
  ADD COLUMN change_amount DECIMAL(10,2) NULL AFTER cash_received,
  ADD COLUMN pos_cashier_id INT NULL AFTER change_amount;

CREATE TABLE IF NOT EXISTS pos_transaction_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  order_id INT NOT NULL,
  transaction_number VARCHAR(160) NOT NULL,
  cashier_id INT NULL,
  payment_method ENUM('cash','gcash') NOT NULL,
  total_amount DECIMAL(10,2) NOT NULL,
  cash_received DECIMAL(10,2) NULL,
  change_amount DECIMAL(10,2) NULL,
  gcash_reference_number VARCHAR(160) NULL,
  payment_received_at DATETIME NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_pos_logs_order (order_id),
  INDEX idx_pos_logs_transaction (transaction_number),
  INDEX idx_pos_logs_payment (payment_method),
  FOREIGN KEY (order_id) REFERENCES orders(id) ON DELETE CASCADE
);
