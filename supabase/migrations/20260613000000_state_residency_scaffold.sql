-- Story 7-S12: State-residency override scaffold (AR-21, NFR-COMP-3).
-- households.state_residency: nullable 2-letter US state code.
-- NULL = state unknown / default COPPA baseline applies.
-- Populated by Epic 8 billing flow when user provides a billing address.
-- state_compliance_overrides: future state-specific compliance deltas.
-- No rows are seeded at MVP — getOverridesForHousehold always returns [].

ALTER TABLE households
  ADD COLUMN IF NOT EXISTS state_residency TEXT;

CREATE TABLE IF NOT EXISTS state_compliance_overrides (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  state            TEXT NOT NULL,
  override_type    TEXT NOT NULL,
  value            JSONB NOT NULL DEFAULT '{}'::jsonb,
  effective_from   DATE NOT NULL,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_state_compliance_overrides_state
  ON state_compliance_overrides (state);
