-- Story 3.27 — records Lumi-proposed preparation variants for active learning.
-- A variant proposal is a suggestion to try a different preparation method
-- for an item the child has rated before, to capture preference delta.
-- Variants are preparation-method changes (baked vs. pan-fried, raw vs.
-- roasted) — NOT ingredient substitutions (that is Story 3.24's territory).
--
-- Confirmation flow:
--   proposed_at      — set on insert when planner emits a variant_proposal
--   confirmed_at     — set when parent taps [Try the variant]
--   rejected_at      — set when parent taps [Keep the original]
--   (active = confirmed_at IS NULL AND rejected_at IS NULL)
--
-- One active proposal per plan invariant is enforced at the service layer
-- (VariantProposalService.createFromPlanOutput checks findActiveByPlan
-- before insert). The partial unique indexes below make active-set lookups
-- cheap without forcing a stronger DB constraint that would block backfills.
--
-- Rating delta tracking is deferred to Epic 4 — base_rating / variant_rating
-- columns exist so Story 4.14 can populate them without a schema change.
--
-- Rollback:
--   DROP INDEX IF EXISTS idx_variant_proposals_household_active;
--   DROP INDEX IF EXISTS idx_variant_proposals_plan;
--   DROP TABLE IF EXISTS variant_proposals;
--   ALTER TABLE children DROP COLUMN IF EXISTS variant_eligible;

CREATE TABLE IF NOT EXISTS variant_proposals (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id        UUID NOT NULL,
  child_id            UUID NOT NULL REFERENCES children(id) ON DELETE CASCADE,
  plan_item_id        UUID NOT NULL REFERENCES plan_items(id) ON DELETE CASCADE,
  plan_id             UUID NOT NULL,
  -- Base item (what was originally planned).
  base_recipe_name    TEXT NOT NULL,
  base_method         TEXT NOT NULL,
  -- Proposed variant.
  variant_description TEXT NOT NULL,
  variant_method      TEXT NOT NULL,
  -- Confirmation flow.
  proposed_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at        TIMESTAMPTZ,
  rejected_at         TIMESTAMPTZ,
  -- Rating delta (populated post-Epic 4 rating integration).
  base_rating         SMALLINT,
  variant_rating      SMALLINT,
  rating_delta_at     TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_variant_proposals_plan
  ON variant_proposals(plan_id)
  WHERE confirmed_at IS NULL AND rejected_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_variant_proposals_household_active
  ON variant_proposals(household_id)
  WHERE confirmed_at IS NULL AND rejected_at IS NULL;

-- Temporary stub — populated by Epic 4 rating integration. When true, the
-- planner may propose ONE preparation-method variant for this child's plan
-- items. Story 4.14 swaps this for a derived eligibility computed from
-- lunch_link_sessions.rating counts (≥3 ratings of an item).
ALTER TABLE children
  ADD COLUMN IF NOT EXISTS variant_eligible BOOLEAN NOT NULL DEFAULT false;
