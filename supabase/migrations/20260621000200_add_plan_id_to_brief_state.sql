-- Story 3.12: expose plan_id in brief_state so the client can call
-- PATCH /v1/plans/:planId/items/:itemId without a separate plan lookup.
-- Nullable DEFAULT NULL so existing rows parse cleanly before next composer refresh.
ALTER TABLE brief_state
  ADD COLUMN plan_id UUID DEFAULT NULL REFERENCES plans(id) ON DELETE SET NULL;
