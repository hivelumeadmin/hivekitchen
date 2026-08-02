-- Story 15-s1: audit event for family-calendar term/exception writes.
-- Mirror in TypeScript: apps/api/src/audit/audit.types.ts (AUDIT_EVENT_TYPES).
--
-- Rollback: Postgres cannot remove a value from an enum type. Reverting this
-- migration means recreating audit_event_type without the value, which is not
-- worth it for an additive change — leave it in place.
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'household.calendar_updated';
