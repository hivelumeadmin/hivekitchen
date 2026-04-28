-- Story 2.9: add audit event type for parental notice acknowledgment.
-- Mirror in TypeScript: apps/api/src/audit/audit.types.ts (AUDIT_EVENT_TYPES).

ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'parental_notice.acknowledged';
