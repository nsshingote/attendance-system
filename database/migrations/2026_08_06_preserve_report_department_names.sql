-- Preserve the original department label on every historical report.
-- Safe to run once on existing MySQL/MariaDB production databases.
ALTER TABLE daily_report_data
    ADD COLUMN department_name VARCHAR(100) NULL AFTER department_id;

-- Backfill reports whose department still exists. Reports from already-deleted
-- departments cannot be reconstructed automatically and should be filled from a backup if needed.
UPDATE daily_report_data dr
JOIN departments d ON d.id = dr.department_id
SET dr.department_name = d.name
WHERE dr.department_name IS NULL OR TRIM(dr.department_name) = '';
