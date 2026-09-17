-- Recycle-bin schema migration.  Runtime create_all also creates this table
-- for installations that do not use a migration runner.
CREATE TABLE IF NOT EXISTS recycle_bin_entries (
    id INTEGER PRIMARY KEY AUTO_INCREMENT,
    table_name VARCHAR(120) NOT NULL,
    record_id INTEGER NOT NULL,
    record_label VARCHAR(255),
    snapshot TEXT NOT NULL,
    deleted_by INTEGER NULL,
    deleted_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expires_at DATETIME NOT NULL,
    INDEX ix_recycle_bin_entries_table_name (table_name),
    INDEX ix_recycle_bin_entries_record_id (record_id),
    INDEX ix_recycle_bin_entries_deleted_at (deleted_at),
    INDEX ix_recycle_bin_entries_expires_at (expires_at)
);
