-- Source-only. Empty by default; provisioning requires a separate finite grant.
CREATE TABLE identity_delivery_window (
  singleton INTEGER PRIMARY KEY CHECK(singleton=1),
  source_revision TEXT NOT NULL,
  origin TEXT NOT NULL,
  sender TEXT NOT NULL,
  recipient TEXT NOT NULL,
  opened_ms INTEGER NOT NULL,
  expires_ms INTEGER NOT NULL CHECK(expires_ms>opened_ms AND expires_ms-opened_ms<=1200000),
  state TEXT NOT NULL CHECK(state IN ('open','closed'))
);
CREATE TRIGGER identity_window_immutable BEFORE UPDATE ON identity_delivery_window
WHEN NEW.singleton<>OLD.singleton OR NEW.source_revision<>OLD.source_revision
  OR NEW.origin<>OLD.origin OR NEW.sender<>OLD.sender OR NEW.recipient<>OLD.recipient
  OR NEW.opened_ms<>OLD.opened_ms OR NEW.expires_ms<>OLD.expires_ms
  OR OLD.state='closed' OR NEW.state<>'closed'
BEGIN SELECT RAISE(ABORT,'identity_window_immutable'); END;
CREATE TRIGGER identity_window_preserve BEFORE DELETE ON identity_delivery_window
BEGIN SELECT RAISE(ABORT,'identity_window_preserve'); END;
CREATE TABLE identity_delivery_dispatches (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('bot','email')),
  access_hash TEXT NOT NULL,
  source_hash TEXT NOT NULL,
  created_ms INTEGER NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('reserved','responded','unknown'))
);
CREATE INDEX identity_dispatch_kind ON identity_delivery_dispatches(kind);
CREATE INDEX identity_dispatch_source ON identity_delivery_dispatches(source_hash,created_ms);
CREATE TRIGGER identity_dispatch_limit BEFORE INSERT ON identity_delivery_dispatches
WHEN NOT EXISTS(SELECT 1 FROM identity_delivery_window WHERE singleton=1 AND state='open' AND opened_ms<=NEW.created_ms AND expires_ms>=NEW.created_ms+5000)
  OR (SELECT COUNT(*) FROM identity_delivery_dispatches WHERE kind=NEW.kind)>=CASE NEW.kind WHEN 'bot' THEN 5 ELSE 3 END
  OR (NEW.kind='bot' AND (SELECT COUNT(*) FROM identity_delivery_dispatches WHERE kind='bot' AND source_hash=NEW.source_hash AND created_ms>NEW.created_ms-60000)>=3)
BEGIN SELECT RAISE(ABORT,'identity_delivery_limited'); END;
CREATE TRIGGER identity_dispatch_preserve BEFORE DELETE ON identity_delivery_dispatches
BEGIN SELECT RAISE(ABORT,'identity_dispatch_preserve'); END;
CREATE TRIGGER identity_dispatch_immutable BEFORE UPDATE ON identity_delivery_dispatches
WHEN NEW.id<>OLD.id OR NEW.kind<>OLD.kind OR NEW.access_hash<>OLD.access_hash
 OR NEW.source_hash<>OLD.source_hash OR NEW.created_ms<>OLD.created_ms
 OR OLD.state<>'reserved' OR NEW.state='reserved'
BEGIN SELECT RAISE(ABORT,'identity_dispatch_immutable'); END;
