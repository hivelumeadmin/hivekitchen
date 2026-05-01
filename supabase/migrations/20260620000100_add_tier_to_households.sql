-- Story 12.5 — Premium tier gate for ambient voice (tap-to-talk).
-- The architecture spec assumed a `households.tier` field already existed; it
-- did not. This migration adds the minimal Epic 8 primitive needed by the tier
-- gate at `POST /v1/lumi/voice/sessions`.
--
-- Default 'standard' is the safe fallback: existing rows are not granted Premium
-- features by accident. Epic 8 (Stripe billing — stories 8.1, 8.10) will flip
-- rows to 'premium' on successful subscription and back on cancellation.
--
-- This is intentionally distinct from `households.tier_variant` (which already
-- exists with default 'beta'). `tier_variant` is a cohort-assignment label used
-- by Epic 10 for A/B variant tracking; `tier` is the billing-plan label that
-- gates premium-only features. Two columns, two concerns.
--
-- Rollback:
--   ALTER TABLE households DROP COLUMN tier;

ALTER TABLE households
  ADD COLUMN tier text NOT NULL DEFAULT 'standard'
  CHECK (tier IN ('standard', 'premium'));
