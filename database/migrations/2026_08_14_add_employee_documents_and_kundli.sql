CREATE TABLE IF NOT EXISTS salary_slips (
    id INT PRIMARY KEY AUTO_INCREMENT,
    employee_id INT NOT NULL,
    month INT NOT NULL,
    year INT NOT NULL,
    particulars TEXT NOT NULL,
    total_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
    status ENUM('Saved', 'Sent') NOT NULL DEFAULT 'Saved',
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
    INDEX ix_salary_slips_employee_month (employee_id, year, month)
);

CREATE TABLE IF NOT EXISTS kundli_notes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    employee_id INT NOT NULL,
    positive_note TEXT NULL,
    negative_note TEXT NULL,
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
    INDEX ix_kundli_notes_employee (employee_id, created_at)
);
