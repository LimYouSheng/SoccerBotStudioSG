-- Additive one-use operator authorization, separate from customer attempts.
-- Only the Cloudflare management operator creates grants; no public grant route.
CREATE TABLE developer_operations (
  capability_hash TEXT PRIMARY KEY,
  operation TEXT NOT NULL CHECK (operation = 'provider_identity'),
  expires_ms INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('granted','running','complete','blocked')),
  result_json TEXT
);
