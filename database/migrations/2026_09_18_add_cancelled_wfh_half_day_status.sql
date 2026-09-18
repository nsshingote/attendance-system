-- Preserve approved WFH and half-day requests when an administrator cancels them.
ALTER TABLE wfh_requests
MODIFY status ENUM('Pending', 'Approved', 'Rejected', 'Cancelled') DEFAULT 'Pending';

ALTER TABLE half_day_requests
MODIFY status ENUM('Pending', 'Approved', 'Rejected', 'Cancelled') DEFAULT 'Pending';
