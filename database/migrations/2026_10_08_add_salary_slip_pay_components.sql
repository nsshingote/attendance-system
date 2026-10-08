-- Add structured salary-slip fields while preserving all legacy particulars,
-- totals, status values, sent timestamps, and request keys.
ALTER TABLE salary_slips
    ADD COLUMN employee_details TEXT NULL,
    ADD COLUMN earnings TEXT NULL,
    ADD COLUMN deductions TEXT NULL,
    ADD COLUMN lwp_days DECIMAL(8,2) NULL,
    ADD COLUMN total_earnings DECIMAL(12,2) NULL,
    ADD COLUMN lop_deduction DECIMAL(12,2) NULL,
    ADD COLUMN total_deductions DECIMAL(12,2) NULL,
    ADD COLUMN net_pay DECIMAL(12,2) NULL;
