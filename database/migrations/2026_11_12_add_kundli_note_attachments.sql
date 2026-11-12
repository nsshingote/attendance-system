CREATE TABLE IF NOT EXISTS kundli_note_attachments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    note_id INT NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    storage_filename VARCHAR(255) NOT NULL UNIQUE,
    content_type VARCHAR(100) NOT NULL,
    file_size INT NOT NULL,
    uploaded_by INT NOT NULL,
    uploaded_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX ix_kundli_note_attachments_note_id (note_id),
    CONSTRAINT fk_kundli_note_attachments_note
        FOREIGN KEY (note_id) REFERENCES kundli_notes(id) ON DELETE CASCADE,
    CONSTRAINT fk_kundli_note_attachments_uploader
        FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
