-- Story 3.12: sick-day pause. NULL = active; non-NULL = paused at that timestamp.
-- Pausing does NOT alter plan ingredients — the slot remains intact for Lunch Link
-- context and future un-pause. Lunch Link delivery (Epic 4) reads paused_at to skip.
ALTER TABLE plan_items
  ADD COLUMN paused_at TIMESTAMPTZ DEFAULT NULL;
