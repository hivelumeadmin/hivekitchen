# Story 7-S11: Account Deletion — 30-Day Cascade

Status: review

## Story

As a Primary Parent,
I want to request full account deletion with data erasure across the platform and all named processors within 30 days,
so that COPPA right-to-delete is honored (FR69, NFR-PRIV-2).

---

## Context & Scope

**What this slice builds:** The regulatory MVP wall for Epic 7. COPPA's right-to-delete is a hard launch gate — no public launch with real CC-VPC parents until this works end-to-end.

Three-part build:
1. **Multi-step confirmation UI** — Settings → "Delete my account" → Dialog → type household name → "Delete forever" → locked out.
2. **`POST /v1/households/:householdId/delete`** — soft-deletes household (sets `deletion_requested_at`), locks all active sessions, bans re-login, audits the request, returns 200 immediately.
3. **Nightly hard-delete job (`account-deletion.job.ts`)** — cron at 4am UTC; finds households past 30-day threshold; cascades hard-deletes across all tables; best-effort processor-erasure stubs for 6 processors; writes final `account.hard_deleted` audit row before the `households` row disappears.

**Login lock mechanism (two-step):**
- `fastify.supabase.auth.admin.updateUserById(userId, { ban_duration: '876600h' })` — prevents any new login (~100 years ban).
- `fastify.supabase.auth.admin.signOut(userId, 'global')` — revokes ALL active sessions immediately.
Both must be called. The ban prevents re-auth; the signOut kills existing tokens.

**This slice is API-hard-delete.** The `households.deletion_requested_at` column is the tombstone flag. Until day 30, the account's data stays in DB but the user cannot log in. At day 30 the nightly job sweeps it up.

