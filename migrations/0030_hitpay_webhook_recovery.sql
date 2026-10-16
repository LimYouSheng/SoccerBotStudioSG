-- Keep the original financial deadline and counters; authenticated novel receipts
-- may grant at most four additional authoritative reconciliation attempts.
ALTER TABLE hitpay_payments ADD COLUMN retry_limit INTEGER NOT NULL DEFAULT 12 CHECK(retry_limit BETWEEN 12 AND 16);
ALTER TABLE hitpay_payments ADD COLUMN receipt_checkpoint INTEGER NOT NULL DEFAULT 0 CHECK(receipt_checkpoint >= 0);
-- Existing receipts are already observed; replaying them must not reopen work.
UPDATE hitpay_payments SET receipt_checkpoint=COALESCE((SELECT MAX(rowid) FROM hitpay_receipts WHERE attempt_id=hitpay_payments.attempt_id),0);
CREATE TRIGGER hitpay_retry_limit_monotonic BEFORE UPDATE OF retry_limit ON hitpay_payments WHEN NEW.retry_limit < OLD.retry_limit BEGIN SELECT RAISE(ABORT,'payment_retry_limit_monotonic'); END;
