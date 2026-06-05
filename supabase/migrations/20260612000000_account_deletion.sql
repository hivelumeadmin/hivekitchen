-- Story 7-S11: Account deletion — 30-day regulatory cascade (FR69, NFR-PRIV-2).
-- Mirror audit event types in: apps/api/src/audit/audit.types.ts (account cluster).

ALTER TABLE households ADD COLUMN IF NOT EXISTS deletion_requested_at TIMESTAMPTZ NULL;

CREATE INDEX IF NOT EXISTS idx_households_deletion_requested_at
  ON households (deletion_requested_at)
  WHERE deletion_requested_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS processor_deletion_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  household_id UUID NOT NULL,
  processor TEXT NOT NULL,
  CONSTRAINT processor_deletion_log_processor_check
    CHECK (processor IN ('supabase_auth', 'elevenlabs', 'sendgrid', 'twilio', 'stripe', 'openai')),
  status TEXT NOT NULL DEFAULT 'pending',
  CONSTRAINT processor_deletion_log_status_check
    CHECK (status IN ('pending', 'completed', 'failed')),
  error_message TEXT,
  attempted_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_processor_deletion_log_household
  ON processor_deletion_log (household_id);
