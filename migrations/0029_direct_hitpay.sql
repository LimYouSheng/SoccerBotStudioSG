-- Additive payment provenance; existing native attempts keep their route.
CREATE TABLE checkout_payment_routes (
 attempt_id TEXT PRIMARY KEY REFERENCES attempts(id),
 route TEXT NOT NULL CHECK(route IN ('native','hitpay'))
);
CREATE TRIGGER checkout_route_immutable BEFORE UPDATE ON checkout_payment_routes BEGIN SELECT RAISE(ABORT,'payment_route_immutable'); END;
CREATE TRIGGER checkout_route_preserve BEFORE DELETE ON checkout_payment_routes BEGIN SELECT RAISE(ABORT,'payment_route_preserve'); END;
CREATE TABLE hitpay_payments (
 attempt_id TEXT PRIMARY KEY REFERENCES attempts(id),
 scope_json TEXT NOT NULL CHECK(json_valid(scope_json)),
 reference TEXT NOT NULL UNIQUE,
 request_id TEXT UNIQUE,
 checkout_url TEXT,
 expires_ms INTEGER NOT NULL,
 created_ms INTEGER NOT NULL,
 recovery_end_ms INTEGER NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('due','claimed','complete','manual_review')),
 reason TEXT NOT NULL,
 tries INTEGER NOT NULL DEFAULT 0,
 ready_ms INTEGER NOT NULL,
 generation INTEGER NOT NULL DEFAULT 0,
 paid_ms INTEGER,
 payment_id TEXT UNIQUE,
 external_reservation TEXT,
 external_state TEXT NOT NULL DEFAULT 'none' CHECK(external_state IN ('none','unknown','observed'))
);
CREATE INDEX hitpay_due ON hitpay_payments(state,ready_ms,attempt_id);
CREATE TRIGGER hitpay_scope_immutable BEFORE UPDATE OF attempt_id,scope_json,reference,expires_ms,created_ms,recovery_end_ms ON hitpay_payments BEGIN SELECT RAISE(ABORT,'payment_scope_immutable'); END;
CREATE TRIGGER hitpay_identity_immutable BEFORE UPDATE ON hitpay_payments WHEN (OLD.external_reservation IS NOT NULL AND NEW.external_reservation IS NOT OLD.external_reservation) OR (OLD.request_id IS NOT NULL AND NEW.request_id IS NOT OLD.request_id) OR (OLD.payment_id IS NOT NULL AND NEW.payment_id IS NOT OLD.payment_id) OR (OLD.paid_ms IS NOT NULL AND NEW.paid_ms IS NOT OLD.paid_ms) OR (OLD.external_state='observed' AND NEW.external_state!='observed') OR (OLD.external_state='unknown' AND NEW.external_state='none') BEGIN SELECT RAISE(ABORT,'payment_evidence_immutable'); END;
CREATE TRIGGER hitpay_preserve BEFORE DELETE ON hitpay_payments BEGIN SELECT RAISE(ABORT,'payment_preserve'); END;
CREATE TABLE hitpay_receipts (
 digest TEXT PRIMARY KEY,
 attempt_id TEXT NOT NULL REFERENCES hitpay_payments(attempt_id),
 received_ms INTEGER NOT NULL
);
CREATE INDEX hitpay_receipt_attempt ON hitpay_receipts(attempt_id);
CREATE TRIGGER hitpay_receipt_limit BEFORE INSERT ON hitpay_receipts WHEN NOT EXISTS (SELECT 1 FROM hitpay_receipts WHERE digest=NEW.digest) AND (SELECT COUNT(*) FROM hitpay_receipts WHERE attempt_id=NEW.attempt_id)>=64 BEGIN SELECT RAISE(ABORT,'hitpay_receipt_limit'); END;
CREATE TRIGGER hitpay_receipt_immutable BEFORE UPDATE ON hitpay_receipts BEGIN SELECT RAISE(ABORT,'hitpay_receipt_immutable'); END;
CREATE TRIGGER hitpay_receipt_preserve BEFORE DELETE ON hitpay_receipts BEGIN SELECT RAISE(ABORT,'hitpay_receipt_preserve'); END;
CREATE TABLE hitpay_holds (
 attempt_id TEXT PRIMARY KEY REFERENCES attempts(id),
 scope_json TEXT NOT NULL CHECK(json_valid(scope_json)),
 association_json TEXT NOT NULL CHECK(json_valid(association_json)),
 intent_hash TEXT NOT NULL,
 expires_ms INTEGER NOT NULL
);
CREATE TRIGGER hitpay_hold_immutable BEFORE UPDATE ON hitpay_holds BEGIN SELECT RAISE(ABORT,'hitpay_hold_immutable'); END;
CREATE TRIGGER hitpay_hold_preserve BEFORE DELETE ON hitpay_holds BEGIN SELECT RAISE(ABORT,'hitpay_hold_preserve'); END;
