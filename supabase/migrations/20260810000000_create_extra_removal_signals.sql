-- Story 3.22: tracks each time a parent removes an Extra item from a plan slot.
-- Used to compute passive bias after >=3 removals of the same component_type
-- in 30 days. Signals are kept indefinitely at MVP scale (90-day archival is
-- a deferred follow-up).
--
-- Mirrors:
--   - apps/api/src/modules/plans/extra-removal-signal.service.ts
CREATE TABLE IF NOT EXISTS extra_removal_signals (
  id              uuid              NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id    uuid              NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  child_id        uuid              NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  -- Component type label (e.g., 'sweet treat', 'granola bar', 'fruit'). Free-text
  -- string sourced from snack_skus.category or plan_items.ingredients[0]; not
  -- enumerated because the planner agent invents new component types over time.
  component_type  text              NOT NULL,
  -- Soft FK: the plan_item the parent removed. Set NULL on archival so the
  -- signal row outlives the plan_items row (plan_items rows are soft-archived
  -- on regen via replaced_by_plan_id).
  plan_item_id    uuid              REFERENCES plan_items(id) ON DELETE SET NULL,
  removed_at      timestamptz       NOT NULL DEFAULT now(),
  -- True once this signal has contributed to a bias update. Prevents the same
  -- removal from being counted twice across overlapping 30-day windows.
  bias_applied    boolean           NOT NULL DEFAULT false
);

-- Bias-evaluation lookup: rolling 30-day window by (child_id, component_type),
-- restricted to unapplied signals.
CREATE INDEX IF NOT EXISTS idx_extra_removal_signals_child_type_date
  ON extra_removal_signals (child_id, component_type, removed_at)
  WHERE NOT bias_applied;

-- API uses the service-role client which bypasses RLS. Enabling RLS keeps
-- anon/authed Supabase SDK callers out by default; household scoping is
-- enforced by the API layer via household_id WHERE clauses.
ALTER TABLE extra_removal_signals ENABLE ROW LEVEL SECURITY;

-- Story 3.22 audit event types.
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'plan.extra_bias_applied';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'plan.extra_proposal_created';
