-- Run after confirming no pending/approved rows use removed categories.
UPDATE leave_requests
SET leave_category = 'Unpaid'
WHERE leave_category IN ('Sick', 'Emergency', 'Privilege');

ALTER TABLE leave_requests
    MODIFY leave_category ENUM('Paid', 'Carried', 'Unpaid') DEFAULT 'Unpaid';
