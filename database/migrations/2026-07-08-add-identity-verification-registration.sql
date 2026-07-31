ALTER TABLE users
  MODIFY email VARCHAR(160) NULL;

ALTER TABLE users
  MODIFY status ENUM('pending_otp','pending','approved','rejected','suspended') NOT NULL DEFAULT 'pending_otp';

CREATE TABLE IF NOT EXISTS identity_verifications (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  id_type VARCHAR(80) NOT NULL,
  id_number VARCHAR(120) NOT NULL,
  id_image VARCHAR(255) NULL,
  selfie_image VARCHAR(255) NULL,
  face_match_score DECIMAL(5,2) NOT NULL DEFAULT 0,
  otp_verified BOOLEAN NOT NULL DEFAULT false,
  identity_verified BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_identity_user (user_id),
  CONSTRAINT fk_identity_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS otp_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  contact VARCHAR(160) NOT NULL,
  purpose VARCHAR(40) NOT NULL DEFAULT 'registration',
  otp_code VARCHAR(6) NOT NULL,
  expires_at DATETIME NOT NULL,
  resend_available_at DATETIME NOT NULL,
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 5,
  consumed_at DATETIME NULL,
  registration_payload JSON NULL,
  id_image_path VARCHAR(255) NULL,
  selfie_image_path VARCHAR(255) NULL,
  face_match_score DECIMAL(5,2) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_otp_contact_purpose (contact, purpose),
  INDEX idx_otp_expires (expires_at)
);

UPDATE users
SET is_verified = true
WHERE role IN ('admin','staff') OR status = 'approved';
