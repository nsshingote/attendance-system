ALTER TABLE leave_request_allocations
ADD COLUMN is_cancelled BOOLEAN NOT NULL DEFAULT FALSE;