**Scope guardrails — do NOT build:**
- Real processor-side API calls to ElevenLabs, SendGrid, Twilio, Stripe (stub + log only at MVP — see Dev Notes).
- Supabase Auth `deleteUser` at MVP (banned user can't log in; the auth record deletion is a processor task that requires FK sequencing — stubbed at MVP with `processor_deletion_log` pending status).
- Ops progress dashboard visible to the parent post-deletion (Epic 9 territory).
- Email to parent confirming deletion request.
- 30-day recovery/undo mechanism.
- Re-login enforcement beyond the ban + signOut — Supabase Auth handles it.

**Authorization:**
- `primary_parent` only. `secondary_caregiver` and `guest_author` get `403`.
- Cross-household `403`. Unauthenticated `401`. Non-UUID `:householdId` `400`.

---

## Acceptance Criteria

### AC1 — Multi-step confirmation web UI (Settings → Delete Account)

**Given** a `primary_parent` navigates to `/account`:
- A "Delete account" section is visible near the bottom (after the "Data portability" section from 7-S10).
- A "Delete my account" button (destructive variant — muted, not red per v2.0 design token note) is present.

**Given** the button is clicked:
- A `Dialog` (from `@/components/Dialog.js` — the custom codebase component, NOT a Radix import) opens.
- Dialog contains: a warning heading, explanatory copy, an input labeled `Type "{household display_name}" to confirm`, and a "Delete forever" button.
- The dialog fetches the household `display_name` via `GET /v1/households/:householdId/profile` (or kitchen-map endpoint) when it first opens. While fetching, the input is disabled with placeholder "Loading…".
- "Delete forever" button is disabled until the input exactly matches `household.display_name` (case-insensitive, trimmed).
- Pressing Escape closes the dialog without submitting.

**Given** "Delete forever" is clicked and the POST succeeds (200):
- Dialog shows: "Account deletion scheduled. Logging you out…" for 2 seconds.
- Then calls `useAuthStore().logout()` (which POSTs to `/v1/auth/logout` and clears local state).
- Browser redirects to `/auth/login`.

**Given** the POST returns a non-401 error:
- A `role="alert"` error line renders inside the dialog.
- The "Delete forever" button re-enables; dialog stays open.

### AC2 — `POST /v1/households/:householdId/delete` route

**Given** an authenticated `primary_parent` POSTs with body `{ confirmation_name: string }`:

**When** `householdId !== request.user.household_id`: `403 Forbidden`.

**When** `confirmation_name` (trimmed, case-insensitive) does NOT match `households.display_name` from DB:
- `400 Bad Request` with RFC7807 body: `{ type: '/errors/validation', title: 'Household name does not match', status: 400 }`.

**When** `deletion_requested_at IS NOT NULL` (already scheduled, idempotent path):
- `200` with `DeleteHouseholdResponseSchema`: `{ status: 'already_scheduled', scheduled_hard_delete_at: string, message: string }`.
- No repeat auth revocation — idempotent, no side effects.

**Happy path** (household exists, name matches, not yet scheduled):
1. Fetch `households.display_name` (needed for confirmation match + to compute scheduled date).
2. Set `households.deletion_requested_at = NOW()` via `UPDATE households SET deletion_requested_at = $1 WHERE id = $2`.
3. Call `fastify.supabase.auth.admin.updateUserById(request.user.id, { ban_duration: '876600h' })` — bans login.
4. Call `fastify.supabase.auth.admin.signOut(request.user.id, 'global')` — revokes all sessions.
5. Write `account.deletion_requested` audit row (best-effort — log warn on failure, do NOT re-throw).
6. Return `200` with `DeleteHouseholdResponseSchema`: `{ status: 'scheduled', scheduled_hard_delete_at: '<deletion_requested_at + 30 days ISO string>', message: string }`.

**Given** `secondary_caregiver` or `guest_author`: `403`.  
**Given** unauthenticated: `401`.  
**Given** non-UUID `:householdId`: `400`.

### AC3 — Nightly hard-delete job (cron, `account-deletion.job.ts`)

**Given** the job plugin is registered in `app.ts` and the cron fires (`0 4 * * *` UTC — 4am, 1h after the `memory-forget` job at 3am):
- Queries `households WHERE deletion_requested_at IS NOT NULL AND deletion_requested_at < NOW() - INTERVAL '30 days'`.
- For each qualifying household, calls `runAccountDeletion(deps, householdRow)` (extracted function — same pattern as `runMemoryForgetSweep` from 7-S5).
- If `runAccountDeletion` throws: logs the error and continues to the next household (do NOT re-throw per household — one bad household should not block others).
- The plugin registers via `fastify.bullmq.upsertJobScheduler` (cron pattern, like `memory-forget.job.ts`).

### AC4 — Hard-delete cascade (inside `runAccountDeletion`)

**Given** a household past the 30-day threshold, the cascade runs in this order using the service-role Supabase client (`fastify.supabase`):

1. **Write `account.hard_deleted` audit row FIRST** (with `household_id` still present — this preserves the deletion audit trail). Best-effort: log warn on failure, do NOT halt the cascade.

2. **Delete data in dependency order** (each step uses `fastify.supabase.from(...).delete()`):
   - `memory_provenance` WHERE `node_id IN (SELECT id FROM memory_nodes WHERE household_id = $1)` — explicit before memory_nodes if no CASCADE
   - `memory_nodes` WHERE `household_id = $1`
   - `child_allergens` WHERE `child_id IN (SELECT id FROM children WHERE household_id = $1)`
   - `child_preferences` WHERE `child_id IN (SELECT id FROM children WHERE household_id = $1)`
   - `child_lunch_requests` WHERE `household_id = $1`
   - `flavor_passport_stamps` WHERE `child_id IN (SELECT id FROM children WHERE household_id = $1)` (if table exists)
   - `children` WHERE `household_id = $1`
   - `plan_day_context` WHERE `household_id = $1`
   - `plans` WHERE `household_id = $1`
   - `heart_notes` WHERE `household_id = $1`
   - `lunch_link_sessions` WHERE `household_id = $1` (cascades to `lunch_link_keys` if FK CASCADE is set; else delete keys first)
   - `vpc_consents` WHERE `household_id = $1`
   - `thread_turns` WHERE `thread_id IN (SELECT id FROM threads WHERE household_id = $1)`
   - `threads` WHERE `household_id = $1`
   - `household_recipe_usage` WHERE `household_id = $1`
   - `brief_state` WHERE `household_id = $1`

3. **Selective audit_log delete** — preserve regulatory-retention rows:
   ```typescript
   const REGULATORY_EVENT_TYPES = [
     'billing.subscribed', 'billing.cancelled', 'billing.payment_failed',
     'billing.payment_recovered', 'billing.upgraded', 'billing.downgraded',
     'billing.gift_redeemed',
     'allergy.guardrail_rejection', 'allergy.uncertainty', 'allergy.check_overridden',
     'vpc.consented', 'parental_notice.acknowledged',
     'account.created', 'account.deletion_requested', 'account.hard_deleted',
   ] as const;
   // Delete all non-regulatory audit rows for this household
   await fastify.supabase
     .from('audit_log')
     .delete()
     .eq('household_id', householdId)
     .not('event_type', 'in', `(${REGULATORY_EVENT_TYPES.map(t => `"${t}"`).join(',')})`);
   ```

4. **Delete `public.users` rows** for the household (all roles: primary_parent, secondary_caregiver):
   ```typescript
   await fastify.supabase.from('users').delete().eq('household_id', householdId);
   ```

5. **Delete `processor_deletion_log` rows** for the household (only those in `pending` status — `completed`/`failed` are audit trail).
   - Actually: do NOT delete `processor_deletion_log` rows — they ARE audit trail for the deletion.

6. **Delete `households` row** — LAST (everything else is gone):
   ```typescript
   await fastify.supabase.from('households').delete().eq('id', householdId);
   ```

> **CRITICAL ORDER:** `households` row must be deleted LAST. If anything references `households.id` via FK, deleting it first will violate FK constraints. Verify the above order against actual FK definitions in the migrations. If any step fails with a FK violation, the table ordering here needs adjustment — add a note to deferred-work.md and re-throw so the job retries.

### AC5 — Processor-erasure stubs (inside `runAccountDeletion`, after cascade)

**Given** the hard-delete cascade completes, for each of 6 processors run sequentially (not `Promise.all` — avoids partial-log ambiguity):

```typescript
const PROCESSORS = ['supabase_auth', 'elevenlabs', 'sendgrid', 'twilio', 'stripe', 'openai'] as const;
```

For each:
1. Log `info`: `account-deletion: running processor erasure for ${processor}`.
2. Attempt the erasure:
   - `supabase_auth`: `await fastify.supabase.auth.admin.deleteUser(primaryParentUserId)` — **only** after the `households` row is deleted (avoids FK violation). Wrap in try/catch.
   - All others: `// TODO: implement real erasure call — stubbed at MVP`; immediately resolve.
3. Write `processor_deletion_log` row: `{ household_id, processor, status: 'completed'/'failed', attempted_at: now, completed_at: now (if success), error_message: err.message (if fail) }`.
4. Never re-throw on processor failure — log `warn`, continue.

> **Obtaining `primaryParentUserId`:** Before the cascade, query `users WHERE household_id = $1 AND role = 'primary_parent' LIMIT 1` to get the user_id needed for `supabase_auth` erasure. Store it before deleting the `users` rows in AC4 step 4. If the query returns null (user already deleted), skip the `supabase_auth` step and log `warn`.

### AC6 — Migration: `households.deletion_requested_at` + `processor_deletion_log` + audit event types

**Migration file:** `supabase/migrations/20260612000000_account_deletion.sql`

```sql
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
```

**USER-SIDE GATE:** `supabase db push --include-all` before any live deletion request.

In **`apps/api/src/audit/audit.types.ts`**, add to the `// account` cluster (after `'account.exported'`):
```typescript
'account.deletion_requested', // Story 7-S11 — soft-delete + login lock
'account.hard_deleted',       // Story 7-S11 — 30-day cascade complete
```

### AC7 — Contracts: `DeleteHouseholdRequestSchema` + `DeleteHouseholdResponseSchema`

Create **`packages/contracts/src/account-deletion.ts`**:
```typescript
import { z } from 'zod';

export const DeleteHouseholdRequestSchema = z.object({
  confirmation_name: z.string().min(1),
});
export type DeleteHouseholdRequest = z.infer<typeof DeleteHouseholdRequestSchema>;

export const DeleteHouseholdResponseSchema = z.object({
  status: z.enum(['scheduled', 'already_scheduled']),
  scheduled_hard_delete_at: z.string().datetime(),
  message: z.string(),
});
export type DeleteHouseholdResponse = z.infer<typeof DeleteHouseholdResponseSchema>;
```

**`packages/contracts/src/index.ts`** — add:
```typescript
export * from './account-deletion.js';
```

**`packages/types/src/index.ts`** — add type re-export (follow `DataExportResponse` pattern):
```typescript
import type { DeleteHouseholdResponseSchema } from '@hivekitchen/contracts';
export type DeleteHouseholdResponse = z.infer<typeof DeleteHouseholdResponseSchema>;
```

Contract test — **`packages/contracts/src/account-deletion.test.ts`** (4 cases):
- Valid round-trip parse: `{ status: 'scheduled', scheduled_hard_delete_at: '2026-07-12T04:00:00.000Z', message: '...' }`.
- Reject invalid status literal.
- Reject missing `status`.
- Reject non-datetime `scheduled_hard_delete_at`.

### AC8 — Tests

#### 8a — Route tests (`households.routes.test.ts`, new `describe('POST /v1/households/:householdId/delete (7-S11)')`)

Mock `fastify.supabase.auth.admin.updateUserById` and `fastify.supabase.auth.admin.signOut` in the test app builder (return `{ data: {}, error: null }`).
Mock `fastify.supabase.from('households').select(...)` to return a household with `display_name: 'The Menon Kitchen'` and `deletion_requested_at: null`.

Required cases:
- `200` happy path — `deletion_requested_at` update called, `updateUserById` called with `ban_duration: '876600h'`, `signOut` called with `'global'`, response matches `DeleteHouseholdResponseSchema`, `status === 'scheduled'`.
- `200` idempotent — `deletion_requested_at` already set, response `status === 'already_scheduled'`, no `updateUserById` call.
- `400` wrong `confirmation_name` — `confirmation_name: 'wrong name'`.
- `400` non-UUID `:householdId`.
- `403` cross-household.
- `403` `secondary_caregiver` role.
- `401` unauthenticated.

#### 8b — Job unit tests (`apps/api/src/jobs/account-deletion.job.test.ts`)

Extract `runAccountDeletion(deps, { id, deletion_requested_at })` from the worker callback (same pattern as `runMemoryForgetSweep` from 7-S5).

Required cases:
- Finds households WHERE `deletion_requested_at < cutoff` — asserts query called with correct filter.
- `account.hard_deleted` audit row written BEFORE `households.delete()`.
- Cascade delete order: `memory_nodes` deleted before `children`; `children` deleted before `plans`; `households` deleted last.
- `processor_deletion_log` rows written for all 6 processors after cascade.
- Processor failure does NOT halt the cascade — next processor is attempted.
- `supabase_auth` processor: `deleteUser` called with `primaryParentUserId`.
- If `users` lookup returns null (no primary_parent row): `supabase_auth` step skipped with `warn` log.

#### 8c — Web tests (`apps/web/src/routes/(app)/account-deletion.test.tsx` — new file)

Mock `hkFetch`, `useAuthStore` (`logout: vi.fn()`), `useNavigate`.

Required cases:
- "Delete my account" button renders.
- Clicking opens the Dialog (checks `role="dialog"` present).
- "Delete forever" disabled when input is empty.
- "Delete forever" disabled when input doesn't match household name.
- "Delete forever" enabled when input matches (case-insensitive trim).
- Success: `logout()` called; navigate called with `/auth/login`.
- Error: `role="alert"` renders inside dialog; logout NOT called.

---

## Tasks / Subtasks

### Task 1 — Migration + audit event types (AC: #6) ✅

Create **`supabase/migrations/20260612000000_account_deletion.sql`** — full SQL in AC6.

In **`apps/api/src/audit/audit.types.ts`**, add to the `// account` cluster:
```typescript
'account.deletion_requested', // Story 7-S11 — soft-delete + login lock
'account.hard_deleted',       // Story 7-S11 — 30-day cascade complete
```

---

### Task 2 — Contracts (AC: #7) ✅

Create `packages/contracts/src/account-deletion.ts` and `packages/contracts/src/account-deletion.test.ts` as specified in AC7.

Add `export * from './account-deletion.js'` to `packages/contracts/src/index.ts`.

Add type re-export to `packages/types/src/index.ts`.

---

### Task 3 — `HouseholdsRepository`: new methods for deletion (AC: #2, #4) ✅

Add to **`apps/api/src/modules/households/households.repository.ts`**:

```typescript
// 7-S11: look up display_name for deletion confirmation match.
async getDisplayName(householdId: string): Promise<{ display_name: string | null; deletion_requested_at: string | null } | null> {
  const { data, error } = await this.client
    .from('households')
    .select('display_name, deletion_requested_at')
    .eq('id', householdId)
    .maybeSingle();
  if (error) throw error;
  return data as { display_name: string | null; deletion_requested_at: string | null } | null;
}

// 7-S11: soft-delete — sets deletion_requested_at.
async requestDeletion(householdId: string, now: string): Promise<void> {
  const { error } = await this.client
    .from('households')
    .update({ deletion_requested_at: now })
    .eq('id', householdId);
  if (error) throw error;
}

// 7-S11: job sweep — find households past the 30-day threshold.
async findPendingHardDeletes(cutoffIso: string): Promise<Array<{ id: string; deletion_requested_at: string }>> {
  const { data, error } = await this.client
    .from('households')
    .select('id, deletion_requested_at')
    .not('deletion_requested_at', 'is', null)
    .lt('deletion_requested_at', cutoffIso);
  if (error) throw error;
  return (data ?? []) as Array<{ id: string; deletion_requested_at: string }>;
}
```

> **NOTE:** `this.client` is the service-role Supabase client (passed via constructor, same as all existing repository methods). No additional setup needed.

---

### Task 4 — Route: `POST /v1/households/:householdId/delete` (AC: #2) ✅

In **`apps/api/src/modules/households/households.routes.ts`**:

**Add imports** (at the top of the plugin):
```typescript
import {
  DeleteHouseholdRequestSchema,
  DeleteHouseholdResponseSchema,
  // … existing imports …
} from '@hivekitchen/contracts';
```

**Add route** (after the `POST /v1/households/:householdId/export` route — the last 7-S10 route):

```typescript
// Story 7-S11 — POST /v1/households/:householdId/delete
// COPPA right-to-delete (FR69, NFR-PRIV-2). Regulatory MVP wall.
// Soft-deletes household (sets deletion_requested_at), bans and revokes
// all active sessions. Hard-delete runs at day 30 via account-deletion.job.ts.
fastify.post(
  '/v1/households/:householdId/delete',
  {
    preHandler: authorize(['primary_parent']),
    schema: {
      params: z.object({ householdId: z.string().uuid() }),
      body: DeleteHouseholdRequestSchema,
      response: { 200: DeleteHouseholdResponseSchema },
    },
  },
  async (request, reply) => {
    const { householdId } = request.params as { householdId: string };
    const { confirmation_name } = request.body as { confirmation_name: string };

    if (householdId !== request.user.household_id) {
      throw new ForbiddenError('Cannot delete another household');
    }

    const household = await households.getDisplayName(householdId);
    if (!household) {
      throw new NotFoundError(`Household not found: ${householdId}`);
    }

    // Idempotent: if deletion is already scheduled, return early.
    if (household.deletion_requested_at !== null) {
      const scheduledAt = new Date(
        new Date(household.deletion_requested_at).getTime() + 30 * 24 * 60 * 60 * 1000,
      ).toISOString();
      reply.status(200);
      return {
        status: 'already_scheduled' as const,
        scheduled_hard_delete_at: scheduledAt,
        message: 'Account deletion is already scheduled.',
      };
    }

    // Confirmation name check (case-insensitive, trimmed).
    const expectedName = (household.display_name ?? '').trim().toLowerCase();
    const givenName = confirmation_name.trim().toLowerCase();
    if (expectedName === '' || expectedName !== givenName) {
      throw new ValidationError('Household name does not match');
    }

    const now = new Date().toISOString();
    const scheduledHardDeleteAt = new Date(
      new Date(now).getTime() + 30 * 24 * 60 * 60 * 1000,
    ).toISOString();

    // 1. Soft-delete: set deletion_requested_at.
    await households.requestDeletion(householdId, now);

    // 2. Ban login (~100-year ban prevents any re-authentication).
    await fastify.supabase.auth.admin.updateUserById(request.user.id, {
      ban_duration: '876600h',
    });

    // 3. Revoke all active sessions.
    await fastify.supabase.auth.admin.signOut(request.user.id, 'global');

    // 4. Audit row (best-effort).
    try {
      await auditService.write({
        event_type: 'account.deletion_requested',
        household_id: householdId,
        user_id: request.user.id,
        request_id: randomUUID(),
        metadata: { scheduled_hard_delete_at: scheduledHardDeleteAt },
      });
    } catch (auditErr) {
      fastify.log.warn(
        { err: auditErr, module: 'households', action: 'audit.failed', householdId },
        'account-deletion: audit write failed — deletion scheduled, continuing',
      );
    }

    reply.status(200);
    return {
      status: 'scheduled' as const,
      scheduled_hard_delete_at: scheduledHardDeleteAt,
      message:
        'Your account deletion has been scheduled. Your data will be permanently erased within 30 days.',
    };
  },
);
```

> **`ValidationError`** — check whether this error class exists in `apps/api/src/common/errors.ts` under this exact name. Other routes use it for 400 responses. If it maps to `{ type: '/errors/validation', status: 400 }` shape per the RFC7807 global error handler, use it directly. If not, check the `ForbiddenError` sibling exports and use the matching 400-class error.

> **`randomUUID`** — already imported at the top of `households.routes.ts` (added for 7-S10). Verify before adding a second import.

> **`authorize(['primary_parent'])`** — exact inline `preHandler` pattern used throughout `households.routes.ts` (lines 279, 353, 387, 447, and the 7-S10 route). No new named binding.

---

### Task 5 — Job: `account-deletion.job.ts` (AC: #3, #4, #5) ✅

Create **`apps/api/src/jobs/account-deletion.job.ts`**:

**Structural pattern:** Nightly cron scheduler like `memory-forget.job.ts`. Extract `runAccountDeletion(deps, household)` for unit-testability (same as `runMemoryForgetSweep`).

```typescript
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import { HouseholdsRepository } from '../modules/households/households.repository.js';

export const ACCOUNT_DELETION_QUEUE = 'account-deletion';

// These audit event types are retained for regulatory purposes even after
// household hard-delete. All other event_types for the household are purged.
const REGULATORY_EVENT_TYPES = [
  'billing.subscribed', 'billing.cancelled', 'billing.payment_failed',
  'billing.payment_recovered', 'billing.upgraded', 'billing.downgraded',
  'billing.gift_redeemed',
  'allergy.guardrail_rejection', 'allergy.uncertainty', 'allergy.check_overridden',
  'vpc.consented', 'parental_notice.acknowledged',
  'account.created', 'account.deletion_requested', 'account.hard_deleted',
] as const;

const PROCESSORS = ['supabase_auth', 'elevenlabs', 'sendgrid', 'twilio', 'stripe', 'openai'] as const;
type Processor = (typeof PROCESSORS)[number];

export interface AccountDeletionDeps {
  supabase: typeof fastify.supabase; // FastifyInstance['supabase']
  auditService: typeof fastify.auditService;
  log: typeof fastify.log;
}

export async function runAccountDeletion(
  deps: AccountDeletionDeps,
  household: { id: string; deletion_requested_at: string },
): Promise<void> {
  const { supabase, auditService, log } = deps;
  const householdId = household.id;

  log.info({ module: 'account-deletion', householdId }, 'account-deletion: starting hard-delete cascade');

  // ── 0. Find primary parent user_id BEFORE deleting users rows ───────────
  const { data: userRows, error: userLookupError } = await supabase
    .from('users')
    .select('id')
    .eq('household_id', householdId)
    .eq('role', 'primary_parent')
    .limit(1);
  if (userLookupError) {
    log.warn({ err: userLookupError, householdId }, 'account-deletion: failed to look up primary_parent user_id — supabase_auth erasure will be skipped');
  }
  const primaryParentUserId = (userRows as { id: string }[] | null)?.[0]?.id ?? null;

  // ── 1. Write account.hard_deleted audit row FIRST ───────────────────────
  // household_id is still valid at this point.
  try {
    await auditService.write({
      event_type: 'account.hard_deleted',
      household_id: householdId,
      request_id: householdId, // stable dedup key; no UUID to avoid Date.now()
      metadata: { cascade_started_at: household.deletion_requested_at },
    });
  } catch (auditErr) {
    log.warn({ err: auditErr, householdId }, 'account-deletion: audit.hard_deleted write failed — cascade continues');
  }

  // ── 2. Hard-delete cascade (dependency order) ────────────────────────────
  // Delete child-scoped rows before children; children before plans; plans
  // before households. households is LAST.

  const tables: Array<{ table: string; column: string; subquery?: string }> = [
    // memory
    { table: 'memory_provenance', column: 'node_id', subquery: `SELECT id FROM memory_nodes WHERE household_id = '${householdId}'` },
    { table: 'memory_nodes', column: 'household_id' },
    // children and child-scoped
    { table: 'child_allergens', column: 'child_id', subquery: `SELECT id FROM children WHERE household_id = '${householdId}'` },
    { table: 'child_preferences', column: 'child_id', subquery: `SELECT id FROM children WHERE household_id = '${householdId}'` },
    { table: 'child_lunch_requests', column: 'household_id' },
    { table: 'flavor_passport_stamps', column: 'child_id', subquery: `SELECT id FROM children WHERE household_id = '${householdId}'` },
    { table: 'children', column: 'household_id' },
    // plans
    { table: 'plan_day_context', column: 'household_id' },
    { table: 'plans', column: 'household_id' },
    // comms
    { table: 'heart_notes', column: 'household_id' },
    { table: 'lunch_link_sessions', column: 'household_id' },
    // consent + threads
    { table: 'vpc_consents', column: 'household_id' },
    { table: 'thread_turns', column: 'thread_id', subquery: `SELECT id FROM threads WHERE household_id = '${householdId}'` },
    { table: 'threads', column: 'household_id' },
    // misc
    { table: 'household_recipe_usage', column: 'household_id' },
    { table: 'brief_state', column: 'household_id' },
    // users (before households — FK users.household_id → households.id)
    { table: 'users', column: 'household_id' },
  ];

  for (const { table, column, subquery } of tables) {
    try {
      if (subquery) {
        // Supabase JS: filter with .in() and a raw subquery isn't supported.
        // Use a two-step: first fetch IDs, then delete. For large households,
        // this may need pagination — acceptable at beta scale.
        const { data: ids, error: idsErr } = await supabase.rpc('execute_sql_ids', {
          sql: subquery,
        }).throwOnError();
        // FALLBACK if no RPC available: use supabase.from(parentTable).select('id').eq(...)
        // and then .in('id', ids.map(r => r.id)).
        // See Dev Notes for the recommended two-step pattern.
        if (idsErr) throw idsErr;
        if (!ids || (ids as unknown[]).length === 0) continue;
        const { error } = await supabase
          .from(table)
          .delete()
          .in(column, (ids as { id: string }[]).map(r => r.id));
        if (error) throw error;
      } else {
        const { error } = await supabase.from(table).delete().eq(column, householdId);
        if (error) throw error;
      }
      log.info({ module: 'account-deletion', householdId, table }, `account-deletion: deleted ${table}`);
    } catch (err) {
      // If a table doesn't exist (e.g., flavor_passport_stamps before its
      // migration), log and continue — don't halt the cascade.
      log.warn({ err, householdId, table }, `account-deletion: delete from ${table} failed — continuing`);
    }
  }

  // ── 3. Selective audit_log purge ─────────────────────────────────────────
  // Keep regulatory-retention rows (billing, allergy, vpc, account events).
  try {
    await supabase
      .from('audit_log')
      .delete()
      .eq('household_id', householdId)
      .not('event_type', 'in', `(${REGULATORY_EVENT_TYPES.map(t => `"${t}"`).join(',')})`);
  } catch (err) {
    log.warn({ err, householdId }, 'account-deletion: audit_log selective purge failed — continuing');
  }

  // ── 4. Delete households row (LAST) ─────────────────────────────────────
  const { error: householdDeleteError } = await supabase
    .from('households')
    .delete()
    .eq('id', householdId);
  if (householdDeleteError) {
    // households delete failure is critical — re-throw so the job can retry.
    throw householdDeleteError;
  }
  log.info({ module: 'account-deletion', householdId }, 'account-deletion: households row deleted');

  // ── 5. Processor erasure stubs ───────────────────────────────────────────
  // Called AFTER households row is gone to avoid FK violation on supabase_auth.
  for (const processor of PROCESSORS) {
    const attemptedAt = new Date().toISOString();
    let status: 'completed' | 'failed' = 'completed';
    let errorMessage: string | undefined;

    try {
      if (processor === 'supabase_auth') {
        if (primaryParentUserId) {
          await supabase.auth.admin.deleteUser(primaryParentUserId);
          log.info({ module: 'account-deletion', householdId, processor }, 'account-deletion: supabase_auth user deleted');
        } else {
          log.warn({ module: 'account-deletion', householdId, processor }, 'account-deletion: no primary_parent user_id — skipping auth deletion');
        }
      } else {
        // TODO: implement real erasure call for this processor.
        // ElevenLabs: no user-level deletion API available at MVP.
        // SendGrid: no contact management needed (account deleted, no future sends).
        // Twilio: no user record stored at MVP.
        // Stripe: cancel subscription via Stripe API if active billing exists.
        // OpenAI: no user-level data stored (stateless prompt calls only).
        log.info({ module: 'account-deletion', householdId, processor }, `account-deletion: ${processor} erasure stubbed at MVP`);
      }
    } catch (err) {
      status = 'failed';
      errorMessage = err instanceof Error ? err.message : String(err);
      log.warn({ err, householdId, processor }, `account-deletion: ${processor} erasure failed`);
    }

    const completedAt = new Date().toISOString();
    try {
      await supabase.from('processor_deletion_log').insert({
        household_id: householdId,
        processor,
        status,
        error_message: errorMessage ?? null,
        attempted_at: attemptedAt,
        completed_at: status === 'completed' ? completedAt : null,
      });
    } catch (logErr) {
      log.warn({ err: logErr, householdId, processor }, 'account-deletion: processor_deletion_log write failed');
    }
  }

  log.info({ module: 'account-deletion', householdId }, 'account-deletion: cascade complete');
}

const accountDeletionPlugin: FastifyPluginAsync = async (fastify) => {
  // Nightly cron: 4am UTC (1h after memory-forget job at 3am UTC).
  await fastify.bullmq.upsertJobScheduler(
    ACCOUNT_DELETION_QUEUE,
    { pattern: '0 4 * * *' },
    { name: 'sweep', data: {} },
    {},
  );

  fastify.bullmq.getWorker(ACCOUNT_DELETION_QUEUE, async () => {
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const householdsRepo = new HouseholdsRepository(fastify.supabase, null);
    const pendingHouseholds = await householdsRepo.findPendingHardDeletes(cutoff);

    fastify.log.info(
      { module: 'account-deletion', count: pendingHouseholds.length },
      `account-deletion: found ${pendingHouseholds.length} households pending hard-delete`,
    );

    const deps: AccountDeletionDeps = {
      supabase: fastify.supabase,
      auditService: fastify.auditService,
      log: fastify.log,
    };

    for (const household of pendingHouseholds) {
      try {
        await runAccountDeletion(deps, household);
      } catch (err) {
        // Per-household failure must NOT halt other households.
        fastify.log.error(
          { err, module: 'account-deletion', householdId: household.id },
          'account-deletion: household cascade failed — skipping to next',
        );
      }
    }
  });
};

export const accountDeletionJobPlugin = fp(accountDeletionPlugin, {
  name: 'account-deletion-job',
});
```

> **CRITICAL — subquery pattern:** The code above uses `supabase.rpc('execute_sql_ids', ...)` as a placeholder. This RPC likely does NOT exist. The real pattern for two-step child deletes is:
> ```typescript
> // Step 1: fetch IDs from parent
> const { data: childRows } = await supabase
>   .from('children')
>   .select('id')
>   .eq('household_id', householdId);
> const childIds = (childRows ?? []).map(r => (r as { id: string }).id);
> if (childIds.length > 0) {
>   // Step 2: delete child-scoped table by those IDs
>   await supabase.from('child_allergens').delete().in('child_id', childIds);
> }
> ```
> Implement this two-step pattern directly in the `runAccountDeletion` function — do NOT use the RPC placeholder. The tables array sketch above is conceptual; the actual implementation should have explicit two-step fetches for subquery cases.

---

### Task 6 — Register job in `app.ts` (AC: #3) ✅

In **`apps/api/src/app.ts`**, add to the job imports block (after `dataExportJobPlugin`):
```typescript
import { accountDeletionJobPlugin } from './jobs/account-deletion.job.js';
```

Register (after `await app.register(dataExportJobPlugin)`):
```typescript
await app.register(accountDeletionJobPlugin);
```

---

### Task 7 — Web: Account page deletion UI (AC: #1) ✅

Modify **`apps/web/src/routes/(app)/account.tsx`**.

**Add import:**
```typescript
import { Dialog } from '@/components/Dialog.js';
```
(Custom Dialog component — NOT a Radix import; safe from `no-dialog-outside-allowlist` rule which targets Radix-specific import paths.)

**Add state** (near the top of the component):
```typescript
const [showDeleteDialog, setShowDeleteDialog] = useState(false);
const [deleteConfirmInput, setDeleteConfirmInput] = useState('');
const [householdDisplayName, setHouseholdDisplayName] = useState<string | null>(null);
const [householdDisplayNameLoading, setHouseholdDisplayNameLoading] = useState(false);
const [deleteState, setDeleteState] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
```

**Add handler** to fetch household name when dialog opens:
```typescript
async function handleOpenDeleteDialog() {
  setShowDeleteDialog(true);
  setDeleteConfirmInput('');
  setDeleteState('idle');
  if (householdDisplayName !== null) return; // already fetched
  const householdId = useAuthStore.getState().user?.current_household_id;
  if (!householdId) return;
  setHouseholdDisplayNameLoading(true);
  try {
    const result = await hkFetch<{ display_name: string | null }>(
      `/v1/households/${householdId}/profile`,
    );
    // HouseholdProfileResponse may not include display_name directly.
    // If the endpoint returns it, use it. Otherwise use the kitchen-map endpoint.
    // Check apps/api/src/modules/households/households.routes.ts for the actual
    // /v1/households/:id/profile response shape.
    setHouseholdDisplayName(result.display_name ?? null);
  } catch {
    setHouseholdDisplayName(null);
  } finally {
    setHouseholdDisplayNameLoading(false);
  }
}
```

> **IMPORTANT — profile endpoint shape:** Before implementing `handleOpenDeleteDialog`, read `apps/api/src/modules/households/households.routes.ts` to find `GET /v1/households/:householdId/profile` and confirm what it returns. If it does NOT include `display_name`, use `GET /v1/households/:householdId/kitchen-map` instead (which includes `household.display_name` per `KitchenMapResponseSchema`). The kitchen-map fetch pattern is used in `apps/web/src/routes/(app)/kitchen-profile.tsx` — mirror it.

**Add deletion handler:**
```typescript
async function handleDeleteAccount() {
  const householdId = useAuthStore.getState().user?.current_household_id;
  if (!householdId || !householdDisplayName) return;
  setDeleteState('pending');
  try {
    await hkFetch<unknown>(`/v1/households/${householdId}/delete`, {
      method: 'POST',
      body: { confirmation_name: deleteConfirmInput },
    });
    setDeleteState('success');
    await new Promise((r) => setTimeout(r, 2000));
    await useAuthStore.getState().logout();
  } catch (err) {
    if (err instanceof HkApiError && err.status === 401) {
      navigate('/auth/login?next=/account', { replace: true });
      return;
    }
    setDeleteState('error');
  }
}
```

**Add section and dialog** (place AFTER the "Data portability" section from 7-S10, near the end of the return JSX):

```tsx
{/* Delete account section — Primary Parent only */}
<section className="mt-12">
  <h2 className="font-serif text-xl text-fg">Delete account</h2>
  <p className="mt-2 font-sans text-sm text-fg-muted leading-relaxed">
    Permanently delete your household and all associated data. This action cannot be undone.
  </p>
  <div className="mt-4">
    <button
      type="button"
      onClick={() => { void handleOpenDeleteDialog(); }}
      className="rounded-lg border border-warm-neutral-400 bg-surface px-4 py-2 font-sans text-sm text-fg hover:bg-surface/80"
    >
      Delete my account
    </button>
  </div>
</section>

<Dialog
  open={showDeleteDialog}
  onClose={() => {
    if (deleteState === 'pending') return; // prevent close while submitting
    setShowDeleteDialog(false);
    setDeleteConfirmInput('');
    setDeleteState('idle');
  }}
  titleId="delete-account-dialog-title"
  descriptionId="delete-account-dialog-desc"
>
  <div className="flex flex-col gap-4 p-6">
    <h2 id="delete-account-dialog-title" className="font-serif text-lg text-fg">
      Delete your account permanently?
    </h2>
    <p id="delete-account-dialog-desc" className="font-sans text-sm text-fg-muted leading-relaxed">
      All household data — plans, children, memory, Heart Notes — will be erased within 30 days.
      You will be logged out immediately and cannot log back in.
    </p>

    {householdDisplayNameLoading ? (
      <p className="font-sans text-sm text-fg-muted">Loading…</p>
    ) : householdDisplayName !== null ? (
      <div className="flex flex-col gap-2">
        <label
          htmlFor="delete-confirm-input"
          className="font-sans text-sm text-fg"
        >
          {`Type "${householdDisplayName}" to confirm`}
        </label>
        <input
          id="delete-confirm-input"
          type="text"
          value={deleteConfirmInput}
          onChange={(e) => { setDeleteConfirmInput(e.target.value); }}
          disabled={deleteState === 'pending' || deleteState === 'success'}
          className="rounded-lg border border-border bg-surface px-3 py-2 font-sans text-sm text-fg placeholder:text-fg-muted disabled:opacity-50"
          placeholder={householdDisplayName}
          autoComplete="off"
        />
      </div>
    ) : null}

    {deleteState === 'error' && (
      <p role="alert" className="font-sans text-sm text-fg-muted">
        Something went wrong. Please try again.
      </p>
    )}

    {deleteState === 'success' ? (
      <p className="font-sans text-sm text-fg-muted">
        Account deletion scheduled. Logging you out…
      </p>
    ) : (
      <div className="flex gap-3 justify-end">
        <button
          type="button"
          onClick={() => {
            setShowDeleteDialog(false);
            setDeleteConfirmInput('');
            setDeleteState('idle');
          }}
          disabled={deleteState === 'pending'}
          className="rounded-lg border border-border bg-surface px-4 py-2 font-sans text-sm text-fg disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => { void handleDeleteAccount(); }}
          disabled={
            deleteState === 'pending' ||
            householdDisplayName === null ||
            deleteConfirmInput.trim().toLowerCase() !== householdDisplayName.trim().toLowerCase()
          }
          className="rounded-lg border border-warm-neutral-400 bg-surface px-4 py-2 font-sans text-sm text-fg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-surface/80"
        >
          {deleteState === 'pending' ? 'Deleting…' : 'Delete forever'}
        </button>
      </div>
    )}
  </div>
</Dialog>
```

> **Destructive button styling:** v2.0 design token note — the `destructive` button variant is intentionally muted (not red). Red is reserved for `--safety-red` (allergen states). The "Delete forever" button uses the same raw-bordered style as other action buttons on the page. Do NOT use `--safety-red` or `text-red-*`.

> **Profile fetch note:** If `GET /v1/households/:id/profile` does NOT return `display_name` (it may only return cultural/dietary/allergen data), use `GET /v1/households/:id/kitchen-map` instead. The kitchen-map schema has `household.display_name`. Check the actual response shape in `households.routes.ts` before coding.

---

### Task 8 — Tests (AC: #8) ✅

Create tests as specified in AC8. Follow patterns from `account-export.test.tsx` (7-S10) and `memory-forget.job.test.ts` (7-S5) for job tests.

Key test fixture for route tests: mock `supabase.auth.admin.updateUserById` and `supabase.auth.admin.signOut` to return `{ data: {}, error: null }`. These are already available on the `fastify.supabase.auth.admin` mock path — check `households.routes.test.ts` for how other routes mock auth admin calls (pattern from 7-S10's `getUserById`).

---

## Dev Notes

### Zod 4 note (critical)
Project runs **Zod 4**, not Zod 3.23. `z.record` requires two arguments:
```typescript
z.record(z.string(), z.unknown())  // ✅ Zod 4
z.record(z.unknown())               // ❌ throws under Zod 4
```

### `ban_duration` format
Supabase Auth admin `updateUserById` accepts `ban_duration` as a Go-style duration string. `'876600h'` = 876,600 hours ≈ 100 years. This effectively prevents re-login. The user was already signed out via `signOut('global')`, but the ban ensures even password-reset flows are blocked.

Reference: `apps/api/src/modules/auth/auth.service.ts` line 98 uses `signOut(userId, 'global')` — same pattern for invite revocation. The `updateUserById` call pattern is the same client: `fastify.supabase.auth.admin`.

### Job cron: 4am UTC vs. memory-forget at 3am UTC
`memory-forget.job.ts` runs at `0 3 * * *`. Account deletion is staggered to `0 4 * * *` to avoid concurrent DB load. Same `upsertJobScheduler` + `getWorker` pattern.

### Cascade ordering — FK constraint risk
The cascade order in AC4 / Task 5 is prescriptive but may need adjustment based on actual FK definitions in migrations. If `households.delete()` fails with a FK violation, it means a table was missed. Add the missing table to the cascade before `households`.

The most likely FK issue: `users.household_id → households.id`. The explicit `users.delete()` before `households.delete()` in the cascade handles this, but only if Supabase JS `.delete()` runs before the households delete. Verify by reading the relevant migration files (`20260XXX_create_households.sql` or auth-related migrations).

### Subquery workaround for child-scoped tables
Supabase JS `.in()` accepts an array, not a subquery string. For child-scoped tables (`child_allergens`, `child_preferences`, `flavor_passport_stamps`), use a two-step:
```typescript
const { data: childIds } = await supabase
  .from('children')
  .select('id')
  .eq('household_id', householdId);
const ids = (childIds ?? []).map(r => (r as { id: string }).id);
if (ids.length > 0) {
  await supabase.from('child_allergens').delete().in('child_id', ids);
}
```
Run this BEFORE deleting `children`. Replace the `subquery` placeholder in the tables array with explicit two-step calls.

### `flavor_passport_stamps` table existence
The job stub tries to delete `flavor_passport_stamps`. If this table doesn't exist yet (Epic 4 shipped it but a migration check is needed), the delete will fail silently (logged as warn + continue). That's correct — the table-level try/catch in the job handles missing tables gracefully.

### `processor_deletion_log.not_in` filter syntax
The audit_log delete uses `.not('event_type', 'in', ...)`. Supabase JS's `.not(col, 'in', val)` requires the value to be a PostgREST array literal: `(val1,val2,val3)`. The string format in AC4 step 3 matches this: `(${REGULATORY_EVENT_TYPES.map(t => `"${t}"`).join(',')})`. Verify against existing `.not('event_type', 'in', ...)` usage in the codebase (audit.repository.ts) for the exact format.

### Dialog component — no ESLint violation
The custom `Dialog` at `apps/web/src/components/Dialog.tsx` is NOT a Radix/shadcn import. The `no-dialog-outside-allowlist` ESLint rule targets `@radix-ui/react-dialog` and `@radix-ui/react-alert-dialog` imports, not the custom component. Importing `{ Dialog } from '@/components/Dialog.js'` is safe in `account.tsx`. Reference: `apps/web/src/routes/(app)/child-flavor-passport.tsx` uses the same import for the flavor-journey reset Dialog.

### Household `display_name` fetch for confirmation UI
The `GET /v1/households/:id/profile` route returns `HouseholdProfileResponseSchema` (cultural_identifiers, dietary_preferences, declared_allergens) — it does NOT include `display_name`. Use `GET /v1/households/:id/kitchen-map` instead, which returns `KitchenMapResponseSchema` with `household.display_name`. Mirror the fetch pattern from `apps/web/src/routes/(app)/kitchen-profile.tsx`.

### Test baseline (do not introduce NEW failures)
- **Web tests before this slice:** 463/463 (post-7-S10 baseline)
- **API tests before this slice:** 1567-pass / 20-fail / 13-skip (post-7-S10 baseline)
- **Contracts:** `data-export.test.ts` 4/4 + new `account-deletion.test.ts`
- **TypeScript:** API 11 pre-existing errors (≤14), web 3, contracts 1, types 1 — zero new errors in changed files

### `ValidationError` vs `ForbiddenError` for 400
Check `apps/api/src/common/errors.ts` for the 400-class error name. In `households.routes.ts`, the 400 responses from other routes use... check the existing `ValidationError` usage. If `ValidationError` doesn't exist, the closest equivalent may be `BadRequestError` or a direct Fastify HTTP error throw. Use whatever the codebase already has for 400.

---

## Dev Agent Record

### Completion Notes

Implemented all 8 ACs across 8 tasks. Regulatory MVP wall for COPPA right-to-delete (FR69, NFR-PRIV-2).

**What shipped:**
- **Migration** `20260612000000_account_deletion.sql` — `households.deletion_requested_at` (nullable TIMESTAMPTZ) + partial index, `processor_deletion_log` table (processor + status CHECK constraints + household index). `account.deletion_requested` and `account.hard_deleted` added to `audit.types.ts`.
- **Contracts** `account-deletion.ts` — `DeleteHouseholdRequestSchema` + `DeleteHouseholdResponseSchema` (+ index re-export, `DeleteHouseholdResponse` type re-export). 4 contract tests.
- **Repository** — `getDisplayName`, `requestDeletion`, `findPendingHardDeletes` on `HouseholdsRepository`.
- **Route** `POST /v1/households/:householdId/delete` — primary_parent only; cross-household 403; non-UUID 400; name-mismatch 400 (`ValidationError`); idempotent `already_scheduled` path with no repeat auth revocation; happy path sets `deletion_requested_at`, bans (`ban_duration: '876600h'`), `signOut('global')`, best-effort `account.deletion_requested` audit, returns 200 with `+30d` scheduled date.
- **Job** `account-deletion.job.ts` — nightly cron `0 4 * * *` UTC (1h after memory-forget). Extracted `runAccountDeletion(deps, household)`: primary_parent lookup → `account.hard_deleted` audit FIRST → cascade deletes in dependency order (two-step `.in()` for child/memory/thread-scoped tables, direct `.eq` for household-scoped; per-table try/catch continues on missing tables) → selective `audit_log` purge keeping 15 regulatory event types → `households` delete LAST (re-throws → BullMQ retry) → 6 sequential processor-erasure stubs (real `deleteUser` for `supabase_auth` after the households row is gone; others stubbed) each writing `processor_deletion_log`. Per-household failure isolated in the worker loop. Registered in `app.ts`.
- **Web** — `account.tsx` primary-parent "Delete account" section + multi-step `Dialog`: lazy kitchen-map fetch for `household.display_name`; "Delete forever" enabled only on case-insensitive, trimmed match; success → 2s "Logging you out…" → `logout()` → `navigate('/auth/login')`; 401 → login redirect; error → `role="alert"`.

**Spec reconciliations (3):**
1. Job scheduler uses `fastify.bullmq.getQueue(Q).upsertJobScheduler(...)` + `getWorker(...)` (the canonical `memory-forget.job.ts` pattern), NOT the story-sketch `fastify.bullmq.upsertJobScheduler(...)` which is not the real plugin API.
2. Cascade child-scoped deletes use an inline two-step (fetch parent ids → `.in(...)`), per the story's own CRITICAL note — the `execute_sql_ids` RPC placeholder was dropped.
3. The delete section + dialog match the existing `account.tsx` idiom (`border-t`/`space-y-3` sections, `text-safety-red` error copy consistent with the page's 6 other error lines). The destructive button stays muted raw-bordered (no `--safety-red`) per the v2 design note.

**Note:** `project-context.md` says Zod 3.23, but `packages/contracts` is on Zod `^4.0.0` — the story's Zod 4 guidance is correct.

**Verification:** contracts 4/4; full API 1584-pass / 20-fail (unchanged baseline) / 13-skip — my 15 new API tests (delete route ×8, job ×6, repo ×1) all pass; full web 470/470 (463 baseline + 7 new). Typecheck: zero new errors in changed files (contracts 1 / types 1 / api 11 / web 3 — all pre-existing baseline). Lint: all new/changed files clean.

**USER-SIDE GATE:** `supabase db push --include-all` (migration `20260612000000`) before any live deletion. Live ban + signOut + nightly cascade require a manual demo (BullMQ + Redis + Supabase Auth).

### Debug Log

- `GET /v1/households/:householdId/memory` route test (`households.routes.test.ts:569`) fails — confirmed pre-existing (fails identically on the clean tree via `git stash`); it is one of the documented 20 baseline API failures, unrelated to this slice.
- Fixed one self-introduced lint error: unused `_cols` mock param in `account-deletion.job.test.ts`. The pre-existing `households.repository.ts:1` `import type` error (Buffer used only as a type) was left untouched per surgical-change discipline.

---

## File List

**New files:**
- `supabase/migrations/20260612000000_account_deletion.sql`
- `packages/contracts/src/account-deletion.ts`
- `packages/contracts/src/account-deletion.test.ts`
- `apps/api/src/jobs/account-deletion.job.ts`
- `apps/api/src/jobs/account-deletion.job.test.ts`
- `apps/web/src/routes/(app)/account-deletion.test.tsx`

**Modified files:**
- `apps/api/src/audit/audit.types.ts` — add `'account.deletion_requested'` + `'account.hard_deleted'`
- `packages/contracts/src/index.ts` — add `export * from './account-deletion.js'`
- `packages/types/src/index.ts` — add `DeleteHouseholdResponse` type re-export
- `apps/api/src/modules/households/households.repository.ts` — add `getDisplayName`, `requestDeletion`, `findPendingHardDeletes`
- `apps/api/src/modules/households/households.routes.ts` — add `DeleteHouseholdRequestSchema` + `DeleteHouseholdResponseSchema` imports, add `POST /v1/households/:householdId/delete` route
- `apps/api/src/modules/households/households.routes.test.ts` — add deletion route test block
- `apps/api/src/app.ts` — import + register `accountDeletionJobPlugin`
- `apps/web/src/routes/(app)/account.tsx` — add `Dialog` import, deletion state, handlers, and "Delete account" section + dialog JSX

**USER-SIDE GATE:** `supabase db push --include-all` (migration `20260612000000`) before any live deletion attempt.

---

## References

- [`_bmad-output/planning-artifacts/epic-7-vertical-slices.md#Slice 7-S11`] — demo path, layers, "regulatory MVP wall" rationale
- [`_bmad-output/planning-artifacts/epics.md` §Story 7.5] — original AC: soft-delete, 30-day cascade, processor erasure SLA, regulatory-retention exceptions
- [`apps/api/src/jobs/memory-forget.job.ts`] — canonical nightly cron BullMQ job pattern: `upsertJobScheduler` + `getWorker` + extracted `runMemoryForgetSweep` for unit-testability
- [`apps/api/src/jobs/data-export.job.ts`] — (7-S10) `fastify.supabase.auth.admin.getUserById` usage + `fastify.auditService.write` best-effort pattern
- [`apps/api/src/modules/auth/auth.service.ts:98`] — `supabase.auth.admin.signOut(userId, 'global')` pattern (exact same call needed here)
- [`apps/api/src/modules/households/households.routes.ts`] — `authorize` import, `ForbiddenError`/`NotFoundError` usage, route pattern for `POST` with 200 body + `reply.status(200)` before return
- [`apps/web/src/components/Dialog.tsx`] — custom Dialog component API: `{ open, onClose, titleId, descriptionId, children }`
- [`apps/web/src/routes/(app)/child-flavor-passport.tsx`] — Dialog usage in app route (reset flavor journey) — exact same pattern needed for account deletion
- [`apps/web/src/routes/(app)/account.tsx`] — target file: existing structure, imports, state management patterns, `handleExport` pattern from 7-S10 to mirror for `handleDeleteAccount`
- [`apps/web/src/routes/(app)/kitchen-profile.tsx`] — reference for `GET /v1/households/:id/kitchen-map` fetch to obtain `household.display_name`
- [`_bmad-output/project-context.md`] — thin-handler rule, Zod 4 invariants, strict TS, Tailwind-only UI
- [`_bmad-output/implementation-artifacts/7-s10-json-data-export.md`] — previous story: `account.exported` audit pattern, `households.routes.ts` route registration pattern, web test structure for account page features
- [PRD: FR69] — Primary Parent can request full account deletion within 30 days
- [PRD: NFR-PRIV-2] — deletion-on-request honored within 30 days across all named processors
- [PRD: NFR-PRIV-5] — data retention table (regulatory-retention categories for audit_log)

---

### Review Findings

**Decision-needed (resolve before patching):**

- [x] [Review][Decision→Patch] Secondary caregivers not erased from Supabase Auth — resolved: fetch all household user IDs (all roles) before cascade, call `deleteUser` for each [account-deletion.job.ts:89–98]
- [x] [Review][Decision→Dismiss] Web loading state mismatch with spec — resolved: current paragraph → input UX accepted as equivalent [account.tsx:628–646]

**Patches (fixable without human input):**

- [x] [Review][Patch] `memory_provenance` delete uses wrong column `node_id` — the table's FK column is `memory_node_id`, not `node_id`; the `.in('node_id', memoryNodeIds)` filter is a PostgREST no-op, leaving provenance rows only cleaned up by the ON DELETE CASCADE when `memory_nodes` is deleted [account-deletion.job.ts:128] — **patched**: column corrected to `memory_node_id`
- [x] [Review][Patch] `users` table delete uses wrong column `household_id` — `public.users` has no `household_id` column (the FK is `current_household_id`); the `.eq('household_id', householdId)` delete is a no-op; users rows survive until transitively cascade-deleted via auth erasure [account-deletion.job.ts:144] — **patched**: column corrected to `current_household_id`; Step 0 updated to fetch all household users (all roles)
- [x] [Review][Patch] Web: kitchen-map fetch failure silently renders nothing — when `handleOpenDeleteDialog` catch sets `householdDisplayName = null`, the input section is absent and no error copy is shown; the dialog is stuck in an unrecoverable state with the "Delete forever" button permanently disabled and no message to the user [account.tsx:628–646] — **patched**: added `householdDisplayNameError` state + error copy branch
- [x] [Review][Patch] `guest_author` 403 not covered in route tests — AC2 lists `guest_author` as a required 403 case; AC8 requires it as a test scenario; only `secondary_caregiver` is tested [households.routes.test.ts] — **patched**: guest_author 403 test added
- [x] [Review][Patch] Web test missing error-branch assertions — error test verifies `role="alert"` present and `logout` not called, but does not assert dialog remains open or "Delete forever" button re-enables (AC1/AC8) [account-deletion.test.tsx] — **patched**: both assertions added

**Deferred (not caused by this slice, not actionable now):**

- [x] [Review][Defer] No row limit on `findPendingHardDeletes` — large backlog could OOM the worker; acceptable at beta scale [account-deletion.job.ts:306] — deferred, scalability concern
- [x] [Review][Defer] No atomic TX: partial failure after `requestDeletion` succeeds but `updateUserById`/`signOut` throws leaves account soft-deleted but user unbanned; no retry path [households.routes.ts] — deferred, codebase-wide no-transaction pattern
- [x] [Review][Defer] `already_scheduled` idempotent path doesn't retry failed auth revocation from original call — if the first request soft-deleted but failed the ban/signOut, a second call returns 200 `already_scheduled` with no remedy [households.routes.ts] — deferred, edge case acceptable at beta
- [x] [Review][Defer] `request_id: householdId` in `account.hard_deleted` audit write — using householdId as dedup key silences retry audit rows; deliberate design documented in comments [account-deletion.job.ts:111] — deferred, documented design choice
- [x] [Review][Defer] `audit_log` selective purge quoting format unverified — `.not('event_type', 'in', '("billing.subscribed",...)')` uses double-quotes; PostgREST accepts double-quoted string values in `in` filters but live verification needed against actual DB behavior [account-deletion.job.ts:177] — deferred, needs live PostgREST verification
- [x] [Review][Defer] "Delete my account" button not explicitly styled as destructive-muted per v2.0 spec — uses neutral border idiom matching rest of page; cosmetic [account.tsx:597] — deferred, cosmetic

---

## Change Log

| Date       | Change                                                                        |
| ---------- | ----------------------------------------------------------------------------- |
| 2026-06-05 | Story file authored for 7-S11 Account Deletion 30-Day Cascade. Status → ready-for-dev. |
| 2026-06-05 | Implemented all 8 ACs / 8 tasks: migration + audit types, contracts, repository methods, delete route, nightly hard-delete job, app.ts registration, web deletion UI, tests across all layers. API 1584-pass/20-fail (baseline), web 470/470, typecheck 0 new. Status → review. |
| 2026-06-05 | Code review complete (3-layer adversarial). 6 patches applied: P1 memory_provenance column node_id→memory_node_id (PostgREST no-op fix); P2 users delete column household_id→current_household_id (PostgREST no-op fix); P3 kitchen-map fetch error state in dialog (householdDisplayNameError branch); P4 guest_author 403 route test; P5 error-branch assertions (dialog open + button re-enables); P6 secondary caregiver auth erasure (fetch all household users, loop deleteUser). All tests green (API 54/54 7-S11 suite, web 7/7). 6 deferred (findPendingHardDeletes no row-limit; no atomic TX; already_scheduled no-retry; audit dedup key; audit_log NOT-IN quoting; button styling). Status → done. |
