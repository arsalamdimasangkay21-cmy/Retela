ALTER TABLE conversations ADD COLUMN last_ai_provider VARCHAR(20) NULL AFTER admin_takeover;
ALTER TABLE conversations ADD COLUMN last_ai_response_time_ms INT NULL AFTER last_ai_provider;
ALTER TABLE conversations ADD COLUMN last_ai_token_usage INT NULL AFTER last_ai_response_time_ms;

ALTER TABLE messages ADD COLUMN ai_provider VARCHAR(20) NULL AFTER mode;
ALTER TABLE messages ADD COLUMN response_time_ms INT NULL AFTER ai_provider;
ALTER TABLE messages ADD COLUMN token_usage INT NULL AFTER response_time_ms;
