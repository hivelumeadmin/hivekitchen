-- Epic 13-s10 — audit event for the real "Confirm the week" commit
-- (PlansService.confirmWeek). Emitted once, on the first confirm (state
-- change); re-confirm is a no-op and writes nothing.
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'plan.week_confirmed';
