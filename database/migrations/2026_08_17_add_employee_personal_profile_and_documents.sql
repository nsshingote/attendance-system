ALTER TABLE users
    ADD COLUMN IF NOT EXISTS address_line_1 VARCHAR(255) NULL,
    ADD COLUMN IF NOT EXISTS address_line_2 VARCHAR(255) NULL,
    ADD COLUMN IF NOT EXISTS city VARCHAR(100) NULL,
    ADD COLUMN IF NOT EXISTS state VARCHAR(100) NULL,
    ADD COLUMN IF NOT EXISTS pincode VARCHAR(20) NULL,
    ADD COLUMN IF NOT EXISTS country VARCHAR(100) NULL,
    ADD COLUMN IF NOT EXISTS emergency_contact_name VARCHAR(100) NULL,
    ADD COLUMN IF NOT EXISTS emergency_contact_relationship VARCHAR(100) NULL,
    ADD COLUMN IF NOT EXISTS emergency_contact_phone VARCHAR(20) NULL;

CREATE TABLE IF NOT EXISTS employee_personal_documents (
    id INT PRIMARY KEY AUTO_INCREMENT,
    employee_id INT NOT NULL,
    document_type VARCHAR(50) NOT NULL,
    title VARCHAR(255) NOT NULL,
    original_filename VARCHAR(255) NOT NULL,
    file_name VARCHAR(255) NOT NULL,
    file_path VARCHAR(500) NOT NULL,
    mime_type VARCHAR(100) NULL,
    file_size INT NOT NULL DEFAULT 0,
    uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE,
    INDEX ix_employee_personal_documents_employee (employee_id, uploaded_at)
);
