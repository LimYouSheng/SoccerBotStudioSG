-- Preserve every existing grant and field while allowing an explicitly approved640 ceiling.
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
  maximum_used INTEGER NOT NULL CHECK(maximum_used > starting_used AND maximum_used <= 624),
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

-- Empty, finite operator authority. Applied historical grants are retained above.
CREATE TABLE webhook_subscription_grants (
  window_id TEXT PRIMARY KEY NOT NULL REFERENCES webhook_capture_windows(id),
  create_hash TEXT UNIQUE NOT NULL CHECK(length(create_hash)=64),
  cleanup_hash TEXT UNIQUE NOT NULL CHECK(length(cleanup_hash)=64 AND cleanup_hash<>create_hash),
  starting_used INTEGER NOT NULL CHECK(starting_used>=0),
  maximum_used INTEGER NOT NULL CHECK(maximum_used>starting_used AND maximum_used<=624 AND maximum_used<=starting_used+80),
  calls_used INTEGER NOT NULL DEFAULT 0 CHECK(calls_used BETWEEN 0 AND 20),
  state TEXT NOT NULL DEFAULT 'granted' CHECK(state IN ('granted','inspecting','creating','create_unknown','active','cleaning','deleting','delete_unknown','closed','blocked')),
  baseline_json TEXT CHECK(baseline_json IS NULL OR json_valid(baseline_json)),
  subscription_id TEXT,
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json))
);
-- Inert until an evidenced mapper is enabled in tested source. This binds a
-- future hint to one approved new attempt, including callback-before-association.
CREATE TABLE webhook_recovery_scopes (
  window_id TEXT PRIMARY KEY NOT NULL REFERENCES webhook_capture_windows(id),
  attempt_id TEXT UNIQUE NOT NULL REFERENCES attempts(id)
);
CREATE TABLE webhook_pending_hints (
  window_id TEXT NOT NULL REFERENCES webhook_recovery_scopes(window_id),
  body_digest TEXT NOT NULL,
  booking_id TEXT NOT NULL CHECK(length(booking_id) BETWEEN 1 AND 15 AND booking_id NOT GLOB '*[^0-9]*' AND substr(booking_id,1,1) BETWEEN '1' AND '9'),
  state TEXT NOT NULL CHECK(state IN ('pending','matched','ignored')),
  PRIMARY KEY(window_id,body_digest),
  FOREIGN KEY(window_id,body_digest) REFERENCES webhook_receipts(window_id,body_digest)
);
