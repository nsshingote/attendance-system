-- Migration: Allow nullable subtype_id for daily_report_data
-- This matches the backend model and API contract which accepts report rows without a subtype_id.

ALTER TABLE daily_report_data
MODIFY COLUMN subtype_id INT NULL;
