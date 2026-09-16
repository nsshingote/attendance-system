-- User-targeted in-app notifications. WebSocket delivery is transient;
-- this table remains the source of truth.
CREATE TABLE IF NOT EXISTS notifications (
    id INT PRIMARY KEY AUTO_INCREMENT,
    recipient_user_id INT NOT NULL,
    actor_user_id INT NULL,
    notification_type VARCHAR(100) NOT NULL,
    title VARCHAR(255) NOT NULL,
    message TEXT NOT NULL,
    route VARCHAR(500) NULL,
    entity_type VARCHAR(100) NULL,
    entity_id INT NULL,
    metadata_json TEXT NULL,
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    read_at DATETIME NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_notifications_recipient
        FOREIGN KEY (recipient_user_id) REFERENCES users(id) ON DELETE CASCADE,
    CONSTRAINT fk_notifications_actor
        FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
    INDEX ix_notifications_id (id),
    INDEX ix_notifications_recipient_user_id (recipient_user_id),
    INDEX ix_notifications_is_read (is_read),
    INDEX ix_notifications_created_at (created_at)
);
