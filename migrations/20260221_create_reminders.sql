-- Migration: Create reminders table
-- Date: 2026-02-21

CREATE TABLE IF NOT EXISTS reminders (
    id BIGSERIAL PRIMARY KEY,
    chat_id TEXT NOT NULL,
    user_id BIGINT NOT NULL,
    reminder_text TEXT NOT NULL,
    remind_at TIMESTAMPTZ NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'sent', 'cancelled')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    metadata JSONB
);

-- Index for efficient polling
CREATE INDEX IF NOT EXISTS idx_reminders_remind_at ON reminders(remind_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_reminders_chat_id ON reminders(chat_id);
