-- Bound scheduled selection by live grant expiry, preserving all history.
CREATE INDEX native_checkout_ongoing_expiry ON native_checkout_grants(ongoing,expires_ms,attempt_id);
