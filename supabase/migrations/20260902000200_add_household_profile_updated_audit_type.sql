-- Slice 2-s27 — household.profile_updated audit type for the new
-- PATCH /v1/households/:id route. Mirror in TypeScript:
-- apps/api/src/audit/audit.types.ts (AUDIT_EVENT_TYPES).
--
-- This migration also catches up three onboarding audit values that were
-- added to the TS enum in slice 2-s26 but were never paired with a Postgres
-- migration — the audit.types.test.ts parity test has been failing for them
-- since 2-s26 shipped. Adding them here closes the gap.

ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'household.profile_updated';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'onboarding.reset';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'onboarding.resume_offered';
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'onboarding.resumed';
