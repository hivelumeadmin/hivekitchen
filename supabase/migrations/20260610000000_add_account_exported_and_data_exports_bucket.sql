-- Story 7-S10: data portability audit event type.
-- Mirror in TypeScript: apps/api/src/audit/audit.types.ts (account cluster).
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'account.exported';

-- Private storage bucket for data exports.
-- Writes are service-role only; parents access via 30-day signed URLs.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'data-exports',
  'data-exports',
  false,
  52428800,
  ARRAY['application/json']
)
ON CONFLICT (id) DO NOTHING;
