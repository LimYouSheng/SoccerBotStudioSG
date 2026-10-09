-- Extend the existing finite operation grant owner for one guest-owned catalogue read.
CREATE TABLE developer_operations_catalogue (
  capability_hash TEXT PRIMARY KEY,
  operation TEXT NOT NULL CHECK(operation IN ('provider_identity','historical_comparison','native_field_discovery','customer_catalogue','native_recovery_window')),
  expires_ms INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('granted','running','complete','blocked')),
  result_json TEXT
);
INSERT INTO developer_operations_catalogue SELECT * FROM developer_operations;
DROP TABLE developer_operations;
ALTER TABLE developer_operations_catalogue RENAME TO developer_operations;

CREATE INDEX developer_operation_window ON developer_operations(operation,state,expires_ms);
