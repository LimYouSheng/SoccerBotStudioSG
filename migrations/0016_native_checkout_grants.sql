-- Source-only finite native trial admission. No row or open window is seeded.
-- Existing attempts, access capabilities, proof windows and migrations are immutable.
CREATE TABLE native_checkout_grants (
  attempt_id TEXT PRIMARY KEY REFERENCES attempts(id),
  capability_hash TEXT NOT NULL REFERENCES guest_access(capability_hash),
  intent_hash TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  contract_json TEXT NOT NULL CHECK(json_valid(contract_json)),
  not_before_ms INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL CHECK(expires_ms > not_before_ms AND expires_ms <= not_before_ms + 1200000),
  starting_used INTEGER NOT NULL CHECK(starting_used >= 0),
  maximum_used INTEGER NOT NULL CHECK(maximum_used > starting_used AND maximum_used <= 64),
  state TEXT NOT NULL CHECK(state IN ('granted','running','complete','blocked')),
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json))
);
CREATE INDEX native_checkout_grant_access ON native_checkout_grants(capability_hash,expires_ms);
