-- Add soft-removal and provenance metadata without changing existing rows.
SET @sql = (
    SELECT IF(
        EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = DATABASE()
              AND table_name = 'working_sundays'
              AND column_name = 'source'
        ),
        'SELECT 1',
        "ALTER TABLE working_sundays ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'legacy_unknown'"
    )
);
PREPARE guarded_ddl FROM @sql;
EXECUTE guarded_ddl;
DEALLOCATE PREPARE guarded_ddl;

SET @sql = (
    SELECT IF(
        EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = DATABASE()
              AND table_name = 'working_sundays'
              AND column_name = 'removed_at'
        ),
        'SELECT 1',
        'ALTER TABLE working_sundays ADD COLUMN removed_at DATETIME NULL'
    )
);
PREPARE guarded_ddl FROM @sql;
EXECUTE guarded_ddl;
DEALLOCATE PREPARE guarded_ddl;

SET @sql = (
    SELECT IF(
        EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = DATABASE()
              AND table_name = 'working_sundays'
              AND column_name = 'removed_by'
        ),
        'SELECT 1',
        'ALTER TABLE working_sundays ADD COLUMN removed_by INT NULL'
    )
);
PREPARE guarded_ddl FROM @sql;
EXECUTE guarded_ddl;
DEALLOCATE PREPARE guarded_ddl;

SET @sql = (
    SELECT IF(
        EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = DATABASE()
              AND table_name = 'working_sundays'
              AND column_name = 'removal_reason'
        ),
        'SELECT 1',
        'ALTER TABLE working_sundays ADD COLUMN removal_reason TEXT NULL'
    )
);
PREPARE guarded_ddl FROM @sql;
EXECUTE guarded_ddl;
DEALLOCATE PREPARE guarded_ddl;

SET @sql = (
    SELECT IF(
        EXISTS (
            SELECT 1 FROM information_schema.statistics
            WHERE table_schema = DATABASE()
              AND table_name = 'working_sundays'
              AND index_name = 'ix_working_sundays_active'
        ),
        'SELECT 1',
        'ALTER TABLE working_sundays ADD INDEX ix_working_sundays_active (removed_at)'
    )
);
PREPARE guarded_ddl FROM @sql;
EXECUTE guarded_ddl;
DEALLOCATE PREPARE guarded_ddl;

SET @sql = (
    SELECT IF(
        EXISTS (
            SELECT 1 FROM information_schema.table_constraints
            WHERE constraint_schema = DATABASE()
              AND table_name = 'working_sundays'
              AND constraint_name = 'fk_working_sundays_removed_by'
        ),
        'SELECT 1',
        'ALTER TABLE working_sundays ADD CONSTRAINT fk_working_sundays_removed_by FOREIGN KEY (removed_by) REFERENCES users(id) ON DELETE SET NULL'
    )
);
PREPARE guarded_ddl FROM @sql;
EXECUTE guarded_ddl;
DEALLOCATE PREPARE guarded_ddl;

CREATE TABLE IF NOT EXISTS working_sunday_removal_history (
    id INT PRIMARY KEY AUTO_INCREMENT,
    working_sunday_id INT NOT NULL,
    user_id INT NOT NULL,
    employee_name VARCHAR(255) NULL,
    work_date DATE NOT NULL,
    removed_by INT NULL,
    remover_name VARCHAR(255) NULL,
    removed_at DATETIME NOT NULL,
    reason TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX ix_working_sunday_removal_history_assignment (working_sunday_id),
    INDEX ix_working_sunday_removal_history_employee_date (user_id, work_date)
);

-- Make history creation safe if an earlier run created a partial table.
SET @sql = (
    SELECT IF(
        EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = DATABASE()
              AND table_name = 'working_sunday_removal_history'
              AND column_name = 'working_sunday_id'
        ),
        'SELECT 1',
        (
            SELECT IF(
                (SELECT COUNT(*) FROM working_sunday_removal_history) = 0,
                'ALTER TABLE working_sunday_removal_history ADD COLUMN working_sunday_id INT NOT NULL',
                'ALTER TABLE working_sunday_removal_history ADD COLUMN working_sunday_id INT NULL'
            )
        )
    )
);
PREPARE guarded_ddl FROM @sql;
EXECUTE guarded_ddl;
DEALLOCATE PREPARE guarded_ddl;

SET @sql = (
    SELECT IF(
        EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = DATABASE()
              AND table_name = 'working_sunday_removal_history'
              AND column_name = 'user_id'
        ),
        'SELECT 1',
        (
            SELECT IF(
                (SELECT COUNT(*) FROM working_sunday_removal_history) = 0,
                'ALTER TABLE working_sunday_removal_history ADD COLUMN user_id INT NOT NULL',
                'ALTER TABLE working_sunday_removal_history ADD COLUMN user_id INT NULL'
            )
        )
    )
);
PREPARE guarded_ddl FROM @sql;
EXECUTE guarded_ddl;
DEALLOCATE PREPARE guarded_ddl;

SET @sql = (
    SELECT IF(
        EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = DATABASE()
              AND table_name = 'working_sunday_removal_history'
              AND column_name = 'employee_name'
        ),
        'SELECT 1',
        'ALTER TABLE working_sunday_removal_history ADD COLUMN employee_name VARCHAR(255) NULL'
    )
);
PREPARE guarded_ddl FROM @sql;
EXECUTE guarded_ddl;
DEALLOCATE PREPARE guarded_ddl;

