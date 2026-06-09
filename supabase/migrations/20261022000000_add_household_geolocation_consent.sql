-- 5-S14: Geolocation opt-in columns for household-level consent tracking (FR74, NFR-PRIV-3)
ALTER TABLE households
  ADD COLUMN IF NOT EXISTS geolocation_enabled BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS geolocation_consented_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS geolocation_purpose TEXT CHECK (geolocation_purpose IN ('cultural_supplier_routing'));

-- audit_log.event_type is the Postgres ENUM audit_event_type (created in
-- 20260501110000). New consent event type for NFR-PRIV-3 must be added to the
-- enum AND to AUDIT_EVENT_TYPES in apps/api/src/audit/audit.types.ts.
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'household.geolocation_consent';
