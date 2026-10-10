-- Additive identity state. No raw tokens, provider profiles or booking copies.
CREATE TABLE remembered_identity (
  id TEXT PRIMARY KEY,
  origin TEXT NOT NULL,
  account_id TEXT NOT NULL,
  email TEXT NOT NULL,
  origin_access_hash TEXT NOT NULL,
  verified_ms INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL CHECK(expires_ms = verified_ms + 7776000000),
  current_hash TEXT NOT NULL UNIQUE,
  previous_hash TEXT UNIQUE,
  rotated_ms INTEGER NOT NULL,
  revoked_ms INTEGER
);
CREATE INDEX remembered_subject ON remembered_identity(email);
CREATE INDEX remembered_origin_access ON remembered_identity(origin_access_hash);
CREATE TABLE remembered_access (
  access_hash TEXT PRIMARY KEY,
  family_id TEXT NOT NULL REFERENCES remembered_identity(id),
  restored INTEGER NOT NULL CHECK(restored IN (0,1))
);
CREATE INDEX remembered_family_access ON remembered_access(family_id);
CREATE TABLE identity_revocations (
  email TEXT PRIMARY KEY,
  cutoff_ms INTEGER NOT NULL,
  operation_id TEXT NOT NULL
);
CREATE TRIGGER remembered_expiry_immutable BEFORE UPDATE OF verified_ms,expires_ms ON remembered_identity
WHEN NEW.verified_ms<>OLD.verified_ms OR NEW.expires_ms<>OLD.expires_ms
BEGIN SELECT RAISE(ABORT,'remembered_expiry_immutable'); END;
CREATE TRIGGER remembered_revocation_immutable BEFORE UPDATE OF revoked_ms ON remembered_identity
WHEN OLD.revoked_ms IS NOT NULL AND (NEW.revoked_ms IS NULL OR NEW.revoked_ms<>OLD.revoked_ms)
BEGIN SELECT RAISE(ABORT,'remembered_revocation_immutable'); END;
CREATE TRIGGER remembered_guest_signout AFTER UPDATE OF revoked_ms ON guest_access
WHEN OLD.revoked_ms IS NULL AND NEW.revoked_ms IS NOT NULL
BEGIN
  UPDATE remembered_identity SET revoked_ms=NEW.revoked_ms WHERE revoked_ms IS NULL AND
    (origin_access_hash=NEW.capability_hash OR id IN (SELECT family_id FROM remembered_access WHERE access_hash=NEW.capability_hash));
END;
CREATE TRIGGER remembered_identity_signout AFTER UPDATE OF revoked_ms ON verified_identity
WHEN OLD.revoked_ms IS NULL AND NEW.revoked_ms IS NOT NULL
BEGIN
  UPDATE remembered_identity SET revoked_ms=NEW.revoked_ms WHERE revoked_ms IS NULL AND id IN
    (SELECT family_id FROM remembered_access WHERE access_hash=NEW.access_hash);
END;
CREATE TRIGGER remembered_family_signout AFTER UPDATE OF revoked_ms ON remembered_identity
WHEN OLD.revoked_ms IS NULL AND NEW.revoked_ms IS NOT NULL
BEGIN
  UPDATE verified_identity SET revoked_ms=NEW.revoked_ms WHERE revoked_ms IS NULL AND access_hash IN
    (SELECT access_hash FROM remembered_access WHERE family_id=NEW.id);
  UPDATE guest_access SET revoked_ms=NEW.revoked_ms WHERE revoked_ms IS NULL AND capability_hash IN
    (SELECT access_hash FROM remembered_access WHERE family_id=NEW.id);
END;
