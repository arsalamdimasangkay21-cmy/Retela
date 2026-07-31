ALTER TABLE apparel_items ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE AFTER description;
ALTER TABLE apparel_items ADD COLUMN deleted_by INT NULL AFTER deleted_at;

ALTER TABLE conversations ADD COLUMN ai_processing BOOLEAN NOT NULL DEFAULT FALSE AFTER admin_takeover;
ALTER TABLE conversations ADD COLUMN is_archived BOOLEAN NOT NULL DEFAULT FALSE AFTER ai_processing;
ALTER TABLE conversations ADD COLUMN archived_at DATETIME NULL AFTER is_archived;
ALTER TABLE conversations ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE AFTER archived_at;
ALTER TABLE conversations ADD COLUMN deleted_at DATETIME NULL AFTER is_deleted;
ALTER TABLE conversations ADD COLUMN deleted_by INT NULL AFTER deleted_at;

ALTER TABLE broadcasts ADD COLUMN is_deleted BOOLEAN NOT NULL DEFAULT FALSE AFTER created_by;
ALTER TABLE broadcasts ADD COLUMN deleted_at DATETIME NULL AFTER is_deleted;
ALTER TABLE broadcasts ADD COLUMN deleted_by INT NULL AFTER deleted_at;
