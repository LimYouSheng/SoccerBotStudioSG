-- Preserve every existing grant and field while allowing an explicitly approved192 ceiling.
-- Runtime defaults remain80; this migration opens no window and changes no counter.
CREATE TABLE native_checkout_grants_next (
  attempt_id TEXT UNIQUE REFERENCES attempts(id),
  capability_hash TEXT PRIMARY KEY NOT NULL REFERENCES guest_access(capability_hash),
  intent_hash TEXT,
  source_revision TEXT NOT NULL,
  contract_json TEXT NOT NULL CHECK(json_valid(contract_json)),
  not_before_ms INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL CHECK(expires_ms > not_before_ms AND expires_ms <= not_before_ms + 1200000),
  starting_used INTEGER NOT NULL CHECK(starting_used >= 0),
  maximum_used INTEGER NOT NULL CHECK(maximum_used > starting_used AND maximum_used <= 176),
  cleanup_allowed INTEGER NOT NULL DEFAULT 0 CHECK(cleanup_allowed IN (0,1)),
  state TEXT NOT NULL CHECK(state IN ('granted','running','complete','blocked')),
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  available_dates_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(available_dates_json)),
  availability_json TEXT CHECK(availability_json IS NULL OR json_valid(availability_json)),
  read_state TEXT NOT NULL DEFAULT 'available' CHECK(read_state IN ('available','reading','blocked')),
  CHECK((attempt_id IS NULL AND intent_hash IS NULL) OR (attempt_id IS NOT NULL AND intent_hash IS NOT NULL))
);
INSERT INTO native_checkout_grants_next SELECT * FROM native_checkout_grants;
DROP TABLE native_checkout_grants;
ALTER TABLE native_checkout_grants_next RENAME TO native_checkout_grants;
CREATE INDEX native_checkout_grant_access ON native_checkout_grants(capability_hash,expires_ms);
