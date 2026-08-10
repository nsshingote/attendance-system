-- Add per-day leave allocations so leave requests can track Paid/Carried/Unpaid/Emergency/Sick allocation by date.

ALTER TABLE leave_requests
MODIFY leave_category ENUM('Paid', 'Carried', 'Unpaid', 'Privilege', 'Emergency', 'Sick') DEFAULT 'Unpaid';

CREATE TABLE IF NOT EXISTS leave_request_allocations (
    id INT PRIMARY KEY AUTO_INCREMENT,
    leave_request_id INT NOT NULL,
    allocation_date DATE NOT NULL,
    leave_category ENUM('Paid', 'Carried', 'Unpaid', 'Privilege', 'Emergency', 'Sick') NOT NULL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (leave_request_id) REFERENCES leave_requests(id) ON DELETE CASCADE,
    UNIQUE KEY uq_leave_request_allocation_date (leave_request_id, allocation_date)
);
