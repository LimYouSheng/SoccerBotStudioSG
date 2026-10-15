-- Preserve every historical delivery and immutable finite proof window.
ALTER TABLE identity_delivery_dispatches ADD COLUMN ongoing INTEGER NOT NULL DEFAULT 0 CHECK(ongoing IN (0,1));
CREATE INDEX identity_dispatch_ongoing_time ON identity_delivery_dispatches(ongoing,kind,created_ms);
DROP TRIGGER identity_dispatch_limit;
CREATE TRIGGER identity_dispatch_limit BEFORE INSERT ON identity_delivery_dispatches
WHEN (NEW.ongoing=0 AND (NOT EXISTS(SELECT 1 FROM identity_delivery_window WHERE singleton=(SELECT MAX(singleton) FROM identity_delivery_window) AND state='open' AND opened_ms<=NEW.created_ms AND expires_ms>=NEW.created_ms+5000)
 OR (SELECT COUNT(*) FROM identity_delivery_dispatches WHERE kind=NEW.kind AND created_ms>=CASE WHEN (SELECT MAX(singleton) FROM identity_delivery_window)=3 THEN (SELECT opened_ms FROM identity_delivery_window WHERE singleton=3) ELSE 0 END)>=CASE WHEN (SELECT MAX(singleton) FROM identity_delivery_window)=3 THEN CASE NEW.kind WHEN 'bot' THEN 8 ELSE 6 END ELSE CASE NEW.kind WHEN 'bot' THEN 5 ELSE 3 END END
 OR (NEW.kind='bot' AND (SELECT COUNT(*) FROM identity_delivery_dispatches WHERE kind='bot' AND source_hash=NEW.source_hash AND created_ms>NEW.created_ms-60000)>=3)))
 OR (NEW.ongoing=1 AND (
   (SELECT count(*) FROM identity_delivery_dispatches WHERE ongoing=1 AND kind=NEW.kind AND created_ms>NEW.created_ms-3600000)>=CASE NEW.kind WHEN 'bot' THEN 120 ELSE 60 END
   OR (NEW.kind='bot' AND (SELECT count(*) FROM identity_delivery_dispatches WHERE kind='bot' AND source_hash=NEW.source_hash AND created_ms>NEW.created_ms-60000)>=3)))
BEGIN SELECT RAISE(ABORT,'identity_delivery_limited'); END;
CREATE TRIGGER identity_dispatch_mode_immutable BEFORE UPDATE OF ongoing ON identity_delivery_dispatches
WHEN NEW.ongoing<>OLD.ongoing
BEGIN SELECT RAISE(ABORT,'identity_dispatch_mode_immutable'); END;
