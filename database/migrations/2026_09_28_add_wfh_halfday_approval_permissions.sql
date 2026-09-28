-- Separate WFH and half-day request decisions from the general attendance
-- viewing permission. Approval includes approve and reject decisions.
INSERT IGNORE INTO permissions (`key`, name, module, action, description) VALUES
  ('attendance.half_day.approve', 'Approve half-day requests', 'attendance', 'half_day_approve', 'Approve or reject half-day requests'),
  ('attendance.wfh.approve', 'Approve WFH requests', 'attendance', 'wfh_approve', 'Approve or reject work-from-home requests');

-- Preserve existing Admin approval access. Team Leader access remains
-- individually assignable through the Permissions page.
INSERT IGNORE INTO role_permissions (role, role_id, permission_id)
SELECT r.`key`, r.id, p.id
FROM roles r
JOIN permissions p ON p.`key` IN ('attendance.half_day.approve', 'attendance.wfh.approve')
WHERE r.`key` = 'admin';
