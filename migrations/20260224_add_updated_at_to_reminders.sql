-- Migration: Add updated_at to reminders table
-- Date: 2026-02-24

ALTER TABLE reminders ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ;
