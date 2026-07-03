-- Epic 13-s10 — real "Confirm the week". A composed plan is live-by-default;
-- confirmed_at records the parent's explicit confirmation (the StickyBar
-- "Confirm the week" action). NULL = composed-but-unconfirmed. Idempotent set:
-- re-confirming a plan is a no-op (PlansService.confirmWeek guards on NULL).
ALTER TABLE plans ADD COLUMN IF NOT EXISTS confirmed_at timestamptz;
