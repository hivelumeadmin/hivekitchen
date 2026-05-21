-- Slice 2.5-s1 — Foundation: onboarding_moment_state table.
--
-- Tracks the chaptered-conversation moment progression and required-set
-- completion for each household during Epic 2.5 onboarding. Sidecar to
-- the existing thread/turn machinery (which 2-s26 reused) — the moment
-- state is a per-household scalar, not a per-thread state, so it lives
-- in its own table keyed by household_id.
--
-- The required_set_status JSONB is a map of required-set keys → boolean.
-- The exact key set is finalized in slice 2.5-s4 (agent prompt v2). This
-- slice only commits the storage shape; the empty {} default lets existing
-- households co-exist.
--
-- NAMING: `onboarding_moment_state` rather than `onboarding_state` to avoid
-- collision with the existing OnboardingStateResponseSchema (which is the
-- resumable-thread state — see packages/contracts/src/onboarding-state.ts).
-- Two distinct concerns, two distinct shapes.
--
-- Rollback:
--   DROP TABLE IF EXISTS onboarding_moment_state;

CREATE TABLE onboarding_moment_state (
  household_id uuid PRIMARY KEY REFERENCES households(id) ON DELETE CASCADE,
  current_moment text CHECK (current_moment IN (
    'pre_start',
    'm1_table',
    'm2_safe',
    'm3_taste',
    'm4_bag',
    'm5_starting_line',
    'summary',
    'finalized'
  )),
  required_set_status jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
