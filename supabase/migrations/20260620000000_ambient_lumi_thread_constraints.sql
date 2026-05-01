-- Story 12.4 — ADR-002 Decision 3: ambient Lumi merges voice + text into one
-- thread per surface. The Story 2.7 unique index
-- `threads_one_active_per_household_type_modality` modality-discriminates ALL
-- types, which would force ambient surfaces to keep separate voice and text
-- threads — incompatible with Lumi's "modality is per-turn, not per-thread" model.
--
-- This migration replaces that single index with two narrow partial indexes:
--   * onboarding keeps its modality discriminator (voice and text onboarding
--     are distinct flows; never share a thread).
--   * Every other type gets a modality-agnostic constraint — one active thread
--     per (household_id, type), regardless of modality.
--
-- The `modality` column itself is preserved (stored on existing onboarding rows;
-- still useful as a per-turn-flavor hint and for analytics). The NOT NULL
-- constraint is retained — Story 12.5 (ambient thread creation) will write a
-- modality value on each ambient thread (sentinel or initial-modality); if a
-- future story decides ambient threads should carry NULL, that is its
-- migration to write.
--
-- Why two partial indexes rather than one: a single partial index would have
-- to either include or exclude `modality` — including breaks ambient (two
-- active threads same surface, different modality), excluding breaks
-- onboarding (lets voice + text onboarding coexist). The two-index split is
-- the correct fit.
--
-- Timestamp note: the story spec proposed `20260601000000`, which is now
-- occupied by Story 2.13's memory_nodes migration. Bumped to `20260620000000`
-- to keep ordering monotonic against the stories merged after 12.4 was authored.
--
-- Rollback:
--   DROP INDEX IF EXISTS threads_one_active_per_onboarding_type_modality;
--   DROP INDEX IF EXISTS threads_one_active_per_household_type;
--   CREATE UNIQUE INDEX threads_one_active_per_household_type_modality
--     ON threads(household_id, type, modality)
--     WHERE status = 'active';

DROP INDEX IF EXISTS threads_one_active_per_household_type_modality;

-- Onboarding keeps its modality discriminator: at most one active onboarding
-- thread per (household, modality). Voice onboarding and text onboarding
-- remain separate — Story 2.7's invariant.
CREATE UNIQUE INDEX threads_one_active_per_onboarding_type_modality
  ON threads (household_id, type, modality)
  WHERE status = 'active' AND type = 'onboarding';

-- Ambient surfaces (every non-onboarding type): one active thread per
-- (household, type), modality-agnostic. Voice and text turns share the same
-- thread row.
CREATE UNIQUE INDEX threads_one_active_per_household_type
  ON threads (household_id, type)
  WHERE status = 'active' AND type != 'onboarding';
