-- Replace bundled Employee Documents manage permissions with independently
-- assignable create, edit, delete, generate, and send actions.
INSERT IGNORE INTO permissions (`key`, name, module, action, description) VALUES
  ('employee_documents.letter_templates.create', 'Create letter templates', 'employee_documents.letter_templates', 'create', 'Create letter templates'),
  ('employee_documents.letter_templates.edit', 'Edit letter templates', 'employee_documents.letter_templates', 'edit', 'Edit existing letter templates'),
  ('employee_documents.letter_templates.delete', 'Delete letter templates', 'employee_documents.letter_templates', 'delete', 'Delete letter templates'),
  ('employee_documents.letters.generate', 'Generate letter drafts', 'employee_documents.letters', 'generate', 'Generate letter drafts for employees'),
  ('employee_documents.letters.send', 'Send letters', 'employee_documents.letters', 'send', 'Send generated letters to employees'),
  ('employee_documents.letters.delete', 'Delete generated documents', 'employee_documents.letters', 'delete', 'Delete generated employee documents'),
  ('employee_documents.salary_slips.create', 'Create salary slips', 'employee_documents.salary_slips', 'create', 'Create salary slips'),
  ('employee_documents.salary_slips.edit', 'Edit salary slips', 'employee_documents.salary_slips', 'edit', 'Edit existing salary slips'),
  ('employee_documents.salary_slips.delete', 'Delete salary slips', 'employee_documents.salary_slips', 'delete', 'Delete salary slips'),
  ('employee_documents.salary_slips.send', 'Send salary slips', 'employee_documents.salary_slips', 'send', 'Send salary slips to employees');

-- Carry existing role grants forward so this migration does not unexpectedly
-- remove access. Admins can then manage each action independently.
INSERT IGNORE INTO role_permissions (role, role_id, permission_id)
SELECT rp.role, rp.role_id, target.id
FROM role_permissions rp
JOIN permissions oldp ON oldp.id = rp.permission_id
JOIN permissions target ON
  (oldp.`key` = 'employee_documents.letter_templates.manage' AND target.`key` IN (
    'employee_documents.letter_templates.create', 'employee_documents.letter_templates.edit', 'employee_documents.letter_templates.delete'
  )) OR
  (oldp.`key` = 'employee_documents.letters.manage' AND target.`key` IN (
    'employee_documents.letters.generate', 'employee_documents.letters.send', 'employee_documents.letters.delete'
  )) OR
  (oldp.`key` = 'employee_documents.salary_slips.manage' AND target.`key` IN (
    'employee_documents.salary_slips.create', 'employee_documents.salary_slips.edit', 'employee_documents.salary_slips.delete', 'employee_documents.salary_slips.send'
  ));

INSERT IGNORE INTO user_permissions (user_id, permission_id, effect, created_by)
SELECT up.user_id, target.id, up.effect, up.created_by
FROM user_permissions up
JOIN permissions oldp ON oldp.id = up.permission_id
JOIN permissions target ON
  (oldp.`key` = 'employee_documents.letter_templates.manage' AND target.`key` IN (
    'employee_documents.letter_templates.create', 'employee_documents.letter_templates.edit', 'employee_documents.letter_templates.delete'
  )) OR
  (oldp.`key` = 'employee_documents.letters.manage' AND target.`key` IN (
    'employee_documents.letters.generate', 'employee_documents.letters.send', 'employee_documents.letters.delete'
  )) OR
  (oldp.`key` = 'employee_documents.salary_slips.manage' AND target.`key` IN (
    'employee_documents.salary_slips.create', 'employee_documents.salary_slips.edit', 'employee_documents.salary_slips.delete', 'employee_documents.salary_slips.send'
  ));

DELETE FROM permissions WHERE `key` IN (
  'employee_documents.letter_templates.manage',
  'employee_documents.letters.manage',
  'employee_documents.salary_slips.manage'
);
