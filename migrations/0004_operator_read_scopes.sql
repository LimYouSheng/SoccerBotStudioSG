-- Preserve all grants/results while extending the operation vocabulary.
-- Apply with admission closed. If interrupted, finish the preserved table's
-- rename; never reconstruct empty grants or replay a running operation.
CREATE TABLE developer_operations_migrating (
  capability_hash TEXT PRIMARY KEY,
  operation TEXT NOT NULL CHECK (operation IN ('provider_identity','historical_comparison')),
  expires_ms INTEGER NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('granted','running','complete','blocked')),
  result_json TEXT
);
INSERT INTO developer_operations_migrating SELECT * FROM developer_operations;
DROP TABLE developer_operations;
ALTER TABLE developer_operations_migrating RENAME TO developer_operations;
