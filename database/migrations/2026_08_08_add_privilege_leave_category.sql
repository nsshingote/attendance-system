-- Safe MySQL migration for existing production databases
-- This adds Privilege as a persisted leave category without changing
-- existing leave balance deduction rules.

ALTER TABLE leave_requests
MODIFY leave_category ENUM('Paid', 'Carried', 'Unpaid', 'Privilege') DEFAULT 'Unpaid';
