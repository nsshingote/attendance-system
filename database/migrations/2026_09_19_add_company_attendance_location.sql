ALTER TABLE company_settings
    ADD COLUMN attendance_location_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN office_latitude DECIMAL(10, 7) NULL,
    ADD COLUMN office_longitude DECIMAL(10, 7) NULL,
    ADD COLUMN attendance_radius_meters INT NOT NULL DEFAULT 200,
    ADD COLUMN attendance_validation_mode ENUM('ip_only', 'location_only', 'ip_or_location') NOT NULL DEFAULT 'ip_only';

ALTER TABLE attendance
    ADD COLUMN check_in_distance_meters DECIMAL(10, 2) NULL,
    ADD COLUMN check_out_distance_meters DECIMAL(10, 2) NULL,
    ADD COLUMN check_in_validation_method ENUM('ip', 'location') NULL,
    ADD COLUMN check_out_validation_method ENUM('ip', 'location') NULL;
