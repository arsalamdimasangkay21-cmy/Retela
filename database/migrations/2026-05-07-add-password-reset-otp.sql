ALTER TABLE users
  ADD COLUMN password_reset_otp_code VARCHAR(6) NULL AFTER otp_expires_at,
  ADD COLUMN password_reset_otp_expires_at DATETIME NULL AFTER password_reset_otp_code,
  ADD COLUMN password_reset_verified_until DATETIME NULL AFTER password_reset_otp_expires_at;
