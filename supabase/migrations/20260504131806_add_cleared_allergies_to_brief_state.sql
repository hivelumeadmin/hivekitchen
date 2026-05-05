-- Story 3.10: cleared_allergies projection field — one entry per
-- (child_id, allergen) pair the guardrail cleared for the current plan.
-- See packages/contracts/src/plan.ts ClearedAllergyEntrySchema for the
-- per-entry shape.
--
-- Default '[]' so all existing brief_state rows remain valid; the next
-- plan.updated event refreshes the projection with real data. Idempotent
-- rollout — no flag-flip needed (Zod schema mirrors the SQL default with
-- .default([])).
--
-- No CHECK constraint on the JSON shape: the contract layer
-- (ClearedAllergyEntrySchema) is the validator. Postgres CHECK on jsonb
-- structure is fragile and would need a migration to relax.

ALTER TABLE brief_state
  ADD COLUMN cleared_allergies jsonb NOT NULL DEFAULT '[]'::jsonb;
