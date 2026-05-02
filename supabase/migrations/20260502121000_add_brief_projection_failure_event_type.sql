-- Story 3.6: extends the audit_event_type enum used by the audit_log table.
-- Architecture §4.2: enum extension requires this migration AND the TypeScript
-- AUDIT_EVENT_TYPES update in audit.types.ts; both must ship together.
-- Must run AFTER 20260502120000_create_brief_state_projection.sql.
--
-- ALTER TYPE ... ADD VALUE IF NOT EXISTS is idempotent — safe to re-run.
-- Postgres 12+ supports this inside a transaction (Supabase uses PG14+).
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'brief.projection.failure';
