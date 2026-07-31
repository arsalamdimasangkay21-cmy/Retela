USE retela_db;

ALTER TABLE users
  ADD COLUMN gcash_number VARCHAR(20) NULL AFTER profile_photo_url,
  ADD COLUMN debit_account_name VARCHAR(120) NULL AFTER gcash_number,
  ADD COLUMN debit_account_number VARCHAR(40) NULL AFTER debit_account_name;
