-- Catch-up migration: audit_event_type enum values that the API already emits
-- (present in apps/api/src/audit/audit.types.ts) but were never added to the
-- Postgres enum. Without these, audit_log inserts for these events fail.
-- Surfaced by the drift-guard test in apps/api/src/audit/audit.types.test.ts.
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'account.deletion_requested';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'account.hard_deleted';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'household.sovereignty_mode_changed';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'llm.provider.recovered';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'lunch_link.suppressed';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'lunch_link.unsuppressed';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'plan.child_paused_on_day';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'plan.cultural_degraded';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'plan.main_swapped';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'plan.slot_recipe_swapped';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'plan.variant_proposal_confirmed';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'plan.variant_proposal_created';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'plan.variant_proposal_rejected';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'plan.variation_updated';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'planner.bad_output';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'voice.stt_token_issued';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'voice.tts_token_issued';
