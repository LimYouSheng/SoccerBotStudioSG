-- Extend the existing one-use operator owner. Preserve every prior grant/result.
-- Apply only while admission is closed, after immutable 0006 and 0007.
CREATE TABLE developer_operations_discovery (
  capability_hash TEXT PRIMARY KEY,
  operation TEXT NOT NULL CHECK (operation IN ('provider_identity','historical_comparison','native_field_discovery')),
  expires_ms INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('granted','running','complete','blocked')),
  result_json TEXT
);
INSERT INTO developer_operations_discovery SELECT * FROM developer_operations;
DROP TABLE developer_operations;
ALTER TABLE developer_operations_discovery RENAME TO developer_operations;
