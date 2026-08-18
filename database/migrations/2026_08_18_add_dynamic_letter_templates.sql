-- Do not run automatically. This creates the single-company template store.
-- company_id is intentionally nullable and reserved for a later tenant migration.
-- Keep generated-document types compatible with the template type limit.
ALTER TABLE employee_documents MODIFY COLUMN document_type VARCHAR(80) NOT NULL;

CREATE TABLE IF NOT EXISTS letter_templates (
    id INT PRIMARY KEY AUTO_INCREMENT,
    company_id INT NULL,
    name VARCHAR(255) NOT NULL,
    document_type VARCHAR(80) NOT NULL,
    content TEXT NOT NULL,
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NULL,
    INDEX ix_letter_templates_document_type (document_type),
    INDEX ix_letter_templates_company_id (company_id),
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT
);

-- Seed the two existing letter types. Select an existing admin/superadmin as creator.
INSERT INTO letter_templates (name, document_type, content, created_by)
SELECT 'Offer Letter', 'offer_letter',
'OFFER LETTER\n\nDate: {{letter_date}}\n\nTo,\n{{employee_name}}\n\nSubject: Offer for the Position of {{designation}}\n\nDear {{employee_name}},\n\nWe are pleased to extend an offer of employment to you for the position of {{designation}} at {{company_name}}. We believe your skills and experience make you an excellent fit for our organization.\n\nDepartment: {{department}}\nPlace of Posting: {{place_of_posting}}\nDate of Joining: {{date_of_joining}}\n\nPlease confirm your acceptance or discuss any queries with our HR department.\n\nSincerely,\n{{company_name}}\n{{company_address}}', id
FROM users WHERE role IN ('admin', 'superadmin')
  AND NOT EXISTS (SELECT 1 FROM letter_templates WHERE document_type = 'offer_letter')
ORDER BY id LIMIT 1;

INSERT INTO letter_templates (name, document_type, content, created_by)
SELECT 'Appointment Letter', 'appointment_letter',
'APPOINTMENT LETTER\n\nDate: {{letter_date}}\n\nTo,\n{{employee_name}}\n\nSubject: Appointment for the Position of {{designation}}\n\nDear {{employee_name}},\n\nWe are pleased to offer you the position of {{designation}} at {{company_name}}.\n\nYour appointment will be effective from {{date_of_joining}}. You will be working at {{place_of_posting}} / {{department}}.\n\nWe look forward to having you join us.\n\nSincerely,\n{{company_name}}\n{{company_address}}', id
FROM users WHERE role IN ('admin', 'superadmin')
  AND NOT EXISTS (SELECT 1 FROM letter_templates WHERE document_type = 'appointment_letter')
ORDER BY id LIMIT 1;
