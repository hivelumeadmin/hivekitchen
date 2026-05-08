-- Story 3.17: audit event for the centralized plan-adjustment dispatcher.
-- Distinguishes the cause via metadata.trigger_type (school_policy_changed,
-- pantry_leftover_changed, cultural_calendar_event).
-- Mirror in TypeScript: apps/api/src/audit/audit.types.ts (AUDIT_EVENT_TYPES).
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'plan.adjustment_triggered';
