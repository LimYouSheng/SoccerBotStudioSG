-- Empty by default: an operator must install an exact-source finite capture window.
-- Capture is evidence only; it grants no provider calls or reconciliation authority.
CREATE TABLE webhook_capture_windows (
  id TEXT PRIMARY KEY,
  source_revision TEXT NOT NULL,
  account_id TEXT NOT NULL,
  environment TEXT NOT NULL CHECK(environment='developer'),
  origin TEXT NOT NULL,
  opened_ms INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL,
  maximum_receipts INTEGER NOT NULL CHECK(maximum_receipts BETWEEN 1 AND 16),
  state TEXT NOT NULL CHECK(state IN ('open','closed')),
  CHECK(expires_ms > opened_ms AND expires_ms-opened_ms <= 1200000)
);
CREATE TABLE webhook_receipts (
  window_id TEXT NOT NULL REFERENCES webhook_capture_windows(id),
  body_digest TEXT NOT NULL,
  received_ms INTEGER NOT NULL,
  sent_seconds INTEGER NOT NULL,
  body_bytes INTEGER NOT NULL CHECK(body_bytes BETWEEN 1 AND 16384),
  shape_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state='captured'),
  PRIMARY KEY(window_id,body_digest)
);
