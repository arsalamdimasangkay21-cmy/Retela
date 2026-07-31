USE retela_db;

ALTER TABLE users
  MODIFY status ENUM('pending_otp','pending','approved','rejected','suspended') NOT NULL DEFAULT 'pending';
