ALTER TABLE users
    ADD COLUMN place_of_posting VARCHAR(150) NULL AFTER designation,
    ADD COLUMN date_of_joining DATE NULL AFTER place_of_posting;
