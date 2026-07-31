ALTER TABLE users
  ADD COLUMN birthday DATE NULL AFTER location,
  ADD COLUMN gender VARCHAR(40) NULL AFTER birthday;
