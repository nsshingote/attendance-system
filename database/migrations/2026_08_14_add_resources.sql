-- Add Resources Management Module
-- Allows Admin/Superadmin to upload and manage documents with fine-grained access control

CREATE TABLE IF NOT EXISTS resources (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    file_path VARCHAR(500) NOT NULL UNIQUE,
    file_name VARCHAR(255) NOT NULL,
    visibility_type ENUM('all_employees', 'departments', 'specific_employees') NOT NULL DEFAULT 'all_employees',
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
    INDEX ix_resources_created_by (created_by),
    INDEX ix_resources_visibility_type (visibility_type)
);

-- Department-level access control
-- When visibility_type = 'departments', employees in these departments can access the resource
CREATE TABLE IF NOT EXISTS resource_department_access (
    id INT PRIMARY KEY AUTO_INCREMENT,
    resource_id INT NOT NULL,
    department_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE,
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
    UNIQUE KEY uq_resource_department (resource_id, department_id),
    INDEX ix_department_id (department_id)
);

-- Employee-level access control
-- When visibility_type = 'specific_employees', only these employees can access the resource
CREATE TABLE IF NOT EXISTS resource_employee_access (
    id INT PRIMARY KEY AUTO_INCREMENT,
    resource_id INT NOT NULL,
    employee_id INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (resource_id) REFERENCES resources(id) ON DELETE CASCADE,
    FOREIGN KEY (employee_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE KEY uq_resource_employee (resource_id, employee_id),
    INDEX ix_employee_id (employee_id)
);
