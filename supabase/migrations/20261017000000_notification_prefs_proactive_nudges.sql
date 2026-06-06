-- Story 12-S12: add `proactive_lumi_nudges` to users.notification_prefs.
--
-- The nudge worker (lumi-nudge.job) reads this flag for the household's primary
-- parent before persisting/emitting a proactive Lumi nudge. Absent = opted-in
-- (the service applies a `?? true` fallback), so the backfill only needs to
-- stamp rows that predate the field and the column default is widened to carry
-- it for new rows.

-- Backfill existing rows that lack the key (idempotent — JSONB `||` is a merge).
UPDATE users
SET notification_prefs = notification_prefs || '{"proactive_lumi_nudges": true}'::jsonb
WHERE notification_prefs->>'proactive_lumi_nudges' IS NULL;

-- Widen the column default so freshly-inserted rows carry the field as true.
ALTER TABLE users
ALTER COLUMN notification_prefs
SET DEFAULT '{"weekly_plan_ready": true, "grocery_list_ready": true, "proactive_lumi_nudges": true}'::jsonb;
