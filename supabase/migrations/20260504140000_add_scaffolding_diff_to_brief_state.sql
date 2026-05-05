-- Story 3.11: scaffolding_diff projection field — null until Story 3.12 lands
-- per-slot swap tracking. null = no silent mutations to surface in QuietDiff.
-- Nullable (no DEFAULT '{}'::jsonb) because null has a distinct meaning here:
-- "no scaffolding mutations since last view". This differs from cleared_allergies
-- (Story 3.10) which defaults to '[]' because an empty list IS the meaningful
-- "cleared but nothing to surface" state.
--
-- Schema shape: { summary: string; explanation?: string }. The contract layer
-- (ScaffoldingDiffSchema in packages/contracts/src/plan.ts) is the validator;
-- no Postgres CHECK on jsonb structure (fragile, requires migration to relax).
--
-- The composer (apps/api/src/modules/plans/brief-state.composer.ts) writes
-- null on every refresh until Story 3.12 wires per-slot mutation tracking.
-- The full stack is wired through this story so Story 3.12 only changes the
-- composer, not the schema, DB, or repository.

ALTER TABLE brief_state
  ADD COLUMN scaffolding_diff jsonb DEFAULT NULL;
