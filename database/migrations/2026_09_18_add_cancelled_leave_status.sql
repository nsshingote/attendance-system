-- Keep approved leave requests in the audit history when they are cancelled.
ALTER TABLE leave_requests
MODIFY status ENUM('Pending', 'Approved', 'Rejected', 'Cancelled') DEFAULT 'Pending';
