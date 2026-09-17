CREATE TABLE IF NOT EXISTS changed_logs (
    id INTEGER PRIMARY KEY AUTO_INCREMENT,
    employee_id INTEGER NULL,
    changed_by INTEGER NOT NULL,
    category VARCHAR(100) NOT NULL,
    item_name VARCHAR(255) NOT NULL,
    old_value TEXT NULL,
    new_value TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX ix_changed_logs_employee_id (employee_id),
    INDEX ix_changed_logs_changed_by (changed_by),
    INDEX ix_changed_logs_created_at (created_at),
    CONSTRAINT fk_changed_logs_employee FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE SET NULL,
    CONSTRAINT fk_changed_logs_actor FOREIGN KEY (changed_by) REFERENCES users(id)
);
