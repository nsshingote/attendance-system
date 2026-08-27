-- Add view tracking for the admin feedback inbox.
ALTER TABLE feedback
    ADD COLUMN IF NOT EXISTS viewed_at DATETIME NULL;