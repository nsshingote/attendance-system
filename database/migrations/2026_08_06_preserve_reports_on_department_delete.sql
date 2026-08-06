-- Run after the department_name backfill migration.
-- Keep historical reports when an old department is physically deleted.
SET @fk_name := (
    SELECT CONSTRAINT_NAME
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'daily_report_data'
      AND COLUMN_NAME = 'department_id'
      AND REFERENCED_TABLE_NAME = 'departments'
    LIMIT 1
);
SET @drop_fk_sql := IF(@fk_name IS NULL, 'SELECT 1', CONCAT('ALTER TABLE daily_report_data DROP FOREIGN KEY `', @fk_name, '`'));
PREPARE drop_fk FROM @drop_fk_sql;
EXECUTE drop_fk;
DEALLOCATE PREPARE drop_fk;

ALTER TABLE daily_report_data MODIFY department_id INT NULL;
ALTER TABLE daily_report_data
    ADD CONSTRAINT fk_daily_report_data_department
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;
