-- Preserve prior policy for existing attempts; new creation records opt in.
ALTER TABLE checkout_progress ADD COLUMN payment_window_ms INTEGER NOT NULL DEFAULT 300000 CHECK(payment_window_ms IN (300000,480000));
ALTER TABLE checkout_progress ADD COLUMN hold_window_ms INTEGER NOT NULL DEFAULT 600000 CHECK(hold_window_ms IN (600000,900000));
CREATE TRIGGER checkout_windows_immutable BEFORE UPDATE OF payment_window_ms,hold_window_ms ON checkout_progress BEGIN SELECT RAISE(ABORT,'checkout_windows_immutable'); END;
