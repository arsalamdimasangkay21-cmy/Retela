ALTER TABLE reviews
  ADD COLUMN order_id INT NULL AFTER user_id,
  ADD COLUMN category VARCHAR(80) NOT NULL DEFAULT 'Overall Experience' AFTER rating;

CREATE INDEX idx_reviews_order ON reviews(order_id);

ALTER TABLE returns
  MODIFY status ENUM('pending','under_review','approved','rejected','refunded') NOT NULL DEFAULT 'pending',
  ADD COLUMN reason_category VARCHAR(80) NOT NULL DEFAULT 'Other' AFTER reason,
  ADD COLUMN refund_type VARCHAR(40) NOT NULL DEFAULT 'Refund' AFTER reason_category,
  ADD COLUMN proof_images JSON NULL AFTER image_url;
