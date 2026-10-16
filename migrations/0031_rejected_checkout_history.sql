-- Preserve rejected preflight grant history before allowing a new selection.
CREATE TABLE rejected_native_checkout_grants AS SELECT * FROM native_checkout_grants WHERE 0;
CREATE UNIQUE INDEX rejected_native_attempt ON rejected_native_checkout_grants(attempt_id);
CREATE TRIGGER rejected_native_preserve_update BEFORE UPDATE ON rejected_native_checkout_grants BEGIN SELECT RAISE(ABORT,'rejected_native_preserve'); END;
CREATE TRIGGER rejected_native_preserve_delete BEFORE DELETE ON rejected_native_checkout_grants BEGIN SELECT RAISE(ABORT,'rejected_native_preserve'); END;
