INSERT IGNORE INTO permissions (`key`, name, module, action, description)
VALUES (
    'device_requests.team_view',
    'View team device requests',
    'device_requests',
    'team_view',
    'View device requests for assigned teams'
);
