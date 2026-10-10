-- Preserve the original window and permit exactly one separately authorized
-- replacement only when the original is closed and no dispatch was ever charged.
CREATE TABLE identity_delivery_window_upgrade (
  singleton INTEGER PRIMARY KEY CHECK(singleton IN (1,2)),
  source_revision TEXT NOT NULL,
  origin TEXT NOT NULL,
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  opened_ms INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL CHECK(expires_ms>opened_ms AND expires_ms-opened_ms<=1200000),
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
BEGIN SELECT RAISE(ABORT,'identity_window_replacement_denied'); END;
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
  OR (SELECT COUNT(*) FROM identity_delivery_dispatches WHERE kind=NEW.kind)>=CASE NEW.kind WHEN 'bot' THEN 5 ELSE 3 END
  OR (NEW.kind='bot' AND (SELECT COUNT(*) FROM identity_delivery_dispatches WHERE kind='bot' AND source_hash=NEW.source_hash AND created_ms>NEW.created_ms-60000)>=3)
BEGIN SELECT RAISE(ABORT,'identity_delivery_limited'); END;
