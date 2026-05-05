-- Story 3.13: archive semantics for regenerated plan items.
-- When a plan is regenerated (commit_plan called a second time on the same
-- plan_id), old items are marked replaced_by_plan_id = <plan_id> (self-
-- reference: "superseded when this plan was last updated") rather than
-- deleted. New items for the new generation have replaced_by_plan_id = NULL.
-- This preserves history for Story 3.15 (historical plans view) and lets
-- the guardrail audit trail reconstruct the original composition.
ALTER TABLE plan_items
  ADD COLUMN replaced_by_plan_id UUID DEFAULT NULL REFERENCES plans(id) ON DELETE SET NULL;

-- Partial index: only rows that are archived benefit from this index.
CREATE INDEX idx_plan_items_replaced_by_plan_id
  ON plan_items(replaced_by_plan_id)
  WHERE replaced_by_plan_id IS NOT NULL;

-- Partial index: current items per plan — used by findItemsByPlanId().
-- plan_id is first because it's the equality filter; replaced_by_plan_id IS NULL
-- ensures the index is scanned only for current (non-archived) rows.
CREATE INDEX idx_plan_items_plan_id_current
  ON plan_items(plan_id)
  WHERE replaced_by_plan_id IS NULL;
