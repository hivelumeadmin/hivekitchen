-- Story 7-S5: tombstone audit event for the nightly hard-deletion job.
-- Mirror in TypeScript: apps/api/src/audit/audit.types.ts (AUDIT_EVENT_TYPES).
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'memory.hard_forgotten';
