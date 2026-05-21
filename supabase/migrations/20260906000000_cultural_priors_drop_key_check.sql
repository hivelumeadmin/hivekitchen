-- Slice 2.5-s7 — open cultural_priors.key for cuisine + cultural tags.
-- Service-layer validates against vocabulary tables (cultural_tags +
-- cuisine_tags) at write time. The CHECK was redundant with vocabulary
-- validation and blocked cuisine.declare from sharing this table per the
-- Epic 2.5 sprint-change-proposal Section 4.A.
--
-- No data migration needed — existing rows all satisfy the new (relaxed)
-- constraint (none).
--
-- Rollback:
--   ALTER TABLE cultural_priors ADD CONSTRAINT cultural_priors_key_check
--     CHECK (key IN ('halal','kosher','hindu_vegetarian','south_asian','east_african','caribbean'));

ALTER TABLE cultural_priors DROP CONSTRAINT IF EXISTS cultural_priors_key_check;
