-- Story 3-S34: audit event for the user-triggered on-demand ("compose now")
-- plan generation request (POST /v1/plans/generate).
-- Mirror in TypeScript: apps/api/src/audit/audit.types.ts (AUDIT_EVENT_TYPES).
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'plan.on_demand_requested';
