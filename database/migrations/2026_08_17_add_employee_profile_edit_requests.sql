-- Dedicated approval workflow for employee personal-profile edits.
CREATE TABLE IF NOT EXISTS employee_profile_edit_requests (
    id INT PRIMARY KEY AUTO_INCREMENT,
    employee_id INT NOT NULL,
    section VARCHAR(32) NOT NULL,
    requested_data JSON NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'Pending',
    approved_by INT NULL,
    decided_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT chk_employee_profile_edit_request_section CHECK (section IN ('address', 'emergency_contact')),
    CONSTRAINT chk_employee_profile_edit_request_status CHECK (status IN ('Pending', 'Approved', 'Rejected')),
    CONSTRAINT fk_employee_profile_edit_request_employee FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_employee_profile_edit_request_approver FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
    INDEX ix_employee_profile_edit_requests_employee_section (employee_id, section, status),
    INDEX ix_employee_profile_edit_requests_status (status)
);

-- Reversal (run manually only if this migration must be rolled back):
-- DROP TABLE IF EXISTS employee_profile_edit_requests;
