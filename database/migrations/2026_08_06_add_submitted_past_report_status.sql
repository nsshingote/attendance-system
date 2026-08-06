-- Prevent an approved past-report date from being used more than once.
ALTER TABLE past_report_submission_requests
    MODIFY status ENUM('Pending', 'Approved', 'Rejected', 'Submitted') DEFAULT 'Pending';
