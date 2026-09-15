-- Add the permission foundation without changing existing endpoint behavior.
ALTER TABLE users
    MODIFY COLUMN role ENUM('superadmin', 'admin', 'team_leader', 'user') NOT NULL DEFAULT 'user';

CREATE TABLE IF NOT EXISTS permissions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    `key` VARCHAR(100) NOT NULL UNIQUE,
    name VARCHAR(150) NOT NULL,
    module VARCHAR(80) NOT NULL,
    action VARCHAR(80) NOT NULL,
    description VARCHAR(255) NULL
);

CREATE TABLE IF NOT EXISTS role_permissions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    role VARCHAR(40) NOT NULL,
    permission_id INT NOT NULL,
    FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
    UNIQUE KEY uq_role_permissions_role_permission (role, permission_id),
    INDEX ix_role_permissions_role (role)
);

INSERT IGNORE INTO permissions (`key`, name, module, action, description) VALUES
    ('dashboard.view', 'View dashboard', 'dashboard', 'view', 'View the dashboard'),
    ('attendance.view_own', 'View own attendance', 'attendance', 'view_own', 'View personal attendance'),
    ('attendance.team_view', 'View team attendance', 'attendance', 'team_view', 'View attendance for assigned teams'),
    ('attendance.all_view', 'View all attendance', 'attendance', 'all_view', 'View attendance for all employees'),
    ('reports.team_view', 'View team reports', 'reports', 'team_view', 'View reports for assigned teams'),
    ('reports.all_view', 'View all reports', 'reports', 'all_view', 'View reports for all employees'),
    ('leave.view_own', 'View own leave', 'leave', 'view_own', 'View personal leave'),
    ('leave.team_view', 'View team leave', 'leave', 'team_view', 'View leave for assigned teams'),
    ('leave.all_view', 'View all leave', 'leave', 'all_view', 'View leave for all employees'),
    ('leave.approve', 'Approve leave', 'leave', 'approve', 'Approve or reject leave requests'),
    ('corrections.view_own', 'View own corrections', 'corrections', 'view_own', 'View personal attendance corrections'),
    ('corrections.team_view', 'View team corrections', 'corrections', 'team_view', 'View corrections for assigned teams'),
    ('corrections.all_view', 'View all corrections', 'corrections', 'all_view', 'View corrections for all employees'),
    ('corrections.approve', 'Approve corrections', 'corrections', 'approve', 'Approve or reject attendance corrections'),
    ('kundli.team_view', 'View team Kundli', 'kundli', 'team_view', 'View Kundli notes for assigned teams'),
    ('kundli.create', 'Create Kundli notes', 'kundli', 'create', 'Create Kundli notes'),
    ('kundli.edit', 'Edit Kundli notes', 'kundli', 'edit', 'Edit Kundli notes'),
    ('kundli.delete', 'Delete Kundli notes', 'kundli', 'delete', 'Delete Kundli notes'),
    ('employees.view_own', 'View own employee profile', 'employees', 'view_own', 'View personal employee profile'),
    ('employees.team_view', 'View team employees', 'employees', 'team_view', 'View employee profiles for assigned teams'),
    ('employees.all_view', 'View all employees', 'employees', 'all_view', 'View all employee profiles');

INSERT IGNORE INTO role_permissions (role, permission_id)
SELECT 'superadmin', id FROM permissions;

INSERT IGNORE INTO role_permissions (role, permission_id)
SELECT 'admin', id FROM permissions;

INSERT IGNORE INTO role_permissions (role, permission_id)
SELECT 'user', id FROM permissions
WHERE `key` IN ('dashboard.view', 'attendance.view_own', 'leave.view_own', 'corrections.view_own', 'employees.view_own');

INSERT IGNORE INTO role_permissions (role, permission_id)
SELECT 'team_leader', id FROM permissions
WHERE `key` = 'dashboard.view';
