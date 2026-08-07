-- One-time migration for the current production schema:
-- status = Pending, Approved, Rejected, Submitted
-- no request_type column; uq_past_report_request = (user_id, attendance_date)
--
-- All existing rows receive 'Missing Report', preserving their uniqueness.
ALTER TABLE past_report_submission_requests
    DROP INDEX uq_past_report_request,
    ADD COLUMN request_type ENUM('Missing Report', 'Edit Report') NOT NULL DEFAULT 'Missing Report' AFTER reason,
    ADD UNIQUE KEY uq_past_report_request (user_id, attendance_date, request_type),
    MODIFY COLUMN status ENUM('Pending', 'Approved', 'Rejected', 'Submitted', 'Completed') DEFAULT 'Pending';
