-- Migration: Add unique constraints for user_departments and daily_report_data
-- Run this within a transaction. Backup your DB before running.

-- 1) Detect potential duplicates that would block the constraint
-- For user_departments: duplicates on (user_id, department_id)
SELECT user_id, department_id, COUNT(*) AS cnt
FROM user_departments
GROUP BY user_id, department_id
HAVING cnt > 1;

-- For daily_report_data: duplicates on (user_id, attendance_date, department_id, subtype_id)
SELECT user_id, attendance_date, department_id, subtype_id, COUNT(*) AS cnt
FROM daily_report_data
GROUP BY user_id, attendance_date, department_id, subtype_id
HAVING cnt > 1;

-- 2) If duplicates exist, you must resolve them before adding constraints.
-- Example dedupe strategy (review before running): keep min(id) and delete others.

-- USER_DEPARTMENTS dedupe (example): uncomment to apply after review
-- DELETE ud FROM user_departments ud
-- JOIN (
--   SELECT MIN(id) AS keep_id, user_id, department_id
--   FROM user_departments
--   GROUP BY user_id, department_id
--   HAVING COUNT(*) > 1
-- ) dup ON ud.user_id = dup.user_id AND ud.department_id = dup.department_id AND ud.id <> dup.keep_id;

-- DAILY_REPORT_DATA dedupe (example): uncomment to apply after review
-- DELETE d FROM daily_report_data d
-- JOIN (
--   SELECT MIN(id) AS keep_id, user_id, attendance_date, department_id, subtype_id
--   FROM daily_report_data
--   GROUP BY user_id, attendance_date, department_id, subtype_id
--   HAVING COUNT(*) > 1
-- ) dup ON d.user_id = dup.user_id AND d.attendance_date = dup.attendance_date AND d.department_id = dup.department_id AND d.subtype_id = dup.subtype_id AND d.id <> dup.keep_id;

-- 3) Add the unique constraints (run after duplicates are resolved)
ALTER TABLE user_departments
ADD CONSTRAINT uq_user_department UNIQUE (user_id, department_id);

ALTER TABLE daily_report_data
ADD CONSTRAINT uq_daily_report_data UNIQUE (user_id, attendance_date, department_id, subtype_id);

-- Optionally add indexes to support lookups
CREATE INDEX IF NOT EXISTS idx_user_departments_user_id ON user_departments (user_id);
CREATE INDEX IF NOT EXISTS idx_daily_report_data_user_date ON daily_report_data (user_id, attendance_date);
