-- Additive identity metadata only; no customer directory or provider records.
CREATE TABLE identity_challenges (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  access_hash TEXT NOT NULL,
  email TEXT NOT NULL,
  email_hash TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  code_hash TEXT NOT NULL,
  created_ms INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL CHECK(expires_ms > created_ms),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
  state TEXT NOT NULL CHECK(state IN ('reserved','sent','unknown','consumed','superseded'))
);
CREATE INDEX identity_email_limit ON identity_challenges(email_hash,created_ms);
CREATE INDEX identity_source_limit ON identity_challenges(source_hash,created_ms);
CREATE INDEX identity_access_limit ON identity_challenges(access_hash,created_ms);
CREATE TABLE identity_bot_tokens (
  token_hash TEXT PRIMARY KEY,
  created_ms INTEGER NOT NULL
);
CREATE TABLE verified_identity (
  access_hash TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  email TEXT NOT NULL,
  verified_ms INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL,
  revoked_ms INTEGER
);
CREATE TRIGGER identity_send_limit BEFORE INSERT ON identity_challenges
WHEN (SELECT COUNT(*) FROM identity_challenges WHERE email_hash=NEW.email_hash AND created_ms>NEW.created_ms-900000)>=3
  OR (SELECT COUNT(*) FROM identity_challenges WHERE access_hash=NEW.access_hash AND created_ms>NEW.created_ms-900000)>=3
  OR (SELECT COUNT(*) FROM identity_challenges WHERE source_hash=NEW.source_hash AND created_ms>NEW.created_ms-900000)>=10
  OR EXISTS(SELECT 1 FROM identity_challenges WHERE email_hash=NEW.email_hash AND created_ms>NEW.created_ms-60000)
  OR EXISTS(SELECT 1 FROM identity_challenges WHERE access_hash=NEW.access_hash AND created_ms>NEW.created_ms-60000)
BEGIN SELECT RAISE(ABORT,'identity_request_limited'); END;
