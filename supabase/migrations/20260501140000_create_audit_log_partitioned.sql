-- Rollback (this migration): DROP TABLE audit_log CASCADE; DROP FUNCTION create_next_audit_partition();
-- Rollback (migration 20260501110000): DROP TYPE audit_event_type;

-- Parent table — partitioned by calendar month on created_at.
-- household_id/user_id/correlation_id/stages are nullable because not all event_types
-- have a household (e.g., auth.login before household creation) or a multi-stage payload.
CREATE TABLE audit_log (
  id             uuid        NOT NULL DEFAULT gen_random_uuid(),
  household_id   uuid,
  user_id        uuid,
  event_type     audit_event_type NOT NULL,
  correlation_id uuid,
  request_id     uuid        NOT NULL,
  stages         jsonb,
  metadata       jsonb       NOT NULL DEFAULT '{}',
  created_at     timestamptz NOT NULL DEFAULT now()
) PARTITION BY RANGE (created_at);

-- Postgres 11+ requires the partition key to be part of any PRIMARY KEY on a
-- partitioned table. Composite PK (id, created_at) satisfies this.
ALTER TABLE audit_log ADD PRIMARY KEY (id, created_at);

-- Composite index: supports FR78/FR80 single-row lookup by correlation_id and
-- household-scoped event_type queries for the ops dashboard.
CREATE INDEX audit_log_household_event_correlation_created_idx
  ON audit_log (household_id, event_type, correlation_id, created_at);

-- Partial index: serves plan-generation guardrail rejection queries within a single
-- partition (e.g., "all plan.generated rows where guardrail rejected in <month>").
-- Scoped to plan.generated only — allergy.guardrail_rejection uses its own event_type.
CREATE INDEX audit_log_plan_guardrail_rejections_idx
  ON audit_log (created_at)
  WHERE event_type = 'plan.generated'
    AND stages @> '[{"verdict":"rejected"}]';

-- Initial 6 monthly partitions (May–October 2026)
CREATE TABLE audit_log_2026_05 PARTITION OF audit_log
  FOR VALUES FROM ('2026-05-01'::timestamptz) TO ('2026-06-01'::timestamptz);

CREATE TABLE audit_log_2026_06 PARTITION OF audit_log
  FOR VALUES FROM ('2026-06-01'::timestamptz) TO ('2026-07-01'::timestamptz);

CREATE TABLE audit_log_2026_07 PARTITION OF audit_log
  FOR VALUES FROM ('2026-07-01'::timestamptz) TO ('2026-08-01'::timestamptz);

CREATE TABLE audit_log_2026_08 PARTITION OF audit_log
  FOR VALUES FROM ('2026-08-01'::timestamptz) TO ('2026-09-01'::timestamptz);

CREATE TABLE audit_log_2026_09 PARTITION OF audit_log
  FOR VALUES FROM ('2026-09-01'::timestamptz) TO ('2026-10-01'::timestamptz);

CREATE TABLE audit_log_2026_10 PARTITION OF audit_log
  FOR VALUES FROM ('2026-10-01'::timestamptz) TO ('2026-11-01'::timestamptz);

-- Stored function called by the BullMQ partition rotation job via
-- fastify.supabase.rpc('create_next_audit_partition') on the 1st of each month.
-- Creates the partition for the NEXT calendar month relative to now().
-- SECURITY DEFINER so the PostgREST service role can run DDL.
-- SET search_path prevents search_path hijacking inside the function body.
CREATE OR REPLACE FUNCTION create_next_audit_partition()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $$
DECLARE
  partition_from date;
  partition_to   date;
  partition_name text;
BEGIN
  partition_from := DATE_TRUNC('month', now() + INTERVAL '1 month')::date;
  partition_to   := DATE_TRUNC('month', now() + INTERVAL '2 months')::date;
  partition_name := 'audit_log_' || TO_CHAR(partition_from, 'YYYY_MM');

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS %I PARTITION OF audit_log FOR VALUES FROM ((%L::date)::timestamptz AT TIME ZONE ''UTC'') TO ((%L::date)::timestamptz AT TIME ZONE ''UTC'')',
    partition_name,
    partition_from::text,
    partition_to::text
  );

  RETURN partition_name;
END;
$$;

-- Lock execution to service_role only — prevents anon/authenticated roles from
-- triggering DDL via PostgREST RPC.
REVOKE EXECUTE ON FUNCTION create_next_audit_partition() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION create_next_audit_partition() TO service_role;
