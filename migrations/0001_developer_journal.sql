-- Additive developer-only schema. No provider booking/payment replication.
CREATE TABLE guest_access (
  capability_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  issued_ms INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL CHECK (expires_ms > issued_ms),
  revoked_ms INTEGER
);
CREATE INDEX guest_owner ON guest_access(owner_id);
CREATE TABLE attempts (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  intent_json TEXT NOT NULL,
  intent_hash TEXT NOT NULL,
  created_ms INTEGER NOT NULL,
  deadline_ms INTEGER NOT NULL,
  version INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL CHECK (state IN ('prepared','dispatching','observed','recovery_required')),
  association_json TEXT,
  observation_json TEXT,
  observation_ms INTEGER,
  UNIQUE(owner_id, idempotency_key)
);
CREATE TRIGGER immutable_attempt_intent BEFORE UPDATE OF owner_id,idempotency_key,intent_json,intent_hash,created_ms,deadline_ms ON attempts
BEGIN SELECT RAISE(ABORT, 'immutable intent'); END;
CREATE TABLE dispatches (
  id TEXT PRIMARY KEY,
  attempt_id TEXT NOT NULL REFERENCES attempts(id),
  operation TEXT NOT NULL,
  fence INTEGER NOT NULL,
  started_ms INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK (outcome IN ('unknown','observed')),
  UNIQUE(attempt_id, operation)
);

CREATE TRIGGER immutable_association BEFORE UPDATE OF association_json ON attempts WHEN OLD.association_json IS NOT NULL
BEGIN SELECT RAISE(ABORT, 'immutable association'); END;
