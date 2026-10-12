-- Preserve approval-time attendance state and cancellation audit data.
ALTER TABLE attendance_corrections
    MODIFY COLUMN status ENUM('Pending', 'Approved', 'Rejected', 'Cancelled') DEFAULT 'Pending',
    ADD COLUMN approval_before_state JSON NULL,
    ADD COLUMN approval_after_state JSON NULL,
    ADD COLUMN approved_by INT NULL,
    ADD COLUMN approved_at DATETIME NULL,
    ADD COLUMN cancelled_by INT NULL,
    ADD COLUMN cancelled_at DATETIME NULL,
    ADD COLUMN cancellation_reason VARCHAR(255) NULL;
