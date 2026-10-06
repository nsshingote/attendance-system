-- Extend salary slips to cover employee-submitted requests. Keep existing rows;
-- when historical duplicate periods exist, only the lowest id owns the unique
-- period key and the other legacy rows remain untouched with a NULL key.
ALTER TABLE salary_slips
    MODIFY COLUMN status ENUM('Pending Review', 'Saved', 'Sent') NOT NULL DEFAULT 'Saved',
    ADD COLUMN request_key VARCHAR(64) NULL;

-- Review legacy duplicates before applying uniqueness. No salary-slip data is deleted.
SELECT employee_id, year, month, COUNT(*) AS existing_slips
FROM salary_slips
GROUP BY employee_id, year, month
HAVING COUNT(*) > 1;

UPDATE salary_slips AS slip
JOIN (
    SELECT employee_id, year, month, MIN(id) AS canonical_id
    FROM salary_slips
    GROUP BY employee_id, year, month
) AS periods ON periods.canonical_id = slip.id
SET slip.request_key = CONCAT(slip.employee_id, ':', slip.year, ':', slip.month);

ALTER TABLE salary_slips
    ADD UNIQUE KEY uq_salary_slips_request_key (request_key);
