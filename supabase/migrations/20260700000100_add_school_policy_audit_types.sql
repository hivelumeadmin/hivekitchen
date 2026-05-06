-- Story 3.16: audit events for school-policy changes and the regeneration
-- propagation they trigger.
-- Mirror in TypeScript: apps/api/src/audit/audit.types.ts (AUDIT_EVENT_TYPES).
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'school_policy.updated';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'plan.policy_regeneration_triggered';
