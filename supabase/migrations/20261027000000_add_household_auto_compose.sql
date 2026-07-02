-- Story 3-S35: per-household auto-compose enrollment for the weekly Friday cron.
-- DEFAULT true + the has-plan gate in plan-generation.job.ts means a zero-plan
-- household is skipped regardless; once a household has composed once, the cron
-- maintains the cadence unless the parent toggles this off.
ALTER TABLE households
  ADD COLUMN IF NOT EXISTS auto_compose_enabled BOOLEAN NOT NULL DEFAULT true;

-- audit_log.event_type is the Postgres ENUM audit_event_type (created in
-- 20260501110000). New toggle event type must be added to the enum AND to
-- AUDIT_EVENT_TYPES in apps/api/src/audit/audit.types.ts.
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'household.auto_compose_changed';
