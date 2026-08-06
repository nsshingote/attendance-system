-- ============================================================
-- ATTENDANCE MANAGEMENT SYSTEM - DATABASE SCHEMA
-- ============================================================

-- ============================================================
-- 1. USERS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS users (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    mobile VARCHAR(15) UNIQUE NOT NULL,
    email VARCHAR(100) UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('superadmin', 'admin', 'user') NOT NULL DEFAULT 'user',
    department VARCHAR(100) NOT NULL,
    designation VARCHAR(100) NOT NULL,
    status ENUM('active', 'inactive') NOT NULL DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    device_token VARCHAR(255),
    device_name VARCHAR(255),
    browser_name VARCHAR(100),
    device_registered_at DATETIME,
    last_login TIMESTAMP NULL,
    annual_leave INT DEFAULT 6,
    leave_encashed INT DEFAULT 0,
    last_leave_accrual_date DATE,
    paid_leave_available INT DEFAULT 1,
    carried_leave INT DEFAULT 0
);

-- ============================================================
-- 2. COMPANY SETTINGS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS company_settings (
    id INT PRIMARY KEY AUTO_INCREMENT,
    office_start_time TIME NOT NULL,
    office_end_time TIME NOT NULL,
    late_grace_minutes INT NOT NULL DEFAULT 20,
    weekly_off_day VARCHAR(20) DEFAULT 'Sunday',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 3. ATTENDANCE TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS attendance (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    attendance_date DATE NOT NULL,
    check_in DATETIME,
    check_out DATETIME,
    status ENUM('Present', 'Late', 'Half Day', 'Absent', 'Holiday', 'On Leave') DEFAULT 'Present',
    ip_address VARCHAR(45),
    reason VARCHAR(255),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_by INT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================
-- 4. ATTENDANCE CORRECTIONS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS attendance_corrections (
    id INT PRIMARY KEY AUTO_INCREMENT,
    attendance_id INT NOT NULL,
    requested_by INT NOT NULL,
    reason VARCHAR(255),
    old_check_in DATETIME,
    new_check_in DATETIME,
    old_check_out DATETIME,
    new_check_out DATETIME,
    status ENUM('Pending', 'Approved', 'Rejected') DEFAULT 'Pending',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (attendance_id) REFERENCES attendance(id) ON DELETE CASCADE,
    FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================
-- 5. LEAVE TYPES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS leave_types (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(50) NOT NULL UNIQUE,
    total_days INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 6. LEAVE REQUESTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS leave_requests (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT,
    leave_type_id INT,
    from_date DATE NOT NULL,
    to_date DATE NOT NULL,
    total_days INT,
    reason TEXT,
    status ENUM('Pending', 'Approved', 'Rejected') DEFAULT 'Pending',
    leave_category ENUM('Paid', 'Carried', 'Privilege', 'Unpaid', 'Emergency', 'Sick') DEFAULT 'Paid',
    approved_by INT,
    approved_at DATETIME,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    notify_emails TEXT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (leave_type_id) REFERENCES leave_types(id) ON DELETE SET NULL,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

-- ============================================================
-- 7. NOTIFICATION EMAILS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS notification_emails (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100),
    email VARCHAR(150),
    is_active SMALLINT DEFAULT 1
);

-- ============================================================
-- 8. LEAVE NOTIFICATION EMAILS (Junction Table)
-- ============================================================
CREATE TABLE IF NOT EXISTS leave_notification_emails (
    id INT PRIMARY KEY AUTO_INCREMENT,
    leave_request_id INT,
    notification_email_id INT,
    FOREIGN KEY (leave_request_id) REFERENCES leave_requests(id) ON DELETE CASCADE,
    FOREIGN KEY (notification_email_id) REFERENCES notification_emails(id) ON DELETE CASCADE
);

-- ============================================================
-- 9. HOLIDAYS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS holidays (
    id INT PRIMARY KEY AUTO_INCREMENT,
    holiday_date DATE NOT NULL UNIQUE,
    holiday_name VARCHAR(100) NOT NULL,
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================
-- 10. DEVICE REQUESTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS device_requests (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    device_token VARCHAR(255),
    device_name VARCHAR(255),
    browser_name VARCHAR(100),
    status ENUM('Pending', 'Approved', 'Rejected') DEFAULT 'Pending',
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    approved_by INT,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

-- ============================================================
-- 11. OFFICE IPS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS office_ips (
    id INT PRIMARY KEY AUTO_INCREMENT,
    ip_address VARCHAR(45) NOT NULL UNIQUE,
    network_name VARCHAR(100),
    status ENUM('active', 'inactive') DEFAULT 'active',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 12. HALF DAY REQUESTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS half_day_requests (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    attendance_date DATE NOT NULL,
    slot ENUM('morning', 'afternoon') NOT NULL,
    reason VARCHAR(255),
    status ENUM('Pending', 'Approved', 'Rejected') DEFAULT 'Pending',
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    approved_by INT,
    approved_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

-- ============================================================
-- 13. LEAVE ENCASHMENT REQUESTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS leave_encashment_requests (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    days INT NOT NULL,
    status ENUM('Pending', 'Approved', 'Rejected') DEFAULT 'Pending',
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    approved_by INT,
    approved_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);

-- ============================================================
-- 14. PASSWORD RESET TOKENS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    token VARCHAR(255) NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================
-- 15. ACTIVITY LOGS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS activity_logs (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    activity VARCHAR(255) NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================
-- 16. REPORT DEPARTMENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS report_departments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL UNIQUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- 17. REPORT TYPES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS report_types (
    id INT PRIMARY KEY AUTO_INCREMENT,
    department_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (department_id) REFERENCES report_departments(id) ON DELETE CASCADE
);

-- ============================================================
-- 18. REPORT SUBTYPES TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS report_subtypes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    type_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    has_quantity BOOLEAN DEFAULT TRUE,
    has_duration BOOLEAN DEFAULT TRUE,
    has_description BOOLEAN DEFAULT FALSE,
    sort_order INT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (type_id) REFERENCES report_types(id) ON DELETE CASCADE
);

-- ============================================================
-- 19. DAILY REPORTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_reports (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    attendance_date DATE NOT NULL,
    department_id INT NOT NULL,
    type_id INT,
    subtype_id INT,
    quantity INT,
    duration VARCHAR(50),
    description TEXT,
    attachments TEXT,
    status ENUM('draft', 'submitted') DEFAULT 'draft',
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (department_id) REFERENCES report_departments(id) ON DELETE CASCADE,
    FOREIGN KEY (type_id) REFERENCES report_types(id) ON DELETE SET NULL,
    FOREIGN KEY (subtype_id) REFERENCES report_subtypes(id) ON DELETE SET NULL
);

-- ============================================================
-- INSERT DEFAULT DATA (Only if tables are empty)
-- ============================================================

-- Insert default company settings
INSERT IGNORE INTO company_settings (office_start_time, office_end_time, late_grace_minutes, weekly_off_day)
VALUES ('09:30:00', '18:30:00', 15, 'Sunday');

-- Insert default report departments
INSERT IGNORE INTO report_departments (name) VALUES ('B2B'), ('B2C'), ('HR'), ('IT');

-- Insert default office IP (localhost for testing)
INSERT IGNORE INTO office_ips (ip_address, network_name, status)
VALUES ('127.0.0.1', 'Localhost', 'active');

-- Insert default leave types
INSERT IGNORE INTO leave_types (name, total_days) VALUES ('Annual', 12), ('Sick', 6), ('Emergency', 3);



-- ============================================================
-- 20. DYNAMIC DEPARTMENTS TABLE (Admin can add/remove)
-- ============================================================
CREATE TABLE IF NOT EXISTS departments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL UNIQUE,
    is_active SMALLINT DEFAULT 1,
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================
-- 21. USER DEPARTMENT ASSIGNMENTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS user_departments (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    department_id INT NOT NULL,
    is_primary SMALLINT DEFAULT 0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE
);

-- ============================================================
-- 22. DYNAMIC REPORT TYPES TABLE (Admin can add/remove)
-- ============================================================
CREATE TABLE IF NOT EXISTS dynamic_report_types (
    id INT PRIMARY KEY AUTO_INCREMENT,
    department_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    sort_order INT DEFAULT 0,
    is_active SMALLINT DEFAULT 1,
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================
-- 22. DYNAMIC REPORT SUBTYPES TABLE (Admin can add/remove)
-- ============================================================
CREATE TABLE IF NOT EXISTS dynamic_report_subtypes (
    id INT PRIMARY KEY AUTO_INCREMENT,
    type_id INT NOT NULL,
    name VARCHAR(100) NOT NULL,
    has_quantity BOOLEAN DEFAULT TRUE,
    has_duration BOOLEAN DEFAULT TRUE,
    has_description BOOLEAN DEFAULT FALSE,
    sort_order INT DEFAULT 0,
    is_active SMALLINT DEFAULT 1,
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (type_id) REFERENCES dynamic_report_types(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================
-- 23. DYNAMIC REPORT FIELDS TABLE (Admin can add/remove)
-- ============================================================
CREATE TABLE IF NOT EXISTS dynamic_report_fields (
    id INT PRIMARY KEY AUTO_INCREMENT,
    name VARCHAR(100) NOT NULL,
    field_type ENUM('text', 'number', 'date', 'duration', 'textarea', 'dropdown') NOT NULL,
    is_default SMALLINT DEFAULT 0,
    show_in_report SMALLINT DEFAULT 1,
    is_required SMALLINT DEFAULT 0,
    sort_order INT DEFAULT 0,
    is_active SMALLINT DEFAULT 1,
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================
-- 24. REPORT DEFAULT ROWS TABLE (Admin sets default rows per department)
-- ============================================================
CREATE TABLE IF NOT EXISTS report_default_rows (
    id INT PRIMARY KEY AUTO_INCREMENT,
    department_id INT NOT NULL,
    subtype_id INT NOT NULL,
    is_default SMALLINT DEFAULT 1,
    created_by INT NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
    FOREIGN KEY (subtype_id) REFERENCES dynamic_report_subtypes(id) ON DELETE CASCADE,
    FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE
);

-- ============================================================
-- 25. USER DAILY ROWS TABLE (User-added custom rows per day)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_daily_rows (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    attendance_date DATE NOT NULL,
    subtype_id INT NOT NULL,
    is_custom SMALLINT DEFAULT 1,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (subtype_id) REFERENCES dynamic_report_subtypes(id) ON DELETE CASCADE
);

-- ============================================================
-- 26. DAILY REPORT DATA TABLE (Actual report values per day)
-- ============================================================
CREATE TABLE IF NOT EXISTS daily_report_data (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    attendance_date DATE NOT NULL,
    department_id INT NOT NULL,
    subtype_id INT NULL,
    quantity INT,
    duration VARCHAR(50),
    description TEXT,
    custom_fields TEXT,
    submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
    FOREIGN KEY (subtype_id) REFERENCES dynamic_report_subtypes(id) ON DELETE CASCADE
);

-- ============================================================
-- 27. WFH (WORK FROM HOME) REQUESTS TABLE
-- ============================================================
CREATE TABLE IF NOT EXISTS wfh_requests (
    id INT PRIMARY KEY AUTO_INCREMENT,
    user_id INT NOT NULL,
    attendance_date DATE NOT NULL,
    reason VARCHAR(255),
    status ENUM('Pending', 'Approved', 'Rejected') DEFAULT 'Pending',
    requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    approved_by INT,
    approved_at DATETIME,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
);