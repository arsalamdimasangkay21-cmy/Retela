USE retela_db;

ALTER TABLE users
  ADD COLUMN last_active_at DATETIME NULL AFTER preferences;
