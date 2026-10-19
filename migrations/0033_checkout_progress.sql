-- New attempts only: immutable creation time and customer confirmation proof.
-- Historical attempts and financial/effect journals remain unchanged.
CREATE TABLE checkout_progress (
 attempt_id TEXT PRIMARY KEY REFERENCES attempts(id),
 booking_created_ms INTEGER NOT NULL,
 confirmation_json TEXT CHECK(confirmation_json IS NULL OR json_valid(confirmation_json))
);
CREATE TRIGGER checkout_creation_immutable BEFORE UPDATE OF attempt_id,booking_created_ms ON checkout_progress BEGIN SELECT RAISE(ABORT,'checkout_creation_immutable'); END;
CREATE TRIGGER checkout_confirmation_immutable BEFORE UPDATE OF confirmation_json ON checkout_progress WHEN OLD.confirmation_json IS NOT NULL AND NEW.confirmation_json IS NOT OLD.confirmation_json BEGIN SELECT RAISE(ABORT,'checkout_confirmation_immutable'); END;
CREATE TRIGGER checkout_progress_preserve BEFORE DELETE ON checkout_progress BEGIN SELECT RAISE(ABORT,'checkout_progress_preserve'); END;
CREATE TABLE expired_native_checkout_grants AS SELECT * FROM native_checkout_grants WHERE 0;
CREATE UNIQUE INDEX expired_native_attempt ON expired_native_checkout_grants(attempt_id);
CREATE TRIGGER expired_native_preserve_update BEFORE UPDATE ON expired_native_checkout_grants BEGIN SELECT RAISE(ABORT,'expired_native_preserve'); END;
CREATE TRIGGER expired_native_preserve_delete BEFORE DELETE ON expired_native_checkout_grants BEGIN SELECT RAISE(ABORT,'expired_native_preserve'); END;
