-- Display-only milestone; never authorizes payment or extends the hold.
CREATE TABLE checkout_review_progress (
 attempt_id TEXT PRIMARY KEY REFERENCES attempts(id),
 validated_ms INTEGER NOT NULL
);
CREATE TRIGGER checkout_review_preserve_update BEFORE UPDATE ON checkout_review_progress BEGIN SELECT RAISE(ABORT,'checkout_review_preserve'); END;
CREATE TRIGGER checkout_review_preserve_delete BEFORE DELETE ON checkout_review_progress BEGIN SELECT RAISE(ABORT,'checkout_review_preserve'); END;
