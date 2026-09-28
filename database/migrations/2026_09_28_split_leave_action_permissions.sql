-- Separate leave decisions and allocation editing so each can be assigned on
-- its own in the Permissions page. leave.cancel is already independently
-- configurable and continues to control full-request and per-date cancel.
INSERT IGNORE INTO permissions (`key`, name, module, action, description) VALUES
  ('leave.reject', 'Reject leave requests', 'leave', 'reject', 'Reject pending leave requests'),
  ('leave.edit_allocations', 'Edit leave allocations', 'leave', 'edit_allocations', 'Change the category assigned to each date in a leave request');

UPDATE permissions
SET name = 'Approve leave requests',
    description = 'Approve pending leave requests'
WHERE `key` = 'leave.approve';

-- Preserve the existing Admin access during rollout; Super Admins can assign
-- these permissions independently to Team Leaders or individual users.
INSERT IGNORE INTO role_permissions (role, role_id, permission_id)
SELECT r.`key`, r.id, p.id
FROM roles r
JOIN permissions p ON p.`key` IN ('leave.reject', 'leave.edit_allocations')
WHERE r.`key` = 'admin';
