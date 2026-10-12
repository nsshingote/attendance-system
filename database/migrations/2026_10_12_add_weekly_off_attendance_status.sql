-- Allow Attendance Override to persist an explicit Weekly Off status.
ALTER TABLE attendance
    MODIFY COLUMN status ENUM(
        'Present',
        'Late',
        'Half Day',
        'Absent',
        'Holiday',
        'On Leave',
        'WFH',
        'Extra Working Day',
        'Weekly Off'
    ) DEFAULT 'Present';
