-- Nullable values preserve a clear legacy marker for slips issued before
-- attendance-based Half-Day deductions were introduced.
ALTER TABLE salary_slips
    ADD COLUMN half_day_days DECIMAL(8,2) NULL,
    ADD COLUMN half_day_deduction DECIMAL(12,2) NULL;
