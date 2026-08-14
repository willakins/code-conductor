ALTER TABLE open_pr_review_state
  ADD COLUMN IF NOT EXISTS last_modified_at TIMESTAMPTZ;

UPDATE open_pr_review_state
SET last_modified_at = COALESCE(last_reviewed_at, opened_for_review_at, opened_at)
WHERE last_modified_at IS NULL;

ALTER TABLE open_pr_review_state
  ALTER COLUMN last_modified_at SET NOT NULL;
