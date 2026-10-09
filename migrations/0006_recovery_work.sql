-- Scheduling metadata only. Admission closed; never replay an unknown write.
CREATE TABLE recovery_work (
  attempt_id TEXT PRIMARY KEY REFERENCES attempts(id),
  state TEXT NOT NULL CHECK(state IN ('due','claimed','complete','manual_review')),
  ready_ms INTEGER NOT NULL,
  generation INTEGER NOT NULL DEFAULT 0,
  claimant TEXT,
  attempt_version INTEGER,
  tries INTEGER NOT NULL DEFAULT 0,
  reason TEXT NOT NULL DEFAULT 'interrupted',
  updated_ms INTEGER NOT NULL,
  CHECK ((state='claimed' AND claimant IS NOT NULL AND attempt_version IS NOT NULL) OR state!='claimed')
);
CREATE INDEX recovery_due ON recovery_work(ready_ms,attempt_id) WHERE state IN ('due','claimed');
-- Preserve every old byte; old dispatched work is eligible for classification,
-- not replay. A canonical confirmed observation can close it without a read.
INSERT INTO recovery_work(attempt_id,state,ready_ms,updated_ms)
SELECT attempt_id,'due',started_ms+60000,started_ms FROM dispatches;
CREATE TRIGGER schedule_dispatch_recovery AFTER INSERT ON dispatches
BEGIN
  INSERT INTO recovery_work(attempt_id,state,ready_ms,updated_ms)
  VALUES(NEW.attempt_id,'due',NEW.started_ms+60000,NEW.started_ms);
END;
CREATE TRIGGER expedite_required_recovery AFTER UPDATE OF state ON attempts
WHEN NEW.state='recovery_required' AND OLD.state!='recovery_required'
BEGIN
  UPDATE recovery_work SET ready_ms=0 WHERE attempt_id=NEW.id AND state='due';
END;
CREATE INDEX access_retention ON guest_access(expires_ms,capability_hash);
