ALTER TABLE users
    ADD COLUMN attendance_mode ENUM('office', 'onsite') NOT NULL DEFAULT 'office' AFTER role;

ALTER TABLE attendance
    ADD COLUMN check_in_latitude DECIMAL(10, 7) NULL AFTER manual_override_at,
    ADD COLUMN check_in_longitude DECIMAL(10, 7) NULL AFTER check_in_latitude,
    ADD COLUMN check_in_accuracy DECIMAL(10, 2) NULL AFTER check_in_longitude,
    ADD COLUMN check_out_latitude DECIMAL(10, 7) NULL AFTER check_in_accuracy,
    ADD COLUMN check_out_longitude DECIMAL(10, 7) NULL AFTER check_out_latitude,
    ADD COLUMN check_out_accuracy DECIMAL(10, 2) NULL AFTER check_out_longitude;