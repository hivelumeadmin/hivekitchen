-- Slice 2.5-s1 — Foundation: cultural_priors.enforcement column.
--
-- Adds enforcement strength to cultural priors. Default 'just_for_context'
-- matches today's shipped behaviour (priors are advisory; planner respects
-- but never gates on them). Promotion to 'strong' / 'non_negotiable' happens
-- via the cultural ratification flow (slice 2.5-s7 + 2.5-s10) when a parent
-- elevates a soft signal to a hard rule.
--
-- The cultural_priors state machine (state column: detected → suggested →
-- opt_in_confirmed → active → dormant → forgotten) is unchanged — enforcement
-- is an orthogonal axis.
--
-- Rollback:
--   ALTER TABLE cultural_priors DROP COLUMN IF EXISTS enforcement;

ALTER TABLE cultural_priors
  ADD COLUMN enforcement enforcement_level NOT NULL DEFAULT 'just_for_context';
