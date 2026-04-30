-- Story 2.11: cultural_priors — per-household cultural template priors.
-- presence (0-100) is NOT zero-sum; multiple priors can each be 100.
-- state machine: detected → opt_in_confirmed | forgotten (Story 2.11).
--   L2/L3 transitions and active/dormant states wired in Stories 5.12/5.14.
-- Unique (household_id, key): one row per template per household.
CREATE TABLE cultural_priors (
  id               uuid        NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  household_id     uuid        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
  key              text        NOT NULL
                   CHECK (key IN ('halal','kosher','hindu_vegetarian','south_asian','east_african','caribbean')),
  label            text        NOT NULL,
  tier             text        NOT NULL DEFAULT 'L1' CHECK (tier IN ('L1','L2','L3')),
  state            text        NOT NULL DEFAULT 'detected'
                   CHECK (state IN ('detected','suggested','opt_in_confirmed','active','dormant','forgotten')),
  presence         smallint    NOT NULL DEFAULT 50 CHECK (presence >= 0 AND presence <= 100),
  confidence       smallint    NOT NULL DEFAULT 50 CHECK (confidence >= 0 AND confidence <= 100),
  opted_in_at      timestamptz,
  opted_out_at     timestamptz,
  last_signal_at   timestamptz NOT NULL DEFAULT now(),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (household_id, key)
);
CREATE INDEX cultural_priors_household_id_idx ON cultural_priors (household_id);
