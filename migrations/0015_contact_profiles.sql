-- Website-confirmed contact only. No booking history or provider identifiers.
-- Additive and source-only until a separately approved deployment.
CREATE TABLE contact_profiles (
  account_id TEXT NOT NULL,
  origin TEXT NOT NULL,
  email TEXT NOT NULL,
  name TEXT NOT NULL CHECK(length(name) BETWEEN 2 AND 80),
  phone TEXT NOT NULL CHECK(length(phone) BETWEEN 8 AND 24),
  updated_ms INTEGER NOT NULL CHECK(updated_ms>=0),
  PRIMARY KEY(account_id,origin,email)
);
