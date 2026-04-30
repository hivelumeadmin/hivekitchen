-- Story 2.12: per-child Lunch Bag slot declaration.
-- bag_composition is a non-PII JSONB column. Shape: { main: true, snack: bool, extra: bool }.
-- main is always true and is enforced both by the API layer and a CHECK
-- constraint here so data integrity holds even if the API is bypassed.
-- The default {"main":true,"snack":true,"extra":true} is permissive — the
-- plan generator fills all slots unless a parent explicitly disables one.
-- Existing children rows receive the default automatically (NOT NULL DEFAULT).
ALTER TABLE children
  ADD COLUMN bag_composition JSONB NOT NULL
    DEFAULT '{"main":true,"snack":true,"extra":true}'::jsonb;

ALTER TABLE children
  ADD CONSTRAINT children_bag_main_true
    CHECK ((bag_composition->>'main')::boolean = true);
