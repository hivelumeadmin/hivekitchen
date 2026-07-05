-- snack_skus.allergen_tags is the authoritative allergen declaration: an empty
-- array means "reviewed, no FALCPA allergens" and routes the SKU to the
-- parent-attested guardrail exemption (plans.service.ts buildCommitGuardrailInputs).
-- The schema could not distinguish that from "never reviewed" — a future SKU
-- added without tags would silently get attested treatment. tags_reviewed_at
-- records when the allergen declaration was last verified; NULL = unreviewed.
-- Not yet consulted by the guardrail (parent-attested doctrine unchanged for
-- parent-curated shelves); it becomes load-bearing if shared catalogs land.
ALTER TABLE snack_skus ADD COLUMN IF NOT EXISTS tags_reviewed_at timestamptz;

-- Backfill: the 11 existing rows were manually audited 2026-07-05 (all
-- allergenic SKUs carry their FALCPA-9 tags; empty-tag rows are naturally
-- allergen-free whole foods).
UPDATE snack_skus SET tags_reviewed_at = now() WHERE tags_reviewed_at IS NULL;
