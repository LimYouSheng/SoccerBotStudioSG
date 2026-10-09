-- Minimal effect journal; provider remains the booking/payment authority.
CREATE TABLE session_effects (
  attempt_id TEXT NOT NULL REFERENCES attempts(id),
  step TEXT NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('unknown','observed')),
  reference_id TEXT,
  PRIMARY KEY(attempt_id, step)
);
CREATE TRIGGER immutable_observed_effect BEFORE UPDATE ON session_effects
WHEN OLD.outcome = 'observed'
BEGIN SELECT RAISE(ABORT, 'immutable observed effect'); END;
