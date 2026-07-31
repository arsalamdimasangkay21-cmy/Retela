ALTER TABLE users
  MODIFY status ENUM('pending_otp','pending','approved','rejected','suspended') NOT NULL DEFAULT 'pending_otp';

ALTER TABLE users
  ADD COLUMN is_verified BOOLEAN NOT NULL DEFAULT false AFTER status;

UPDATE users
SET status = 'approved',
    is_verified = true
WHERE role = 'customer'
  AND status = 'pending'
  AND otp_code IS NULL;

UPDATE users
SET is_verified = true
WHERE role = 'admin' OR status = 'approved';

DELETE FROM notifications
WHERE type IN ('approval', 'customer_registration')
  AND title = 'New customer registration';
