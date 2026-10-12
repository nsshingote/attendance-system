-- Allow attendance overrides to persist the Extra Working Day status supported by the model.
ALTER TABLE attendance
    MODIFY COLUMN status ENUM(
        'Present',
        'Late',
        'Half Day',
        'Absent',
        'Holiday',
        'WFH',
        'On Leave',
        'Extra Working Day'
    ) DEFAULT 'Present';
