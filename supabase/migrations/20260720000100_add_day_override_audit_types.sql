-- Story 3.19: day-level context override audit events.
-- Mirror in TypeScript: apps/api/src/audit/audit.types.ts (AUDIT_EVENT_TYPES).
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'plan.day_override_set';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'plan.day_override_reverted';
