USE retela_db;

ALTER TABLE users
  ADD COLUMN phone_number VARCHAR(20) NULL UNIQUE AFTER email;
