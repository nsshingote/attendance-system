ALTER TABLE company_settings
    ADD COLUMN sandwich_method_enabled BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE leave_request_allocations
    ADD COLUMN is_sandwich BOOLEAN NOT NULL DEFAULT FALSE;

CREATE TABLE leave_holiday_allocation_history (
    id INT PRIMARY KEY AUTO_INCREMENT,
    leave_request_id INT NOT NULL,
    allocation_date DATE NOT NULL,
    leave_category VARCHAR(20) NOT NULL,
    is_sandwich BOOLEAN NOT NULL DEFAULT FALSE,
    is_restored BOOLEAN NOT NULL DEFAULT FALSE,
    carried_balance_refunded BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_leave_holiday_history_request
        FOREIGN KEY (leave_request_id) REFERENCES leave_requests(id) ON DELETE CASCADE,
    CONSTRAINT uq_leave_holiday_history_request_date
        UNIQUE (leave_request_id, allocation_date)
);
