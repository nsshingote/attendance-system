ALTER TABLE holidays
    DROP INDEX holiday_date,
    ADD COLUMN applies_to VARCHAR(30) NOT NULL DEFAULT 'all_users',
    ADD COLUMN target_user_ids_json TEXT NULL,
    ADD COLUMN target_team_ids_json TEXT NULL;
