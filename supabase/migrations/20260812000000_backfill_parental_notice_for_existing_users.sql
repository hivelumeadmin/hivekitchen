-- Slice 2-S19 backfill: derive `is_onboarded` from existing data
-- ===============================================================
-- The 2-S19 fix routes users to `/onboarding` whenever they're not "fully
-- onboarded" — defined as (parental_notice_acknowledged_at IS NOT NULL) AND
-- (at least one child row in the household).
--
-- This protects new users from the resumed-after-abandon dead-end, but
-- regresses existing users who:
--   - were created between migrations 20260501120000 (users.parental_notice_
--     acknowledged_at added) and 20260509000200 (Story 2.9 ack RPC landed)
--   - have at least one child row in their household
--   - never had their parental_notice_acknowledged_at populated because the
--     UX flow that writes it didn't exist yet
--
-- Without this backfill those users would route to /onboarding after the
-- 2-S19 deploy — violating AC4's "no regression" promise.
--
-- This migration sets `parental_notice_acknowledged_at = NOW()` for any user
-- whose household has children but who has NULL ack. It is idempotent (the
-- WHERE clause excludes already-acked users) and safe to re-run.
--
-- We deliberately do NOT touch `parental_notice_acknowledged_version`. That
-- column records which document version the user acknowledged. Backfilled
-- rows did not acknowledge any specific document — leaving version NULL on
-- ack_at != NULL is the backfill signature, distinguishable from a real ack.
-- When a v2 parental notice ships, the re-ack migration can target this
-- exact combination (ack_at NOT NULL, version IS NULL) to require explicit
-- re-acknowledgment from backfilled users.

UPDATE users u
SET parental_notice_acknowledged_at = NOW()
WHERE
  u.parental_notice_acknowledged_at IS NULL
  AND u.current_household_id IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM children c
    WHERE c.household_id = u.current_household_id
  );
