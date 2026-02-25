-- Migration: Fix reminders status constraint
-- Date: 2026-02-24

ALTER TABLE reminders DROP CONSTRAINT IF EXISTS reminders_status_check;

ALTER TABLE reminders ADD CONSTRAINT reminders_status_check 
CHECK (status IN ('pending', 'sent', 'completed', 'failed', 'cancelled'));
