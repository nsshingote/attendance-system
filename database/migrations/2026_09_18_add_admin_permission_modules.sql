-- Detailed Admin navigation and action permissions. Existing Team Leader keys
-- remain unchanged. Existing Admin accounts receive the new permissions so the
-- rollout does not remove access before Super Admin configures the role.
INSERT IGNORE INTO permissions (`key`, name, module, action, description) VALUES
  ('employees.manage', 'Manage users', 'employees', 'manage', 'Create, edit, deactivate users, and reset devices'),
  ('teams.view', 'View teams', 'teams', 'view', 'View teams and members'),
  ('teams.manage', 'Manage teams', 'teams', 'manage', 'Create, edit, delete teams and manage members'),
  ('resources.view', 'View resources', 'resources', 'view', 'View shared resources'),
  ('resources.manage', 'Manage resources', 'resources', 'manage', 'Create, edit, and delete shared resources'),
  ('employee_documents.letters.view', 'View letters', 'employee_documents.letters', 'view', 'View generated employee letters'),
  ('employee_documents.letters.manage', 'Manage letters', 'employee_documents.letters', 'manage', 'Create, generate, and send employee letters'),
  ('employee_documents.salary_slips.view', 'View salary slips', 'employee_documents.salary_slips', 'view', 'View salary slips'),
  ('employee_documents.salary_slips.manage', 'Manage salary slips', 'employee_documents.salary_slips', 'manage', 'Create, edit, and delete salary slips'),
  ('employee_documents.letter_templates.view', 'View letter templates', 'employee_documents.letter_templates', 'view', 'View letter templates'),
  ('employee_documents.letter_templates.manage', 'Manage letter templates', 'employee_documents.letter_templates', 'manage', 'Create, edit, and delete letter templates'),
  ('report_structure.view', 'View report structure', 'report_structure', 'view', 'View report structure'),
  ('report_structure.manage', 'Manage report structure', 'report_structure', 'manage', 'Create and edit report structure'),
  ('departments.view', 'View departments', 'departments', 'view', 'View departments'),
  ('departments.manage', 'Manage departments', 'departments', 'manage', 'Create, edit, delete, and reassign departments'),
  ('attendance.manual_override', 'Override attendance', 'attendance', 'manual_override', 'Manually override attendance records'),
  ('leave.cancel', 'Cancel approved leave', 'leave', 'cancel', 'Cancel approved leave requests'),
  ('corrections.approve', 'Approve corrections', 'corrections', 'approve', 'Approve or reject attendance corrections'),
  ('reports.export', 'Export reports', 'reports', 'export', 'Export reports'),
  ('requests.view', 'View requests', 'requests', 'view', 'View employee requests'),
  ('requests.manage', 'Manage requests', 'requests', 'manage', 'Approve or reject employee requests'),
  ('holidays.view', 'View holidays', 'holidays', 'view', 'View holidays'),
  ('holidays.manage', 'Manage holidays', 'holidays', 'manage', 'Create, edit, and delete holidays'),
  ('monthly_summary.view', 'View monthly summary', 'monthly_summary', 'view', 'View monthly attendance summary'),
  ('monthly_summary.export', 'Export monthly summary', 'monthly_summary', 'export', 'Export monthly attendance summary'),
  ('device_requests.view', 'View device requests', 'device_requests', 'view', 'View device requests'),
  ('device_requests.approve', 'Approve device requests', 'device_requests', 'approve', 'Approve or reject device requests'),
  ('notification_emails.view', 'View notification emails', 'notification_emails', 'view', 'View notification email settings'),
  ('notification_emails.manage', 'Manage notification emails', 'notification_emails', 'manage', 'Create, edit, and delete notification email settings'),
  ('office_ips.view', 'View office IPs', 'office_ips', 'view', 'View office IP settings'),
  ('office_ips.manage', 'Manage office IPs', 'office_ips', 'manage', 'Create, edit, and delete office IP settings'),
  ('activity_logs.view', 'View activity logs', 'activity_logs', 'view', 'View activity logs'),
  ('feedback.view', 'View feedback', 'feedback', 'view', 'View employee feedback'),
  ('feedback.manage', 'Manage feedback', 'feedback', 'manage', 'Mark feedback as reviewed'),
  ('settings.view', 'View settings', 'settings', 'view', 'View company settings'),
  ('settings.manage', 'Manage settings', 'settings', 'manage', 'Edit company settings'),
  ('recycle_bin.view', 'View recycle bin', 'recycle_bin', 'view', 'View deleted records'),
  ('recycle_bin.restore', 'Restore recycle bin records', 'recycle_bin', 'restore', 'Restore deleted records'),
  ('recycle_bin.permanent_delete', 'Permanently delete recycle bin records', 'recycle_bin', 'permanent_delete', 'Permanently delete recycle bin records'),
  ('changed_logs.view', 'View changed logs', 'changed_logs', 'view', 'View changed-data audit logs'),
  ('permissions.manage', 'Manage role permissions', 'permissions', 'manage', 'Configure Admin and Team Leader permissions');

INSERT IGNORE INTO role_permissions (role, permission_id)
SELECT 'admin', id FROM permissions WHERE `key` <> 'permissions.manage';

DELETE rp FROM role_permissions rp
JOIN permissions p ON p.id = rp.permission_id
WHERE rp.role = 'admin' AND p.`key` = 'permissions.manage';

INSERT IGNORE INTO role_permissions (role, permission_id)
SELECT 'superadmin', id FROM permissions;
