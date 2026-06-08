-- Slice 5-S8: "I noticed" learning-moment respond audit events.
-- Mirror in TypeScript: apps/api/src/audit/audit.types.ts (AUDIT_EVENT_TYPES).
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'memory.learning_moment_confirmed';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'memory.learning_moment_dismissed';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'memory.learning_moment_tell_more';