SET @sql = (
    SELECT IF(
        EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = DATABASE()
              AND table_name = 'working_sunday_removal_history'
              AND column_name = 'work_date'
        ),
        'SELECT 1',
        (
            SELECT IF(
                (SELECT COUNT(*) FROM working_sunday_removal_history) = 0,
                'ALTER TABLE working_sunday_removal_history ADD COLUMN work_date DATE NOT NULL',
                'ALTER TABLE working_sunday_removal_history ADD COLUMN work_date DATE NULL'
            )
        )
    )
);
PREPARE guarded_ddl FROM @sql;
EXECUTE guarded_ddl;
DEALLOCATE PREPARE guarded_ddl;

SET @sql = (
    SELECT IF(
        EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = DATABASE()
              AND table_name = 'working_sunday_removal_history'
              AND column_name = 'removed_by'
        ),
        'SELECT 1',
        'ALTER TABLE working_sunday_removal_history ADD COLUMN removed_by INT NULL'
    )
);
PREPARE guarded_ddl FROM @sql;
EXECUTE guarded_ddl;
DEALLOCATE PREPARE guarded_ddl;

SET @sql = (
    SELECT IF(
        EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = DATABASE()
              AND table_name = 'working_sunday_removal_history'
              AND column_name = 'remover_name'
        ),
        'SELECT 1',
        'ALTER TABLE working_sunday_removal_history ADD COLUMN remover_name VARCHAR(255) NULL'
    )
);
PREPARE guarded_ddl FROM @sql;
EXECUTE guarded_ddl;
DEALLOCATE PREPARE guarded_ddl;

SET @sql = (
    SELECT IF(
        EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = DATABASE()
              AND table_name = 'working_sunday_removal_history'
              AND column_name = 'removed_at'
        ),
        'SELECT 1',
        (
            SELECT IF(
                (SELECT COUNT(*) FROM working_sunday_removal_history) = 0,
                'ALTER TABLE working_sunday_removal_history ADD COLUMN removed_at DATETIME NOT NULL',
                'ALTER TABLE working_sunday_removal_history ADD COLUMN removed_at DATETIME NULL'
            )
        )
    )
);
PREPARE guarded_ddl FROM @sql;
EXECUTE guarded_ddl;
DEALLOCATE PREPARE guarded_ddl;

SET @sql = (
    SELECT IF(
        EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = DATABASE()
              AND table_name = 'working_sunday_removal_history'
              AND column_name = 'reason'
        ),
        'SELECT 1',
        (
            SELECT IF(
                (SELECT COUNT(*) FROM working_sunday_removal_history) = 0,
                'ALTER TABLE working_sunday_removal_history ADD COLUMN reason TEXT NOT NULL',
                'ALTER TABLE working_sunday_removal_history ADD COLUMN reason TEXT NULL'
            )
        )
    )
);
PREPARE guarded_ddl FROM @sql;
EXECUTE guarded_ddl;
DEALLOCATE PREPARE guarded_ddl;

SET @sql = (
    SELECT IF(
        EXISTS (
            SELECT 1 FROM information_schema.columns
            WHERE table_schema = DATABASE()
              AND table_name = 'working_sunday_removal_history'
              AND column_name = 'created_at'
        ),
        'SELECT 1',
        'ALTER TABLE working_sunday_removal_history ADD COLUMN created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP'
    )
);
PREPARE guarded_ddl FROM @sql;
EXECUTE guarded_ddl;
DEALLOCATE PREPARE guarded_ddl;

SET @sql = (
    SELECT IF(
        EXISTS (
            SELECT 1 FROM information_schema.statistics
            WHERE table_schema = DATABASE()
              AND table_name = 'working_sunday_removal_history'
              AND index_name = 'ix_working_sunday_removal_history_assignment'
        ),
        'SELECT 1',
        'ALTER TABLE working_sunday_removal_history ADD INDEX ix_working_sunday_removal_history_assignment (working_sunday_id)'
    )
);
PREPARE guarded_ddl FROM @sql;
EXECUTE guarded_ddl;
DEALLOCATE PREPARE guarded_ddl;

SET @sql = (
    SELECT IF(
        EXISTS (
            SELECT 1 FROM information_schema.statistics
            WHERE table_schema = DATABASE()
              AND table_name = 'working_sunday_removal_history'
              AND index_name = 'ix_working_sunday_removal_history_employee_date'
        ),
        'SELECT 1',
        'ALTER TABLE working_sunday_removal_history ADD INDEX ix_working_sunday_removal_history_employee_date (user_id, work_date)'
    )
);
PREPARE guarded_ddl FROM @sql;
EXECUTE guarded_ddl;
DEALLOCATE PREPARE guarded_ddl;

UPDATE working_sunday_removal_history h
LEFT JOIN users employee ON employee.id = h.user_id
SET h.employee_name = COALESCE(h.employee_name, employee.name);

UPDATE working_sunday_removal_history h
LEFT JOIN users remover ON remover.id = h.removed_by
SET h.remover_name = COALESCE(h.remover_name, remover.name);

-- Recover provenance only from exact activity-log messages created by the
-- application. Anything not matched remains legacy_unknown.
UPDATE working_sundays ws
JOIN activity_logs al
  ON al.activity = CONCAT('Marked working day for user #', ws.user_id, ' on ', DATE_FORMAT(ws.work_date, '%Y-%m-%d'))
SET ws.source = 'holidays'
WHERE ws.source = 'legacy_unknown'
  AND al.activity = CONCAT('Marked working day for user #', ws.user_id, ' on ', DATE_FORMAT(ws.work_date, '%Y-%m-%d'));

UPDATE working_sundays ws
JOIN activity_logs al
  ON al.activity = CONCAT('Marked working day for user #', ws.user_id, ' on ', DATE_FORMAT(ws.work_date, '%Y-%m-%d'), ' via override')
SET ws.source = 'attendance_override'
WHERE ws.source = 'legacy_unknown';
