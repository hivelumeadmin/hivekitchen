-- Story 3.29: brief_state tracks a soft cultural-degradation signal.
-- plan_state_enum covers both the hard-fail path (Story 3.25 audit machinery)
-- and this story's cultural-degradation path. The enum lives here so both
-- paths share the same type. Today only 'degraded' is written from
-- PlansService.handleDegradedPlan; 'hard_failed' is reserved for a future
-- story that unifies the hard-fail surface onto brief_state.
DO $$ BEGIN
  CREATE TYPE plan_state_enum AS ENUM ('hard_failed', 'degraded');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE brief_state
  ADD COLUMN IF NOT EXISTS plan_state         plan_state_enum,   -- null = no active degradation
  ADD COLUMN IF NOT EXISTS plan_state_set_at  TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS plan_state_message TEXT CHECK (char_length(plan_state_message) <= 500);
