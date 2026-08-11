-- Associate an admin's manual On Leave override with its generated leave entry.
-- This keeps leave-category reporting in the normal leave data model while
-- allowing the attendance override to be changed or removed safely.
ALTER TABLE leave_requests
    ADD COLUMN manual_override_attendance_id INT NULL UNIQUE,
    ADD CONSTRAINT fk_leave_requests_manual_override_attendance
        FOREIGN KEY (manual_override_attendance_id) REFERENCES attendance(id) ON DELETE CASCADE;
