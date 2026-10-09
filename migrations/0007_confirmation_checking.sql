-- Only protected-read budget metadata; no provider or identity authority.
ALTER TABLE attempts ADD COLUMN confirmation_next_ms INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attempts ADD COLUMN confirmation_checks INTEGER NOT NULL DEFAULT 0;
