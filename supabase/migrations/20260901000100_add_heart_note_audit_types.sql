-- Slice 4-S1: audit event types for heart-note create + update operations.
-- Mirror in TypeScript: apps/api/src/audit/audit.types.ts (AUDIT_EVENT_TYPES).
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'heart_note.created';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'heart_note.updated';
