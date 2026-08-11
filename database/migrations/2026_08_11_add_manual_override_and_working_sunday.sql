-- Run once on existing databases.
-- Adds persistent manual override metadata to attendance records
-- and adds a working_sundays table for per-user Sunday work flags.

ALTER TABLE attendance
    ADD COLUMN manual_override BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN manual_override_by INT NULL,
    ADD COLUMN manual_override_at DATETIME NULL;

CREATE TABLE IF NOT EXISTS working_sundays (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    work_date DATE NOT NULL,
    marked_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX ix_working_sundays_user_id_work_date (user_id, work_date),
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (marked_by) REFERENCES users(id) ON DELETE SET NULL
);
