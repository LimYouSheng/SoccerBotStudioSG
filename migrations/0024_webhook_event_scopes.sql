-- Additive diagnostic routing. Existing windows retain their legacy booking
-- route without modifying any historical row. No window is opened here.
CREATE TABLE webhook_event_scopes (
  window_id TEXT PRIMARY KEY NOT NULL REFERENCES webhook_capture_windows(id),
  event TEXT NOT NULL CHECK(event IN ('new_booking','new_invoice'))
);
CREATE TRIGGER webhook_event_scope_immutable_update
BEFORE UPDATE ON webhook_event_scopes
BEGIN SELECT RAISE(ABORT,'webhook event scope is immutable'); END;
CREATE TRIGGER webhook_event_scope_immutable_delete
BEFORE DELETE ON webhook_event_scopes
BEGIN SELECT RAISE(ABORT,'webhook event scope is immutable'); END;
