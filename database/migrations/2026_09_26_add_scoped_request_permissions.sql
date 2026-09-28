INSERT IGNORE INTO permissions (`key`, name, module, action, description) VALUES
    ('profile_corrections.team_view', 'View team profile corrections', 'profile_corrections', 'team_view', 'View profile correction requests for assigned teams'),
    ('profile_corrections.all_view', 'View all profile corrections', 'profile_corrections', 'all_view', 'View profile correction requests for all employees'),
    ('profile_corrections.approve', 'Approve profile corrections', 'profile_corrections', 'approve', 'Approve or reject profile correction requests'),
    ('report_approvals.team_view', 'View team report approvals', 'report_approvals', 'team_view', 'View report approval requests for assigned teams'),
    ('report_approvals.all_view', 'View all report approvals', 'report_approvals', 'all_view', 'View report approval requests for all employees'),
    ('report_approvals.approve', 'Approve report requests', 'report_approvals', 'approve', 'Approve or reject report submission requests'),
    ('activity_logs.team_view', 'View team activity logs', 'activity_logs', 'team_view', 'View activity logs for assigned teams');
