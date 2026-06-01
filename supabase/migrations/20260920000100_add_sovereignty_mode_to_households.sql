-- Story 3.29: households can choose how to handle intersecting cultural rule sets.
-- 'unified': honor ALL household cultural rules simultaneously (default — may
--            produce near-empty intersections, surfaced via brief_state.plan_state='degraded').
-- 'alternating': rotate which tradition leads each day, giving each full expression.
DO $$ BEGIN
  CREATE TYPE sovereignty_mode_enum AS ENUM ('unified', 'alternating');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

ALTER TABLE households
  ADD COLUMN IF NOT EXISTS sovereignty_mode             sovereignty_mode_enum NOT NULL DEFAULT 'unified',
  ADD COLUMN IF NOT EXISTS sovereignty_mode_updated_at  TIMESTAMPTZ;
