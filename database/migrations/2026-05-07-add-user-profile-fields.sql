USE retela_db;

ALTER TABLE users
  ADD COLUMN location VARCHAR(255) NULL AFTER phone_number,
  ADD COLUMN profile_photo_url VARCHAR(255) NULL AFTER location;
