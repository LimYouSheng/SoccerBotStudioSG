-- Additive management-provisioned identity. Never auto-claim an unknown binding.
CREATE TABLE foundation_identity (
  singleton INTEGER PRIMARY KEY CHECK (singleton=1),
  account_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK (environment='developer'),
  database_id TEXT NOT NULL,
  coordinator_id TEXT NOT NULL CHECK (length(coordinator_id)=64)
);
CREATE TRIGGER immutable_foundation_identity_update BEFORE UPDATE ON foundation_identity
BEGIN SELECT RAISE(ABORT, 'immutable foundation identity'); END;
CREATE TRIGGER immutable_foundation_identity_delete BEFORE DELETE ON foundation_identity
BEGIN SELECT RAISE(ABORT, 'immutable foundation identity'); END;
