-- Add the dynamic role/permission foundation without changing authorization behavior.
-- This migration preserves users.role and role_permissions.role as compatibility fields.

CREATE TABLE IF NOT EXISTS roles (
    id INT PRIMARY KEY AUTO_INCREMENT,
    `key` VARCHAR(40) NOT NULL UNIQUE,
    name VARCHAR(100) NOT NULL,
    description VARCHAR(255) NULL,
    is_system BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT INTO roles (`key`, name, description, is_system, is_active)
SELECT source.`key`, source.name, source.description, source.is_system, source.is_active
FROM (
    SELECT 'superadmin' AS `key`, 'Super Admin' AS name, 'Full system access' AS description, TRUE AS is_system, TRUE AS is_active
    UNION ALL SELECT 'admin', 'Admin', 'Administrative access', TRUE, TRUE
    UNION ALL SELECT 'team_leader', 'Team Leader', 'Access limited by assigned team scope', TRUE, TRUE
    UNION ALL SELECT 'user', 'User', 'Standard employee access', TRUE, TRUE
) AS source
LEFT JOIN roles existing ON existing.`key` = source.`key`
WHERE existing.id IS NULL;

-- Add users.role_id only when it is not already present.
SET @sql = (
    SELECT IF(
        EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = DATABASE()
              AND table_name = 'users'
              AND column_name = 'role_id'
        ),
        'SELECT 1',
        'ALTER TABLE users ADD COLUMN role_id INT NULL AFTER role'
    )
);
PREPARE add_users_role_id FROM @sql;
EXECUTE add_users_role_id;
DEALLOCATE PREPARE add_users_role_id;

SET @sql = (
    SELECT IF(
        EXISTS (
            SELECT 1
            FROM information_schema.table_constraints
            WHERE constraint_schema = DATABASE()
              AND table_name = 'users'
              AND constraint_name = 'fk_users_role_id'
        ),
        'SELECT 1',
        'ALTER TABLE users ADD CONSTRAINT fk_users_role_id FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE RESTRICT'
    )
);
PREPARE add_users_role_fk FROM @sql;
EXECUTE add_users_role_fk;
DEALLOCATE PREPARE add_users_role_fk;

UPDATE users u
JOIN roles r ON r.`key` = u.role
SET u.role_id = r.id
WHERE u.role_id IS NULL;

-- Add role_permissions.role_id while retaining role_permissions.role.
SET @sql = (
    SELECT IF(
        EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = DATABASE()
              AND table_name = 'role_permissions'
              AND column_name = 'role_id'
        ),
        'SELECT 1',
        'ALTER TABLE role_permissions ADD COLUMN role_id INT NULL AFTER role'
    )
);
PREPARE add_role_permissions_role_id FROM @sql;
EXECUTE add_role_permissions_role_id;
DEALLOCATE PREPARE add_role_permissions_role_id;

SET @sql = (
    SELECT IF(
        EXISTS (
            SELECT 1
            FROM information_schema.table_constraints
            WHERE constraint_schema = DATABASE()
              AND table_name = 'role_permissions'
              AND constraint_name = 'fk_role_permissions_role_id'
        ),
        'SELECT 1',
        'ALTER TABLE role_permissions ADD CONSTRAINT fk_role_permissions_role_id FOREIGN KEY (role_id) REFERENCES roles(id) ON DELETE CASCADE'
    )
);
PREPARE add_role_permissions_role_fk FROM @sql;
EXECUTE add_role_permissions_role_fk;
DEALLOCATE PREPARE add_role_permissions_role_fk;

UPDATE role_permissions rp
JOIN roles r ON r.`key` = rp.role
SET rp.role_id = r.id
WHERE rp.role_id IS NULL;

SET @sql = (
    SELECT IF(
        EXISTS (
            SELECT 1
            FROM information_schema.statistics
            WHERE table_schema = DATABASE()
              AND table_name = 'role_permissions'
              AND index_name = 'uq_role_permissions_role_id_permission'
        ),
        'SELECT 1',
        'ALTER TABLE role_permissions ADD UNIQUE KEY uq_role_permissions_role_id_permission (role_id, permission_id)'
    )
);
PREPARE add_role_permissions_role_unique FROM @sql;
EXECUTE add_role_permissions_role_unique;
DEALLOCATE PREPARE add_role_permissions_role_unique;

CREATE TABLE IF NOT EXISTS user_permissions (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    permission_id INT NOT NULL,
    effect ENUM('allow', 'deny') NOT NULL,
    created_by INT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    CONSTRAINT fk_user_permissions_user
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_permissions_permission
        FOREIGN KEY (permission_id) REFERENCES permissions(id) ON DELETE CASCADE,
    CONSTRAINT fk_user_permissions_created_by
        FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
    UNIQUE KEY uq_user_permissions_user_permission (user_id, permission_id),
    INDEX ix_user_permissions_user_id (user_id),
    INDEX ix_user_permissions_permission_id (permission_id)
);
