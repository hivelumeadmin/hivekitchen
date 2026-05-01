-- Story 2.14: audit event types for the onboarding mental-model surface and
-- the tile-retry anxiety-leakage telemetry primitive.
-- Mirror in TypeScript: apps/api/src/audit/audit.types.ts (AUDIT_EVENT_TYPES).
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'onboarding.mental_model_shown';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'tile.edit_retried';
