ALTER TABLE users
  ADD COLUMN IF NOT EXISTS delivery_area_override ENUM('nearby','outside') NULL AFTER delivery_notes;
