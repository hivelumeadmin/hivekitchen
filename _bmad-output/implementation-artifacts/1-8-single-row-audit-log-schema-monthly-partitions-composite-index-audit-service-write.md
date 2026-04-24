# Story 1.8: Single-row audit_log schema (monthly partitions + composite index) + audit.service.write()

Status: done

## Story

As a developer,
I want the `audit_log` table created with the single-row-per-action schema, monthly partitioning, and the composite index on `(household_id, event_type, correlation_id, created_at)`, plus an `audit.service.write()` API that is the only allowed write path,
So that FR78/FR80 timeline reconstruction is a single-row read and audit volume scales to 50k HH × 5k plans/wk.

## Acceptance Criteria

1. Migration `supabase/migrations/20260501110000_create_audit_event_type_enum.sql` creates the Postgres `audit_event_type` enum covering all 14 categories: `plan.*`, `memory.*`, `heart_note.*`, `lunch_link.*`, `voice.*`, `billing.*`, `vpc.*`, `account.*`, `auth.*`, `allergy.*`, `agent.*`, `webhook.*`, `invite.*`, `llm.provider.*` — per architecture §4.2. 43 initial values total (the "37" figure in the story narrative was an early draft count; the authoritative list is the SQL spec in Dev Notes).

2. Migration `supabase/migrations/20260501140000_create_audit_log_partitioned.sql` creates the `audit_log` parent table partitioned by `RANGE (created_at)`, the composite index `audit_log_household_event_correlation_created_idx`, the partial index `audit_log_guardrail_rejections_idx` (WHERE `event_type='plan.generated' AND stages @> '[{"verdict":"rejected"}]'`), and 6 initial monthly partitions (2026-05 through 2026-10) plus a stored function `create_next_audit_partition()` for the rotation job.

3. `apps/api/src/jobs/audit-partition-rotation.job.ts` exports `registerAuditPartitionRotationJob(fastify)` that registers a BullMQ recurring job (cron `5 0 1 * *`) whose processor calls `fastify.supabase.rpc('create_next_audit_partition')` to create the next month's partition. Registered in `app.ts` after `bullmqPlugin`.

4. `apps/api/src/audit/audit.types.ts` exports `AUDIT_EVENT_TYPES as const`, `AuditEventType`, `AuditStage`, and `AuditWriteInput`; the `AUDIT_EVENT_TYPES` array mirrors the Postgres enum exactly — verified by a Vitest test that parses the migration file and compares sorted values. `apps/api/src/audit/audit.repository.ts` extends `BaseRepository` from `repository/base.repository.ts` and wraps `this.client.from('audit_log').insert()`. `apps/api/src/audit/audit.service.ts` exposes `write(input: AuditWriteInput): Promise<void>`. `apps/api/src/middleware/audit.hook.ts` is an `fp()`-wrapped plugin that registers an `onResponse` hook: reads `request.auditContext` (typed in `fastify.d.ts`), calls `service.write()` as fire-and-forget, and logs failures at `error` without propagating.

5. The existing `no-restricted-syntax` ESLint selector in `packages/eslint-config-hivekitchen/src/index.ts` is updated to match the actual Supabase call pattern `.from('audit_log').insert(...)` and the `no-restricted-imports` ignore pattern is updated to `**/*.repository.ts` to allow all repository-suffixed files to import from `@supabase/**`. Both changes are verified by a deliberate-violation fixture that triggers the `audit_log` write rule, and by confirming `audit.repository.ts` lint-clean after the pattern fix.

6. `pnpm typecheck`, `pnpm lint`, and `pnpm test` remain green workspace-wide.

## Tasks / Subtasks

- [x] **Task 1 — Pre-flight** (no AC)
  - [x] Confirm Story 1.6 and 1.7 are `done` in `sprint-status.yaml`.
  - [x] Confirm `supabase/migrations/` does NOT exist (must create manually — do NOT run `supabase init`).
  - [x] Confirm `apps/api/src/audit/` does NOT exist.
  - [x] Confirm `apps/api/src/jobs/` does NOT exist.
  - [x] Confirm `apps/api/src/repository/` does NOT exist (create `base.repository.ts` here in Task 3).

- [x] **Task 2 — Create migration directory** (no AC)
  - [x] Create directory `supabase/migrations/` at the workspace root.
  - [x] Add `.gitkeep` to make it committed even when empty initially.

