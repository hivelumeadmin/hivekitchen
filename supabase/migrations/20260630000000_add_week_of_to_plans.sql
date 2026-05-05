-- Story 3.13: store the human-readable week start date on each plan row so
-- the regeneration route can call orchestrator.planWeek(week_of) without
-- reversing the deriveWeekId() SHA-256 hash.
-- VARCHAR(10) stores ISO 8601 date ('2026-04-28'). DEFAULT NULL so existing
-- rows parse cleanly before backfill; the app always sets it on new commits.
ALTER TABLE plans
  ADD COLUMN week_of VARCHAR(10) DEFAULT NULL;
