-- Story 3.21: per-child Extra slot pin/ban rules stored as JSONB.
-- Structure: { pins: string[], bans: string[] }
-- pins: component types to always include ("fruit", "veggie", "grain")
-- bans: component types to never include ("sweet treat", "chocolate", "candy")
ALTER TABLE children
  ADD COLUMN IF NOT EXISTS extra_rules JSONB NOT NULL DEFAULT '{"pins":[],"bans":[]}'::jsonb;

-- Household-level library of parent-authored reusable Extra items.
-- Parents can save custom entries (e.g., "homemade oat bar") for repeated use.
CREATE TABLE IF NOT EXISTS extra_library (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id    UUID NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  description     TEXT,
  component_type  TEXT NOT NULL,
  -- Parent-declared allergen-free flag; may differ from system inference.
  is_allergen_free BOOLEAN NOT NULL DEFAULT false,
  -- Soft-delete: archived rows are excluded from list queries but retained
  -- so plan_items references and audit history continue to resolve.
  archived_at     TIMESTAMPTZ,
  created_by      UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_extra_library_household
  ON extra_library(household_id)
  WHERE archived_at IS NULL;

-- Automatically maintain updated_at on extra_library rows (matches project trigger pattern).
CREATE TRIGGER extra_library_set_updated_at
  BEFORE UPDATE ON extra_library
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- RLS: SELECT only (all mutations go through the service-role client which bypasses RLS).
-- UPDATE policies intentionally omitted — same rationale as users/households migration.
ALTER TABLE extra_library ENABLE ROW LEVEL SECURITY;

CREATE POLICY extra_library_member_select_policy ON extra_library
  FOR SELECT USING (
    household_id = (
      SELECT current_household_id FROM users WHERE id = auth.uid()
    )
  );

-- Audit event types for Story 3.21.
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'child.extra_rules_updated';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'household.extra_library_item_created';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'household.extra_library_item_archived';
