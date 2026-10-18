-- Explicitly dismissed, verified completed grants retain their original bytes.
CREATE TABLE completed_native_checkout_grants AS SELECT * FROM native_checkout_grants WHERE 0;
CREATE UNIQUE INDEX completed_native_attempt ON completed_native_checkout_grants(attempt_id);
CREATE TRIGGER completed_native_preserve_update BEFORE UPDATE ON completed_native_checkout_grants BEGIN SELECT RAISE(ABORT,'completed_native_preserve'); END;
CREATE TRIGGER completed_native_preserve_delete BEFORE DELETE ON completed_native_checkout_grants BEGIN SELECT RAISE(ABORT,'completed_native_preserve'); END;
