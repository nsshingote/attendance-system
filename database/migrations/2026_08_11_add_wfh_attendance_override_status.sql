-- Allow WFH to be saved as an explicit manual attendance override status.
ALTER TABLE attendance
    MODIFY COLUMN status ENUM('Present', 'Late', 'Half Day', 'Absent', 'Holiday', 'WFH', 'On Leave') DEFAULT 'Present';
