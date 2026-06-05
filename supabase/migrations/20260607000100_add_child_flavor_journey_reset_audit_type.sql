-- Story 7-S7: audit event for the annual flavor-journey reset action.
-- TypeScript mirror: apps/api/src/audit/audit.types.ts (AUDIT_EVENT_TYPES).
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'child.flavor_journey_reset';
