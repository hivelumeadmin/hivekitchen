-- Story 3.7: extends the audit_event_type enum so the per-household
-- plan-generation BullMQ worker can write 'plan.generation.failed' rows when
-- all retries are exhausted. The ops anomaly dashboard (FR95/FR96) reads
-- these rows to surface permanent failures.
--
-- Architecture §4.2: enum extension requires this migration AND the
-- TypeScript AUDIT_EVENT_TYPES update in audit.types.ts; both ship together.
-- ALTER TYPE ... ADD VALUE IF NOT EXISTS is idempotent — safe to re-run.
ALTER TYPE audit_event_type ADD VALUE IF NOT EXISTS 'plan.generation.failed';