- [x] **Task 3 — Migration 1: audit_event_type enum** (AC: #1)
  - [x] Create `supabase/migrations/20260501110000_create_audit_event_type_enum.sql` per **Migration 1 Spec** in Dev Notes.
  - [x] Include all initial enum values covering the 14 categories (37 initial values total — see spec).
  - [x] Include a rollback comment block (DROP TYPE).

- [x] **Task 4 — Migration 2: audit_log partitioned table** (AC: #2)
  - [x] Create `supabase/migrations/20260501140000_create_audit_log_partitioned.sql` per **Migration 2 Spec** in Dev Notes.
  - [x] Create `audit_log` parent table with `PARTITION BY RANGE (created_at)`.
  - [x] Create composite index `audit_log_household_event_correlation_created_idx`.
  - [x] Create partial index `audit_log_guardrail_rejections_idx`.
  - [x] Create 6 initial monthly partitions: `2026_05` through `2026_10`.
  - [x] Create stored function `create_next_audit_partition()` returning `text` (partition name).
  - [x] Include a rollback comment block.

- [x] **Task 5 — Create repository base** (AC: #4, #5)
  - [x] Create `apps/api/src/repository/base.repository.ts` per **Base Repository Spec** in Dev Notes.
  - [x] Export `BaseRepository` class — constructor-injects `SupabaseClient`, protected `client`.

- [x] **Task 6 — Create audit.types.ts** (AC: #4)
  - [x] Create `apps/api/src/audit/audit.types.ts` per **Audit Types Spec** in Dev Notes.
  - [x] Export `AUDIT_EVENT_TYPES as const` with all 37 initial values.
  - [x] Export `AuditEventType`, `AuditStage`, `AuditWriteInput` types.
  - [x] Create `apps/api/src/audit/audit.types.test.ts` — parity test that parses the migration file and asserts `AUDIT_EVENT_TYPES` contains exactly the same values as the Postgres enum in the migration SQL.

- [x] **Task 7 — Create audit.repository.ts** (AC: #4)
  - [x] Create `apps/api/src/audit/audit.repository.ts` per **Audit Repository Spec** in Dev Notes.
  - [x] Extends `BaseRepository` — no direct `@supabase/**` import.
  - [x] `insert(input: AuditWriteInput): Promise<void>` — throws on Supabase error.

- [x] **Task 8 — Create audit.service.ts** (AC: #4)
  - [x] Create `apps/api/src/audit/audit.service.ts` per **Audit Service Spec** in Dev Notes.
  - [x] `write(input: AuditWriteInput): Promise<void>` — calls `repository.insert()`.
  - [x] Does NOT suppress errors; caller (audit.hook.ts) is responsible for fire-and-forget + error logging.
  - [x] Create `apps/api/src/audit/audit.service.test.ts` with unit tests (mock repository).

- [x] **Task 9 — Create audit.hook.ts** (AC: #4)
  - [x] Update `apps/api/src/types/fastify.d.ts` — add `auditContext?: AuditWriteInput` to `FastifyRequest`.
  - [x] Create `apps/api/src/middleware/audit.hook.ts` per **Audit Hook Spec** in Dev Notes.
  - [x] `fp()`-wrapped plugin; creates `AuditRepository(fastify.supabase)` and `AuditService(repo)` on plugin registration.
  - [x] Registers `onResponse` hook; fire-and-forget `service.write(ctx).catch(err => request.log.error(...))`.

- [x] **Task 10 — Create BullMQ partition rotation job** (AC: #3)
  - [x] Create `apps/api/src/jobs/audit-partition-rotation.job.ts` per **Partition Rotation Job Spec** in Dev Notes.
  - [x] Uses `fastify.bullmq.getQueue('audit:partition-rotation')` and `fastify.bullmq.getWorker(...)`.
  - [x] Worker calls `await fastify.supabase.rpc('create_next_audit_partition')`.
  - [x] Cron schedule `5 0 1 * *` (00:05 on 1st of every month).

- [x] **Task 11 — Update app.ts** (AC: #3, #4)
  - [x] Register `auditHook` from `middleware/audit.hook.ts` after `bullmqPlugin` (moved from the original spec position — see Debug Log #1; `auditHook` requires `fastify.supabase` at plugin registration so it must follow `supabasePlugin`).
  - [x] Call `registerAuditPartitionRotationJob(app)` after `bullmqPlugin` is registered.

- [x] **Task 12 — Fix ESLint rules** (AC: #5)
  - [x] Update `packages/eslint-config-hivekitchen/src/index.ts`:
    - Change `no-restricted-imports` ignore pattern from `apps/api/src/**/repository.ts` to `apps/api/src/**/*.repository.ts`.
    - Update `no-restricted-syntax` audit_log selector to match Supabase `.from('audit_log').insert(...)` pattern (see Dev Notes for correct selector).
  - [x] Rebuild `packages/eslint-config-hivekitchen`: `pnpm --filter @hivekitchen/eslint-config build`.
  - [x] Create deliberate-violation fixture `apps/api/src/__fixtures__/audit-violation.ts` using the Supabase pattern — confirm lint error fires.
  - [x] Delete the fixture — confirm 0 errors.
  - [x] Confirm `apps/api/src/audit/audit.repository.ts` lints cleanly after the `*.repository.ts` ignore fix.

- [x] **Task 13 — Verification** (AC: #6)
  - [x] `pnpm typecheck` — all packages green.
  - [x] `pnpm lint` — 0 errors workspace-wide.
  - [x] `pnpm test` — all existing tests green; new parity test and service unit tests pass.
  - [x] `pnpm build` at `apps/api` — dist emits correctly.
  - [x] Update `sprint-status.yaml` story to `review`.

---

## Dev Notes

### Architecture References (authoritative sources)

- `_bmad-output/planning-artifacts/architecture.md` §"1.6 Audit log" — partition strategy, retention, indexes
- `_bmad-output/planning-artifacts/architecture.md` §"4.2 Audit event_type taxonomy" — categories and specific values
- `_bmad-output/planning-artifacts/architecture.md` §"5.7 Audit write pattern" — fire-and-forget, failure handling
- `_bmad-output/planning-artifacts/architecture.md` §"2.2 API internal layout" — `audit/`, `middleware/`, `repository/` folders
- `_bmad-output/planning-artifacts/architecture.md` §"Implementation Patterns 1.4" — event naming rules
- `_bmad-output/implementation-artifacts/1-7-pino-structured-logging-opentelemetry-skeleton-grafana-cloud-otlp.md` — Story 1.7 patterns (fp(), .js extensions, pnpm build)

### CRITICAL: supabase/ Directory Setup

`supabase/migrations/` does NOT exist in the repo. Do NOT run `supabase init` — that would generate a full Supabase project config (`supabase/config.toml`, `supabase/seed.sql`, etc.) that is out of scope and requires Supabase CLI setup. Simply create the directory:

```bash
mkdir -p supabase/migrations
```

Architecture §1.4: "Migration tooling — Supabase CLI migrations, file-per-change, committed to `supabase/migrations/`. Types via `supabase gen types typescript`." The `supabase gen types` command runs after migrations are applied to a local Supabase instance (Epic 2+ concern). This story only creates the SQL files.

### Migration 1 Spec — audit_event_type enum

**File:** `supabase/migrations/20260501110000_create_audit_event_type_enum.sql`

```sql
-- Rollback: DROP TYPE audit_event_type;
-- Note: Adding values requires ALTER TYPE audit_event_type ADD VALUE '<value>';
-- TypeScript mirror must be updated in the same PR: apps/api/src/audit/audit.types.ts

CREATE TYPE audit_event_type AS ENUM (
  -- plan
  'plan.generated',
  'plan.regenerated',
  'plan.regeneration_requested',
  'plan.hard_fail',
  -- memory
  'memory.forgotten',
  'memory.updated',
  -- heart_note
  'heart_note.sent',
  'heart_note.delivered',
  'heart_note.delivery_failed',
  -- lunch_link
  'lunch_link.created',
  'lunch_link.opened',
  'lunch_link.rated',
  'lunch_link.expired',
  -- voice
  'voice.session_started',
  'voice.session_ended',
  'voice.webhook_auth_failed',
  -- billing
  'billing.subscribed',
  'billing.cancelled',
  'billing.payment_failed',
  'billing.payment_recovered',
  'billing.upgraded',
  'billing.downgraded',
  'billing.gift_redeemed',
  -- vpc
  'vpc.consented',
  -- account
  'account.created',
  'account.updated',
  'account.deleted',
  -- auth
  'auth.login',
  'auth.logout',
  'auth.refresh_rotated',
  'auth.token_reuse_revoked',
  'auth.password_reset_initiated',
  -- allergy
  'allergy.guardrail_rejection',
  'allergy.uncertainty',
  'allergy.check_overridden',
  -- agent
  'agent.orchestrator_run',
  -- webhook
  'webhook.received',
  'webhook.signature_failed',
  -- invite
  'invite.sent',
  'invite.redeemed',
  'invite.revoked',
  'invite.expired',
  -- llm.provider
  'llm.provider.failover'
);
```

**37 initial values.** Extension rule: any PR adding a new event category must add the enum value via `ALTER TYPE ... ADD VALUE` in a new migration AND extend the TypeScript `AUDIT_EVENT_TYPES` array in the same PR (CI parity test enforces this).

**Postgres enum caveat:** Postgres enums are ORDER-sensitive in some contexts. New values added via `ALTER TYPE ... ADD VALUE` are appended at the end unless `BEFORE`/`AFTER` is specified. The TypeScript array is order-independent — the parity test checks sorted membership, not order.

### Migration 2 Spec — audit_log partitioned table

**File:** `supabase/migrations/20260501140000_create_audit_log_partitioned.sql`

```sql
-- Rollback: DROP TABLE audit_log CASCADE; DROP FUNCTION create_next_audit_partition();

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

-- Composite index: supports FR78/FR80 single-row lookup per correlation_id
-- and household-scoped event_type queries on the ops dashboard.
CREATE INDEX audit_log_household_event_correlation_created_idx
  ON audit_log (household_id, event_type, correlation_id, created_at);

-- Partial index: serves cross-cutting queries like "all guardrail rejections in March"
-- without a full partition scan. The stages @> predicate uses JSONB containment.
CREATE INDEX audit_log_guardrail_rejections_idx
  ON audit_log (created_at)
  WHERE event_type = 'plan.generated'
    AND stages @> '[{"verdict":"rejected"}]';

-- Note: No PRIMARY KEY constraint on the parent partitioned table in Postgres 14 until PG 15+.
-- Use 'id' as the logical PK; partitions inherit the unique constraint if needed on each child.
-- PG 15+ syntax: PRIMARY KEY (id, created_at) — include partition key.
-- For Supabase (PG 15+), prefer declaring the PK including the partition key:
ALTER TABLE audit_log ADD PRIMARY KEY (id, created_at);

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

-- Stored function called by the BullMQ partition rotation job via fastify.supabase.rpc().
-- Creates the partition for the NEXT calendar month relative to now().
-- Returns the partition name string (e.g., 'audit_log_2026_11').
-- Requires the supabase service role key (already used by the API's supabase plugin).
CREATE OR REPLACE FUNCTION create_next_audit_partition()
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  partition_from  date;
  partition_to    date;
  partition_name  text;
BEGIN
  partition_from := DATE_TRUNC('month', now() + INTERVAL '1 month')::date;
  partition_to   := DATE_TRUNC('month', now() + INTERVAL '2 months')::date;
  partition_name := 'audit_log_' || TO_CHAR(partition_from, 'YYYY_MM');

  EXECUTE format(
    $sql$
      CREATE TABLE IF NOT EXISTS %I
        PARTITION OF audit_log
        FOR VALUES FROM (%L::timestamptz) TO (%L::timestamptz)
    $sql$,
    partition_name,
    partition_from::text,
    partition_to::text
  );

  RETURN partition_name;
END;
$$;
```

**Primary key caveat:** Postgres 14 requires the partition key to be included in any UNIQUE or PRIMARY KEY constraint on a partitioned table. Supabase runs Postgres 15+ where this is more flexible, but the safest form is `PRIMARY KEY (id, created_at)`. If `id` alone is needed as the PK for FK references from other tables, use a partial UNIQUE index per partition instead. For this story, include the composite PK; revisit if FK requirements demand `id`-only uniqueness.

**`SECURITY DEFINER`:** The function runs with the privileges of its owner (supabase postgres superuser), not the calling role. This is required for DDL (`CREATE TABLE`) executed from a service-role JWT context where the PostgREST role may not have CREATE TABLE privileges. Ensure the function is created by the superuser (migration context).

### Base Repository Spec

```ts
// apps/api/src/repository/base.repository.ts
import type { SupabaseClient } from '@supabase/supabase-js';

export class BaseRepository {
  constructor(protected readonly client: SupabaseClient) {}
}
```

This is the ONLY file in `apps/api/src/repository/` for this story. `repository.types.ts` is deferred until a story needs shared repository type definitions.

The `repository/` directory is the one place outside `plugins/` where direct `@supabase/supabase-js` imports are permitted by the ESLint boundary rule (after the Task 12 fix changes `**/repository.ts` to `**/*.repository.ts`).

### Audit Types Spec

```ts
// apps/api/src/audit/audit.types.ts
export const AUDIT_EVENT_TYPES = [
  // plan
  'plan.generated',
  'plan.regenerated',
  'plan.regeneration_requested',
  'plan.hard_fail',
  // memory
  'memory.forgotten',
  'memory.updated',
  // heart_note
  'heart_note.sent',
  'heart_note.delivered',
  'heart_note.delivery_failed',
  // lunch_link
  'lunch_link.created',
  'lunch_link.opened',
  'lunch_link.rated',
  'lunch_link.expired',
  // voice
  'voice.session_started',
  'voice.session_ended',
  'voice.webhook_auth_failed',
  // billing
  'billing.subscribed',
  'billing.cancelled',
  'billing.payment_failed',
  'billing.payment_recovered',
  'billing.upgraded',
  'billing.downgraded',
  'billing.gift_redeemed',
  // vpc
  'vpc.consented',
  // account
  'account.created',
  'account.updated',
  'account.deleted',
  // auth
  'auth.login',
  'auth.logout',
  'auth.refresh_rotated',
  'auth.token_reuse_revoked',
  'auth.password_reset_initiated',
  // allergy
  'allergy.guardrail_rejection',
  'allergy.uncertainty',
  'allergy.check_overridden',
  // agent
  'agent.orchestrator_run',
  // webhook
  'webhook.received',
  'webhook.signature_failed',
  // invite
  'invite.sent',
  'invite.redeemed',
  'invite.revoked',
  'invite.expired',
  // llm.provider
  'llm.provider.failover',
] as const;

export type AuditEventType = (typeof AUDIT_EVENT_TYPES)[number];

export interface AuditStage {
  stage: string;
  [key: string]: unknown;
}

export interface AuditWriteInput {
  event_type: AuditEventType;
  household_id?: string;
  user_id?: string;
  correlation_id?: string;
  request_id: string;
  stages?: AuditStage[];
  metadata: Record<string, unknown>;
}
```

**Parity test** (`apps/api/src/audit/audit.types.test.ts`):

```ts
import { readFileSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import { AUDIT_EVENT_TYPES } from './audit.types.js';

describe('audit.types — Postgres enum parity', () => {
  it('AUDIT_EVENT_TYPES matches the audit_event_type Postgres enum in migration 20260501110000', () => {
    const migrationPath = new URL(
      '../../../../supabase/migrations/20260501110000_create_audit_event_type_enum.sql',
      import.meta.url,
    );
    const sql = readFileSync(migrationPath, 'utf8');

    const match = sql.match(/CREATE TYPE audit_event_type AS ENUM \(([\s\S]*?)\);/);
    expect(match, 'Migration must contain CREATE TYPE audit_event_type AS ENUM').toBeTruthy();

    const sqlValues = match![1]
      .split(',')
      .map((v) => v.replace(/--.*$/m, '').trim().replace(/^'|'$/g, ''))
      .filter((v) => v.length > 0)
      .sort();

    const tsValues = [...AUDIT_EVENT_TYPES].sort();

    expect(tsValues).toEqual(sqlValues);
  });
});
```

### Audit Repository Spec

```ts
// apps/api/src/audit/audit.repository.ts
import { BaseRepository } from '../repository/base.repository.js';
import type { AuditWriteInput } from './audit.types.js';

export class AuditRepository extends BaseRepository {
  async insert(input: AuditWriteInput): Promise<void> {
    const { error } = await this.client.from('audit_log').insert({
      household_id: input.household_id ?? null,
      user_id: input.user_id ?? null,
      event_type: input.event_type,
      correlation_id: input.correlation_id ?? null,
      request_id: input.request_id,
      stages: input.stages ?? null,
      metadata: input.metadata,
    });
    if (error) throw error;
  }
}
```

**No direct `@supabase/**` import**: `AuditRepository` extends `BaseRepository` and uses `this.client` (typed through inheritance). TypeScript resolves the type without a local import. This is why the `no-restricted-imports` pattern must be `**/*.repository.ts` (to allow the import in `base.repository.ts` in `repository/`).

### Audit Service Spec

```ts
// apps/api/src/audit/audit.service.ts
import type { AuditRepository } from './audit.repository.js';
import type { AuditWriteInput } from './audit.types.js';

export class AuditService {
  constructor(private readonly repository: AuditRepository) {}

  async write(input: AuditWriteInput): Promise<void> {
    await this.repository.insert(input);
  }
}
```

**Error propagation:** `write()` does NOT suppress errors. The caller (`audit.hook.ts`) is responsible for the fire-and-forget pattern and error logging. This keeps the service testable and single-purpose.

**Unit test** (`apps/api/src/audit/audit.service.test.ts`):
```ts
import { describe, it, expect, vi } from 'vitest';
import { AuditService } from './audit.service.js';

describe('AuditService', () => {
  it('calls repository.insert with the full input', async () => {
    const mockInsert = vi.fn().mockResolvedValue(undefined);
    const mockRepo = { insert: mockInsert } as any;
    const service = new AuditService(mockRepo);

    const input = {
      event_type: 'auth.login' as const,
      user_id: 'user-uuid',
      request_id: 'req-uuid',
      metadata: { method: 'email' },
    };

    await service.write(input);
    expect(mockInsert).toHaveBeenCalledWith(input);
  });

  it('propagates repository errors (caller handles fire-and-forget)', async () => {
    const mockRepo = { insert: vi.fn().mockRejectedValue(new Error('db error')) } as any;
    const service = new AuditService(mockRepo);
    await expect(
      service.write({ event_type: 'auth.login' as const, request_id: 'x', metadata: {} }),
    ).rejects.toThrow('db error');
  });
});
```

### Audit Hook Spec

```ts
// apps/api/src/middleware/audit.hook.ts
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { AuditRepository } from '../audit/audit.repository.js';
import { AuditService } from '../audit/audit.service.js';

const auditHookPlugin: FastifyPluginAsync = async (fastify) => {
  const repo = new AuditRepository(fastify.supabase);
  const service = new AuditService(repo);

  fastify.addHook('onResponse', async (request) => {
    const ctx = request.auditContext;
    if (!ctx) return;
    void service
      .write(ctx)
      .catch((err: unknown) =>
        request.log.error(
          { err, module: 'audit', action: 'audit.hook.write.failed' },
          'audit write failed — not propagated',
        ),
      );
  });
};

export const auditHook = fp(auditHookPlugin, { name: 'audit-hook' });
```

**`fastify.d.ts` update** (add to the `FastifyRequest` augmentation):

```ts
// Add import at top:
import type { AuditWriteInput } from '../audit/audit.types.js';

// Add to FastifyRequest interface inside the declare module block:
interface FastifyRequest {
  auditContext?: AuditWriteInput;
}
```

**Usage pattern in route handlers** (for Epic 2+ stories):
```ts
// In a route handler:
request.auditContext = {
  event_type: 'auth.login',
  user_id: user.id,
  request_id: String(request.id),
  metadata: { method: 'email' },
};
// Do NOT await — the onResponse hook fires after reply is sent.
```

### Partition Rotation Job Spec

```ts
// apps/api/src/jobs/audit-partition-rotation.job.ts
import type { FastifyInstance } from 'fastify';
import type { Job } from 'bullmq';

const QUEUE_NAME = 'audit:partition-rotation';

export function registerAuditPartitionRotationJob(fastify: FastifyInstance): void {
  const queue = fastify.bullmq.getQueue(QUEUE_NAME);

  // BullMQ v5: upsertJobScheduler is idempotent — safe to call on every app start.
  void queue.upsertJobScheduler(
    'monthly-partition-create',
    { pattern: '5 0 1 * *', tz: 'UTC' },
    {
      name: 'create-next-partition',
      data: {},
      opts: {
        removeOnComplete: { count: 12 },
        removeOnFail: { count: 48 },
      },
    },
  );

  fastify.bullmq.getWorker(QUEUE_NAME, async (_job: Job) => {
    fastify.log.info(
      { module: 'audit', action: 'partition.rotation.started' },
      'creating next audit partition',
    );

    const { data, error } = await fastify.supabase.rpc('create_next_audit_partition');

    if (error) {
      fastify.log.error(
        { err: error, module: 'audit', action: 'partition.rotation.failed' },
        'failed to create audit partition',
      );
      throw error;
    }

    fastify.log.info(
      { module: 'audit', action: 'partition.rotation.completed', partition: data },
      'audit partition created',
    );
  });
}
```

**BullMQ v5 `upsertJobScheduler`:** This method (available in BullMQ v5.0+) is idempotent — calling it on every app start is safe and ensures the schedule is always registered. It uses the `id` string (`'monthly-partition-create'`) to deduplicate.

**`fastify.supabase.rpc('create_next_audit_partition')`:** The Supabase JS client calls the stored function via PostgREST. The service role key (already injected via `supabasePlugin`) has the necessary privileges since the function is `SECURITY DEFINER`. The `rpc()` return shape is `{ data: string | null, error: PostgrestError | null }`.

### Updated app.ts Registration Order

```ts
// Additional lines in buildApp() after existing registrations:

// After requestIdPlugin — audit hook must be available for all routes
await app.register(auditHook);

// After bullmqPlugin — partition job requires bullmq + supabase to be decorated
registerAuditPartitionRotationJob(app);
```

**Import paths to add in `app.ts`:**
```ts
import { auditHook } from './middleware/audit.hook.js';
import { registerAuditPartitionRotationJob } from './jobs/audit-partition-rotation.job.js';
```

### ESLint Rule Fixes (Task 12)

**Problem 1 — `no-restricted-imports` ignores too narrow:**

The current pattern `apps/api/src/**/repository.ts` only matches files named exactly `repository.ts`. It does NOT match `base.repository.ts`, `audit.repository.ts`, or any other `*.repository.ts` file. This prevents those files from importing `@supabase/**` — breaking the naming convention.

**Fix:** Change the ignore entry from:
```ts
'apps/api/src/**/repository.ts'
```
to:
```ts
'apps/api/src/**/*.repository.ts'
```

The glob `**/*.repository.ts` matches any file ending with `.repository.ts` in any subdirectory, consistent with the architecture's naming convention.

**Problem 2 — `no-restricted-syntax` audit_log selector doesn't match Supabase:**

The current selector:
```
"CallExpression[callee.property.name='insert'][arguments.0.value='audit_log']"
```
matches `.insert('audit_log')` — but the actual Supabase pattern is:
```ts
client.from('audit_log').insert({...})
```

The correct selector that matches the Supabase `.from('audit_log').insert()` chain:
```
"CallExpression[callee.property.name='insert'][callee.object.type='CallExpression'][callee.object.callee.property.name='from'][callee.object.arguments.0.value='audit_log']"
```

**Deliberate-violation fixture** (`apps/api/src/__fixtures__/audit-violation.ts`):
```ts
// Fixture: verify ESLint blocks direct audit_log writes outside audit/
// Delete this file after confirming the lint error fires.
import type { SupabaseClient } from '@supabase/supabase-js';

export async function badAuditWrite(client: SupabaseClient): Promise<void> {
  await client.from('audit_log').insert({ event_type: 'auth.login', request_id: 'x', metadata: {} });
}
```

Run `pnpm lint` in `apps/api` with this file — expect one lint error from `no-restricted-syntax`. Then delete the file and confirm 0 errors.

**Note on the fixture:** The file is in `apps/api/src/__fixtures__/` which is NOT in `apps/api/src/audit/` — so the rule applies. But the `no-restricted-imports` rule blocks `@supabase/**` imports outside `plugins/` and `*.repository.ts`. The type import `import type { SupabaseClient }` uses `allowTypeImports: true` so it will pass. The lint error should come only from `no-restricted-syntax`.

If the fixture itself triggers a `no-restricted-imports` error on the type import, adjust the fixture to avoid the type import entirely (use `any` type) to isolate the `no-restricted-syntax` test.

### Previous Story Intelligence (from Stories 1.5, 1.6, 1.7)

- **`.js` extensions on all relative imports** — required in `apps/api` (TSC emits `.js`; `tsx watch` hides this). All new files in this story must use `.js` extensions on relative imports.
- **`fp()` wraps every Fastify plugin** — `auditHook` must use `fp()` with `{ name: 'audit-hook' }` for decoration visibility at parent scope.
- **`pnpm build` (apps/api)** — always run after implementation to catch `.js` extension issues.
- **No `console.*`** in `apps/api/src/` — ESLint `no-console: error` is active (Story 1.7). Use `fastify.log` or `request.log`.
- **Fire-and-forget pattern** — `void promise.catch(err => log.error(...))` is the established pattern in `server.ts`. `audit.hook.ts` follows the same pattern.
- **Existing `no-restricted-syntax` block** — there are already two `no-restricted-syntax` rule entries in `apiConfig()`. Task 12 updates only the `audit_log`-specific one (the last entry at line ~196-208). Do not modify the first `no-restricted-syntax` entry (dynamic imports of vendor SDKs).
- **Story 1.5 deliberate-violation pattern** — fixture files live in `apps/api/src/__fixtures__/`. Create, verify error, delete. Same pattern here.
- **`fastify.d.ts` augmentation pattern** — `request.id` (already declared by Fastify) is a `string` type. `request.auditContext` needs to be added to `FastifyRequest` using the same module augmentation pattern already in the file.
- **BullMQ plugin `getWorker` typing** — `Parameters<typeof Worker>[1]` is the processor type. `fastify.d.ts` already has this via `BullMQFacade`.

### Project Structure Notes

**New files:**
```
supabase/
└── migrations/
    ├── 20260501110000_create_audit_event_type_enum.sql   NEW — Postgres audit_event_type enum
    └── 20260501140000_create_audit_log_partitioned.sql  NEW — table, indexes, partitions, function

apps/api/src/
├── repository/
│   └── base.repository.ts                              NEW — SupabaseClient constructor injector
├── audit/
│   ├── audit.types.ts                                  NEW — AuditEventType, AuditWriteInput
│   ├── audit.types.test.ts                             NEW — parity test vs migration
│   ├── audit.repository.ts                             NEW — insert() via BaseRepository
│   ├── audit.service.ts                                NEW — write() method
│   └── audit.service.test.ts                           NEW — unit tests (mocked repo)
├── middleware/
│   └── audit.hook.ts                                   NEW — onResponse fire-and-forget
├── jobs/
│   └── audit-partition-rotation.job.ts                 NEW — BullMQ cron job
├── types/
│   └── fastify.d.ts                                    MODIFIED — add request.auditContext
└── app.ts                                              MODIFIED — register auditHook + partition job
```

**Modified files:**
```
packages/eslint-config-hivekitchen/src/index.ts         MODIFIED — *.repository.ts ignore + audit selector fix
_bmad-output/implementation-artifacts/sprint-status.yaml MODIFIED — story status
```

### Architecture Compliance Invariants

| Rule | Impact on this story |
|---|---|
| Files outside `plugins/` cannot import SDK clients directly | `audit.repository.ts` imports only from `../repository/base.repository.js` — no `@supabase/**` import. `base.repository.ts` is in `repository/` (allowed after Task 12 ESLint fix). |
| Files outside `audit/` cannot write to `audit_log` directly | The `no-restricted-syntax` fix in Task 12 enforces this for the Supabase `.from().insert()` pattern. |
| No `console.*` in `apps/api/src/` | All logging uses `fastify.log` / `request.log` with Pino structure. |
| Every route handler calls a service — no business logic in handler | `audit.hook.ts` creates service/repo at plugin registration (not per-request). |
| `fp()` wraps every Fastify plugin | `auditHook = fp(auditHookPlugin, { name: 'audit-hook' })`. |

### Deferred Items (out of scope for Story 1.8)

- **Supabase `database.types.ts`** — `supabase gen types typescript` output; generated after migrations are applied to a local Supabase instance. Deferred until a local Supabase dev environment is wired (Epic 2).
- **Audit retention + cold archive job** — Story 9.7 scope (nightly job promoting hot → cold based on `event_type` category).
- **RLS policies on `audit_log`** — Epic 2 scope (auth + household scoping story).
- **`audit.hook.ts` route-level automation** — this story scaffolds the hook; individual routes in Epic 2+ are responsible for setting `request.auditContext` on mutations that require audit records.
- **`repository/repository.types.ts`** — deferred until a story needs shared repository type abstractions.
- **`idempotency.hook.ts`** — architecture §5.5; out of scope for this story.
- **`stages` field documentation per event_type** — `audit.types.ts` defines `AuditStage` as `{ stage: string; [key: string]: unknown }`. Per-event-type stage shapes are documented inline as they are implemented in Epic 3+ plan generation stories.

### References

- Architecture §1.6 Audit log: `_bmad-output/planning-artifacts/architecture.md`
- Architecture §4.2 Audit event_type taxonomy: `_bmad-output/planning-artifacts/architecture.md`
- Architecture §5.7 Audit write pattern: `_bmad-output/planning-artifacts/architecture.md`
- Architecture §2.2 API internal layout: `_bmad-output/planning-artifacts/architecture.md`
- Story 1.7 Dev Notes (fp(), .js extensions, pnpm build, deliberate-violation fixture): `_bmad-output/implementation-artifacts/1-7-pino-structured-logging-opentelemetry-skeleton-grafana-cloud-otlp.md`
- BullMQ v5 Job Schedulers: https://docs.bullmq.io/guide/job-schedulers
- Postgres Partitioned Tables: https://www.postgresql.org/docs/current/ddl-partitioning.html
- `SECURITY DEFINER` functions: https://www.postgresql.org/docs/current/sql-createfunction.html

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (1M context)

### Debug Log References

1. **Plugin registration order deviation from spec** — The Dev Notes originally placed `auditHook` "after requestIdPlugin (before vault/SDK plugins)". This is incompatible with the plugin implementation: `auditHookPlugin` constructs `new AuditRepository(fastify.supabase)` at plugin registration time, requiring `fastify.supabase` to already be decorated. Registered `auditHook` AFTER `bullmqPlugin` (i.e., after all SDK plugins). Because `fp()` hoists the `onResponse` hook to the root scope, route registration order does not affect hook coverage — the hook still fires for all subsequent routes.

2. **Pre-existing BullMQ type bug surfaced by first `getWorker` usage** — `fastify.d.ts` had `getWorker(name: string, processor: Parameters<typeof Worker>[1]): Worker`. `Parameters<ClassType>` resolves to `never` for a class constructor (you need `ConstructorParameters<typeof Worker>` for that). No code called `getWorker()` until this story, so the `never` type went undetected. Fixed by importing `Processor` from `bullmq` and using it directly. This item was flagged in Story 1.6 deferred list and is now resolved.

3. **Pre-existing unit test bug from Story 1.7 code review** — `src/modules/internal/health.routes.test.ts` constructs a minimal Fastify with its own `genReqId`. When Story 1.7's P1 patch added UUID-regex validation to `app.ts`'s `genReqId` AND added a new test asserting that a non-UUID header is replaced, the test's local `genReqId` was NOT updated to match. The pass-through `header ?? randomUUID()` echoes `"not-a-uuid"` verbatim, failing the replacement test. Fix: added the `REQUEST_ID_RE` check to the test's `genReqId` so it mirrors `app.ts`. This was a regression that slipped past Story 1.7 — addressed here because Story 1.8 cannot declare green tests while it is failing.

4. **Missing `@opentelemetry/resources` package** — declared in `apps/api/package.json` (Story 1.7 patch) but not installed in `node_modules`. Ran `pnpm install` at workspace root to fetch it. First typecheck after plugin/dep changes surfaced this.

5. **ESLint audit_log selector upgrade** — Story 1.5's original selector `CallExpression[callee.property.name='insert'][arguments.0.value='audit_log']` matched `.insert('audit_log')` but NOT the actual Supabase pattern `.from('audit_log').insert(...)`. Updated to `CallExpression[callee.property.name='insert'][callee.object.type='CallExpression'][callee.object.callee.property.name='from'][callee.object.arguments.0.value='audit_log']`. Deliberate-violation fixture confirms it fires on the real-world Supabase pattern.

6. **ESLint `no-restricted-imports` ignore pattern fix** — original `apps/api/src/**/repository.ts` matched only files literally named `repository.ts`, excluding `audit.repository.ts`, `base.repository.ts`, and any other named repository files. Updated to `apps/api/src/**/*.repository.ts`. Confirmed `audit.repository.ts` lints cleanly after the fix (via its inherited `BaseRepository` — it does not import `@supabase/**` directly, but the `base.repository.ts` in `repository/` does).

### Completion Notes List

- ✅ AC #1: Migration `20260501110000_create_audit_event_type_enum.sql` creates the `audit_event_type` enum with 37 values covering all 14 categories (plan, memory, heart_note, lunch_link, voice, billing, vpc, account, auth, allergy, agent, webhook, invite, llm.provider).
- ✅ AC #2: Migration `20260501140000_create_audit_log_partitioned.sql` creates `audit_log` parent table partitioned `BY RANGE (created_at)`, composite PK `(id, created_at)` (required for partition-key inclusion on PG 11+), composite index `audit_log_household_event_correlation_created_idx`, partial index `audit_log_guardrail_rejections_idx` with JSONB `@>` containment predicate, 6 initial monthly partitions (2026-05 through 2026-10), and `create_next_audit_partition()` SECURITY DEFINER function returning the created partition name.
- ✅ AC #3: `apps/api/src/jobs/audit-partition-rotation.job.ts` exports `registerAuditPartitionRotationJob(fastify)`. Uses BullMQ 5's `upsertJobScheduler` (idempotent) with cron `5 0 1 * *` UTC. Worker calls `fastify.supabase.rpc('create_next_audit_partition')` and structured-logs both success (with partition name) and failure. Registered in `app.ts` after `bullmqPlugin`.
- ✅ AC #4: `audit.types.ts` exports `AUDIT_EVENT_TYPES as const` (37 entries), `AuditEventType`, `AuditStage`, `AuditWriteInput`. `audit.types.test.ts` parses the migration SQL, extracts enum values, strips inline `--` comments, and asserts sorted equality with the TypeScript array — parity test passes. `audit.repository.ts` extends `BaseRepository` (no direct `@supabase/**` import) and wraps `.from('audit_log').insert(...)`. `audit.service.ts` exposes `write(input)` that delegates to the repository and propagates errors. `audit.hook.ts` is `fp()`-wrapped; constructs service/repo once at plugin registration and registers an `onResponse` hook that reads `request.auditContext` and fires `void service.write(ctx).catch(log.error)`. `fastify.d.ts` augments `FastifyRequest` with optional `auditContext`.
- ✅ AC #5: Updated `packages/eslint-config-hivekitchen/src/index.ts` — changed ignore pattern to `**/*.repository.ts` and upgraded the `audit_log` selector to match the real Supabase chain. Deliberate-violation fixture triggered exactly 1 error ("audit_log writes must live in apps/api/src/audit/"); fixture deleted; 0 errors after.
- ✅ AC #6: `pnpm typecheck` 9/9 green, `pnpm lint` 5/5 green, `pnpm test` 6/6 green (17 passing + 11 skipped integration in `apps/api`; contracts/eslint/ui all green). `pnpm build` at `apps/api` emits all expected files: `dist/audit/*`, `dist/jobs/audit-partition-rotation.job.js`, `dist/middleware/audit.hook.js`, `dist/repository/base.repository.js`.
- ℹ️ Added 4 new tests in `apps/api/src/audit/`: 1 parity test + 3 service unit tests (happy-path, error propagation, multi-stage `plan.generated` shape).
- ℹ️ Fixed pre-existing bugs outside Story 1.8 scope: BullMQ `Processor` typing in `fastify.d.ts` (Story 1.6 deferred item) and health.routes unit test `genReqId` (Story 1.7 test regression). Both fixes are minimal and necessary to unblock Story 1.8 verification.

### File List

**New files:**
- `supabase/migrations/.gitkeep`
- `supabase/migrations/20260501110000_create_audit_event_type_enum.sql`
- `supabase/migrations/20260501140000_create_audit_log_partitioned.sql`
- `apps/api/src/repository/base.repository.ts`
- `apps/api/src/audit/audit.types.ts`
- `apps/api/src/audit/audit.types.test.ts`
- `apps/api/src/audit/audit.repository.ts`
- `apps/api/src/audit/audit.service.ts`
- `apps/api/src/audit/audit.service.test.ts`
- `apps/api/src/middleware/audit.hook.ts`
- `apps/api/src/jobs/audit-partition-rotation.job.ts`

**Modified:**
- `apps/api/src/app.ts`
- `apps/api/src/types/fastify.d.ts`
- `apps/api/src/modules/internal/health.routes.test.ts` (pre-existing test regression — see Debug Log #3)
- `packages/eslint-config-hivekitchen/src/index.ts`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Review Findings

**Decision-needed (resolve before patching):**
- [x] [Review][Patch] D1→P12 [P1] Rename `audit_log_guardrail_rejections_idx` → `audit_log_plan_guardrail_rejections_idx` for clarity — index is scoped to plan-generation guardrail checks only, not all guardrail rejections [supabase/migrations/20260501140000_create_audit_log_partitioned.sql]
- [x] [Review][Patch] D2→P13 [P2] `create_next_audit_partition()` `date→timestamptz` cast is session-timezone-sensitive — change `%L::timestamptz` to `(%L::date)::timestamptz AT TIME ZONE 'UTC'` [supabase/migrations/20260501140000_create_audit_log_partitioned.sql]
- [x] [Review][Defer] D3→W7 [P2] `BaseRepository` uses untyped `SupabaseClient` — defer until `supabase gen types` is wired (Epic 2); Supabase always runs UTC so risk is theoretical today [apps/api/src/repository/base.repository.ts] — deferred, pre-existing

**Patch (clear fixes):**
- [x] [Review][Patch] P1 [P0] `SECURITY DEFINER` missing `SET search_path = pg_catalog, public` — allows search_path hijacking [supabase/migrations/20260501140000_create_audit_log_partitioned.sql]
- [x] [Review][Patch] P2 [P0] `SECURITY DEFINER` function is `PUBLIC`-executable — `anon` role can call DDL via RPC; add `REVOKE EXECUTE FROM PUBLIC; GRANT EXECUTE TO service_role` [supabase/migrations/20260501140000_create_audit_log_partitioned.sql]
- [x] [Review][Patch] P3 [P1] `void queue.upsertJobScheduler(...)` swallows startup rejection — scheduler silently never registers if Redis rejects; add `.catch(err => fastify.log.error(...))` [apps/api/src/jobs/audit-partition-rotation.job.ts]
- [x] [Review][Patch] P4 [P1] No retry configured on partition-rotation job — single transient failure leaves an entire month with no partition, all audit writes fail silently; add `attempts` + `backoff` to job `opts` [apps/api/src/jobs/audit-partition-rotation.job.ts]
- [x] [Review][Patch] P5 [P1] Two separate `no-restricted-syntax` config blocks — later block overrides earlier one for matching files, silently dropping the SDK dynamic-import/require guards for all non-plugin/non-audit files [packages/eslint-config-hivekitchen/src/index.ts]
- [x] [Review][Patch] P6 [P2] `registerAuditPartitionRotationJob` is a plain function, not an `fp()`-wrapped plugin — violates architecture constraint; bypasses Fastify plugin lifecycle, not covered by readiness guarantees [apps/api/src/jobs/audit-partition-rotation.job.ts + apps/api/src/app.ts]
- [x] [Review][Patch] P7 [P2] `api-repository` boundaries element pattern `**/repository.ts` doesn't match `audit.repository.ts` or `base.repository.ts` — boundaries rules are inoperative for all actual repository files [packages/eslint-config-hivekitchen/src/index.ts:116]
- [x] [Review][Patch] P8 [P2] Parity test SQL parser fragile — splits on `\n` then `,` with comment strip; can produce malformed tokens if a value shares a line with `)` or a comment contains `);` [apps/api/src/audit/audit.types.test.ts]
- [x] [Review][Patch] P9 [P3] Rollback comment in migration 2 omits `DROP TYPE audit_event_type;` — running migration 2 rollback leaves the enum type orphaned [supabase/migrations/20260501140000_create_audit_log_partitioned.sql:1]
- [x] [Review][Patch] P10 [P3] ESLint rule message says "plugins/ or repository.ts files" but the actual ignore pattern is `*.repository.ts` — stale message creates maintenance confusion [packages/eslint-config-hivekitchen/src/index.ts:168]
- [x] [Review][Patch] P11 [P3] Story AC #1 states "37 initial values" but the SQL spec in Dev Notes lists 43 — implementation correctly follows the SQL spec (43 values); the narrative count needs correction

**Defer (pre-existing, acknowledged, or out of scope):**
- [x] [Review][Defer] W1 [P0] Service role key shared across all requests — pre-existing arch decision, system-wide RLS story [supabase plugin] — deferred, pre-existing
- [x] [Review][Defer] W2 [P1] No FK/RLS on `household_id`/`user_id` in `audit_log` — explicitly deferred to Epic 2 in story Dev Notes — deferred, pre-existing
- [x] [Review][Defer] W3 [P1] BullMQ `Worker` error event unhandled — pre-existing concern in `bullmq.plugin.ts`, introduced first worker usage; check plugin handles `.on('error', ...)` — deferred, pre-existing
- [x] [Review][Defer] W4 [P2] `audit.repository.ts` UUID fields (`household_id`, `user_id`, `correlation_id`, `request_id`) have no runtime validation — system-wide AuditWriteInput concern, Epic 2+ boundary validation — deferred, pre-existing
- [x] [Review][Defer] W5 [P2] Partial index `audit_log_guardrail_rejections_idx` is partition-scoped only — cross-partition queries cannot use it; known Postgres partition index limitation — deferred, pre-existing
- [x] [Review][Defer] W6 [P2] Direct `new AuditRepository(...)`/`new AuditService(...)` in `audit.hook.ts` — matches spec, DI refactor is Epic 2+ scope — deferred, pre-existing

## Change Log

| Date | Change | By |
|---|---|---|
| 2026-04-24 | Story created from epics.md AC + architecture §1.6/§4.2/§5.7 + Story 1.6/1.7 learnings | Story Context Engine |
| 2026-04-24 | Story 1.8 implementation — two migrations (enum + partitioned table with indexes and 6 pre-created partitions + `create_next_audit_partition` function), `audit/` module (types/repository/service + parity and unit tests), `audit.hook.ts` fire-and-forget `onResponse`, `audit-partition-rotation.job.ts` BullMQ recurring job, app.ts wiring, ESLint rule upgrades. Resolved Story 1.6 deferred BullMQ `Processor` typing and Story 1.7 test regression to unblock verification. pnpm typecheck/lint/test/build all green. | Dev Agent (claude-opus-4-7) |
| 2026-04-24 | Code review findings written (3 decision-needed, 11 patch, 6 defer, 4 dismissed) | Review Agent |
