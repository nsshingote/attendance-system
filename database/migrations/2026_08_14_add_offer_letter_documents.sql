-- Kept separate from the salary-slip/Kundli migration so installations that
-- already applied it can receive the Offer / Appointment Letter feature.
CREATE TABLE IF NOT EXISTS employee_documents (
    id INT PRIMARY KEY AUTO_INCREMENT,
    employee_id INT NOT NULL,
    document_type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    content TEXT NOT NULL,
    status ENUM('Draft', 'Sent') NOT NULL DEFAULT 'Draft',
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    sent_at DATETIME NULL,
    FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
    INDEX ix_employee_documents_employee_status (employee_id, status)
);
