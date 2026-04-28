-- Story 2.4b: add audit event type for password reset completion.
-- Mirror in TypeScript: apps/api/src/audit/audit.types.ts (AUDIT_EVENT_TYPES).

ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'auth.password_reset_completed';
