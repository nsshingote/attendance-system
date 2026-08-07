-- Run once on existing databases. Matches backend.models.Feedback exactly.
CREATE TABLE feedback (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    feedback_type ENUM('positive', 'negative') NOT NULL,
    description TEXT NOT NULL,
    is_anonymous BOOLEAN NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX ix_feedback_user_id (user_id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);
