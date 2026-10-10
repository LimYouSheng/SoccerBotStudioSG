-- Source-only proof authority. No row is provisioned by this migration.
-- Windows 1/2 and all charged dispatches retain their exact values.
CREATE TABLE identity_delivery_window_upgrade (
  singleton INTEGER PRIMARY KEY CHECK(singleton IN (1,2,3)),
  source_revision TEXT NOT NULL,
  origin TEXT NOT NULL,
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  opened_ms INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL CHECK(expires_ms>opened_ms AND expires_ms-opened_ms<=CASE singleton WHEN 3 THEN 3600000 ELSE 1200000 END),
  state TEXT NOT NULL CHECK(state IN ('open','closed'))
);
INSERT INTO identity_delivery_window_upgrade SELECT * FROM identity_delivery_window;
DROP TRIGGER identity_dispatch_limit;
DROP TABLE identity_delivery_window;
ALTER TABLE identity_delivery_window_upgrade RENAME TO identity_delivery_window;
CREATE TRIGGER identity_window_admission BEFORE INSERT ON identity_delivery_window
WHEN NEW.state<>'open'
 OR (NEW.singleton=2 AND (
   NOT EXISTS(SELECT 1 FROM identity_delivery_window WHERE singleton=1 AND state='closed' AND opened_ms<NEW.opened_ms)
   OR EXISTS(SELECT 1 FROM identity_delivery_dispatches)))
 OR (NEW.singleton=3 AND (
   (SELECT COUNT(*) FROM identity_delivery_window WHERE singleton IN (1,2) AND state='closed' AND expires_ms<=NEW.opened_ms)<>2
   OR EXISTS(SELECT 1 FROM identity_delivery_dispatches WHERE created_ms>=NEW.opened_ms)
   OR length(NEW.source_revision)<>40 OR NEW.source_revision GLOB '*[^a-f0-9]*'
   OR NEW.sender<>'SoccerBotStudioSG Dev <noreply@auth.app404.ai>'
   OR NEW.recipient<>'sheng@app404.ai'))
BEGIN SELECT RAISE(ABORT,'identity_window_proof_denied'); END;
CREATE TRIGGER identity_window_immutable BEFORE UPDATE ON identity_delivery_window
WHEN NEW.singleton<>OLD.singleton OR NEW.source_revision<>OLD.source_revision
 OR NEW.origin<>OLD.origin OR NEW.sender<>OLD.sender OR NEW.recipient<>OLD.recipient
 OR NEW.opened_ms<>OLD.opened_ms OR NEW.expires_ms<>OLD.expires_ms
 OR OLD.state='closed' OR NEW.state<>'closed'
BEGIN SELECT RAISE(ABORT,'identity_window_immutable'); END;
CREATE TRIGGER identity_window_preserve BEFORE DELETE ON identity_delivery_window
BEGIN SELECT RAISE(ABORT,'identity_window_preserve'); END;
CREATE TRIGGER identity_dispatch_limit BEFORE INSERT ON identity_delivery_dispatches
WHEN NOT EXISTS(SELECT 1 FROM identity_delivery_window WHERE singleton=(SELECT MAX(singleton) FROM identity_delivery_window) AND state='open' AND opened_ms<=NEW.created_ms AND expires_ms>=NEW.created_ms+5000)
 OR (SELECT COUNT(*) FROM identity_delivery_dispatches WHERE kind=NEW.kind AND created_ms>=CASE WHEN (SELECT MAX(singleton) FROM identity_delivery_window)=3 THEN (SELECT opened_ms FROM identity_delivery_window WHERE singleton=3) ELSE 0 END)>=CASE WHEN (SELECT MAX(singleton) FROM identity_delivery_window)=3 THEN CASE NEW.kind WHEN 'bot' THEN 8 ELSE 6 END ELSE CASE NEW.kind WHEN 'bot' THEN 5 ELSE 3 END END
 OR (NEW.kind='bot' AND (SELECT COUNT(*) FROM identity_delivery_dispatches WHERE kind='bot' AND source_hash=NEW.source_hash AND created_ms>NEW.created_ms-60000)>=3)
BEGIN SELECT RAISE(ABORT,'identity_delivery_limited'); END;
-- The same durable close fences challenges and delayed credential issuance.
-- Family triggers also revoke restored guests. No attempt/recovery row is deleted.
CREATE TRIGGER identity_proof_close AFTER UPDATE OF state ON identity_delivery_window
WHEN NEW.singleton=3 AND OLD.state='open' AND NEW.state='closed'
BEGIN
 UPDATE guest_access SET revoked_ms=MIN(NEW.expires_ms,CAST(unixepoch('now') AS INTEGER)*1000)
 WHERE revoked_ms IS NULL AND capability_hash IN
 (SELECT access_hash FROM identity_delivery_dispatches WHERE created_ms>=NEW.opened_ms AND created_ms<NEW.expires_ms);
 UPDATE verified_identity SET revoked_ms=MIN(NEW.expires_ms,CAST(unixepoch('now') AS INTEGER)*1000)
 WHERE revoked_ms IS NULL AND access_hash IN
 (SELECT access_hash FROM identity_delivery_dispatches WHERE created_ms>=NEW.opened_ms AND created_ms<NEW.expires_ms);
END;
