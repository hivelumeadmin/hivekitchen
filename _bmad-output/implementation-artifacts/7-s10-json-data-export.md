# Story 7-S10: JSON Data Export

Status: done

## Story

As a Primary Parent,
I want to request an export of all my household's data in machine-readable JSON,
so that my data is portable and the AADC right-to-portability is honored (FR71, NFR-PRIV-6, AR-22).

---

## Context & Scope

**What this slice builds:** A data portability export. The parent taps "Export my data" in Settings → the API queues a BullMQ job → the job composes a JSON snapshot of all household tables, decrypts envelope-encrypted fields, HMAC-signs the payload for tamper-evidence, uploads to Supabase Storage, emails a 30-day signed URL via SendGrid, and writes an `account.exported` audit row.

**Async-only.** Never inline the export composition — the snapshot is too large. The POST handler returns `202` immediately with "we'll email you within 72h". The job runs as soon as it dequeues.

**Primary Parent only.** Data portability is a privileged action. `secondary_caregiver` and `guest_author` get `403`.

**What doesn't exist yet (you must create these):**
- `account.exported` audit event type — needs a migration + TypeScript update
- Supabase Storage bucket `data-exports` — needs a migration (SQL `storage.create_bucket` idiom)
- `data-export.job.ts` — on-demand BullMQ worker (NOT a cron scheduler — different from `memory-forget.job.ts`)
- `DataExportResponseSchema` contract

**Cross-epic dependency (deferred):** Slice 4-S8 (SendGrid delivery service) is marked `deferred`. Use `fastify.sendgrid` (the already-registered decorator) directly from the job. Do NOT wait for 4-S8 to ship — the decorator is available today.

**Scope guardrails — do NOT build:**
- Export status polling endpoint (no `GET /v1/households/:id/export/status`)
- Multiple-request throttle / dedup
- ZIP or PDF format (JSON only)
- Email delivery failure retry UI
- Per-export encryption key (the HMAC uses `JWT_SECRET` — symmetric, verifiable by the API)
- Any new Supabase Auth UI flows

---

## Acceptance Criteria

### AC1 — `POST /v1/households/:householdId/export` (202 dispatch)

**Given** an authenticated `primary_parent`, **When** they `POST /v1/households/:householdId/export`, **Then** a BullMQ job is enqueued on the `data-export` queue and the API returns `202` with a body matching `DataExportResponseSchema`: `{ status: 'queued', message: string }`.

**Given** the `:householdId` does not match the caller's `household_id`, **Then** `403 Forbidden`.

**Given** `secondary_caregiver` or `guest_author` role, **Then** `403 Forbidden`.

**Given** unauthenticated request, **Then** `401`. Non-UUID param, **Then** `400`.

### AC2 — Job composes full household JSON snapshot

**Given** the job worker receives a `DataExportJobData` payload `{ household_id, user_id, request_id }`, **When** the worker runs, **Then** it reads all of:
- `households` row for the household
- `children` rows (envelope-decrypted fields in clear-text)
- `memory_nodes` rows (all, including soft-forgotten)
- `plans` rows (last 12 weeks — `week_of >= NOW() - INTERVAL '84 days'`)
- `heart_notes` rows (envelope-decrypted `content` in clear-text)
- `lunch_link_sessions` rows
- `vpc_consents` rows
- `audit_log` rows where `event_type IN ('vpc.consented', 'parental_notice.acknowledged', 'account.created', 'account.updated', 'account.deleted')` — the consent subset only
- Billing summary: `{ tier: households.subscription_tier, status: households.subscription_status }` from the household row (no Stripe API call at MVP)

### AC3 — JSON is HMAC-signed for tamper-evidence

**Given** the snapshot is composed, **When** the export file is assembled, **Then** it has the envelope shape `{ data: <snapshot>, signature: "sha256=<hex>" }` where the signature is `HMAC-SHA256(JSON.stringify(data), JWT_SECRET)`.

### AC4 — Export uploaded to Supabase Storage, 30-day signed URL created

**Given** the signed envelope JSON is ready, **When** the job uploads, **Then**:
- Upload path: `exports/{household_id}/{ISO-date-YYYY-MM-DD}.json`
- Bucket: `data-exports` (private; no public access)
- Signed URL expiry: `2592000` seconds (30 days)
- If the upload throws, the job re-throws (BullMQ retries, attempts: 3). No partial file is accessible until the signed URL is created.

### AC5 — Email sent via SendGrid (best-effort)

**Given** the signed URL is created, **When** the job sends email, **Then**:
- Recipient: primary email from `supabase.auth.admin.getUserById(user_id)`
- Subject: `"Your HiveKitchen data export is ready"`
- Body: plain text including the signed URL and expiry date
- If `sendgrid.send()` throws: log `warn` and continue to the audit write (best-effort, does NOT halt the job)

### AC6 — `account.exported` audit row written (best-effort)

**Given** the signed URL is created, **When** the audit row is written, **Then**:
- `event_type: 'account.exported'`
- `household_id: household_id`
- `metadata: { export_path: string, signed_url_expires_at: string }`
- If the audit write throws: log `warn` (best-effort, does NOT halt the job)

### AC7 — Job throws on storage error (BullMQ retry path)

**Given** the Supabase Storage upload or `createSignedUrl` call returns an error, **When** the worker processes the error, **Then** the worker re-throws so BullMQ retries the job. No audit row is written, no email is sent.

### AC8 — Web: "Export my data" section in Account settings

**Given** an authenticated primary parent navigates to `/account`, **When** the page renders, **Then** a "Data portability" section is visible with a single "Export my data" button.

**Given** the button is clicked, **When** the `POST` returns `202`, **Then** the button is replaced with the copy: `"We're preparing your export. You'll receive an email with a download link within 72 hours."` No polling. No redirect.

**Given** the `POST` fails, **Then** a `role="alert"` error line is shown below the button; button returns to active state.

---

## Tasks / Subtasks

### Task 1 — Migration: audit event type + storage bucket (AC: #1, #4, #6) ✅

Create **`supabase/migrations/20260610000000_add_account_exported_and_data_exports_bucket.sql`**:

```sql
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
```

In **`apps/api/src/audit/audit.types.ts`**, add to the `// account` cluster (after `'account.deleted'`):
```typescript
'account.exported',   // Story 7-S10 — data portability export
```

**USER-SIDE GATE:** `supabase db push --include-all` before any live export attempt.

---

### Task 2 — Contracts: `DataExportResponseSchema` (AC: #1) ✅

Create **`packages/contracts/src/data-export.ts`**:

```typescript
import { z } from 'zod';

export const DataExportResponseSchema = z.object({
  status: z.literal('queued'),
  message: z.string(),
});
export type DataExportResponse = z.infer<typeof DataExportResponseSchema>;
```

**`packages/contracts/src/index.ts`** — add (near the other Epic-7-era exports):
```typescript
export * from './data-export.js';
```

**`packages/types/src/index.ts`** — add import + re-export (follow `ConsentHistoryResponse` pattern):
```typescript
import {
  // … existing imports …
  DataExportResponseSchema,
} from '@hivekitchen/contracts';

export type DataExportResponse = z.infer<typeof DataExportResponseSchema>;
```

**Contract test** — create **`packages/contracts/src/data-export.test.ts`**:
- Round-trip parse a valid `DataExportResponseSchema` payload
- Reject missing `status`
- Reject `status: 'pending'` (wrong literal)
- Reject missing `message`

---

### Task 3 — `DataExportRepository` (AC: #2) ✅

Create **`apps/api/src/modules/data-export/data-export.repository.ts`**:

This repository assembles the household snapshot. Each method is a thin Supabase query. The job injects `fastify.supabase` + `kek` (for decryption via existing repositories).

```typescript
import type { SupabaseClient } from '@supabase/supabase-js';
import { ChildrenRepository } from '../children/children.repository.js';
import { HeartNoteRepository } from '../heart-notes/heart-note.repository.js';

export class DataExportRepository {
  private readonly children: ChildrenRepository;
  private readonly heartNotes: HeartNoteRepository;

  constructor(
    private readonly client: SupabaseClient,
    kek: string | null,
  ) {
    this.children = new ChildrenRepository(client, kek);
    this.heartNotes = new HeartNoteRepository(client, kek);
  }

  async getHousehold(householdId: string) {
    const { data, error } = await this.client
      .from('households')
      .select('*')
      .eq('id', householdId)
      .single();
    if (error) throw error;
    return data;
  }

  async getChildren(householdId: string) {
    // ChildrenRepository handles envelope decryption of sensitive fields.
    // Use the existing `list(householdId)` method — check the method name
    // in apps/api/src/modules/children/children.repository.ts.
    return this.children.list(householdId);
  }

  async getMemoryNodes(householdId: string) {
    const { data, error } = await this.client
      .from('memory_nodes')
      .select('*')
      .eq('household_id', householdId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data ?? [];
  }

  async getRecentPlans(householdId: string) {
    // Last 12 weeks (84 days). ISO date string cutoff.
    const cutoff = new Date(Date.now() - 84 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    const { data, error } = await this.client
      .from('plans')
      .select('*')
      .eq('household_id', householdId)
      .gte('week_of', cutoff)
      .order('week_of', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async getHeartNotes(householdId: string) {
    // HeartNoteRepository handles envelope decryption of `content`.
    // Use the existing listing method — check the method name
    // in apps/api/src/modules/heart-notes/heart-note.repository.ts.
    // If no such method exists, query directly and decrypt inline.
    // DO NOT re-implement decryption logic — reuse the repository.
    return this.heartNotes.findAllForHousehold(householdId);
  }

  async getLunchLinkSessions(householdId: string) {
    const { data, error } = await this.client
      .from('lunch_link_sessions')
      .select('*')
      .eq('household_id', householdId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async getVpcConsents(householdId: string) {
    const { data, error } = await this.client
      .from('vpc_consents')
      .select('*')
      .eq('household_id', householdId)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }

  async getConsentAuditSubset(householdId: string) {
    const CONSENT_TYPES = [
      'vpc.consented',
      'parental_notice.acknowledged',
      'account.created',
      'account.updated',
      'account.deleted',
    ] as const;
    const { data, error } = await this.client
      .from('audit_log')
      .select('id, event_type, metadata, created_at')
      .eq('household_id', householdId)
      .in('event_type', CONSENT_TYPES)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data ?? [];
  }
}
```

> **CRITICAL:** Before implementing `getChildren`, read `apps/api/src/modules/children/children.repository.ts` and find the method that lists all children for a household. Use that. Similarly for `getHeartNotes` — find the list method in `heart-note.repository.ts`. If a matching list method doesn't exist, add it to the existing repository rather than reimplementing decryption logic.

> **`plans` table** — the canonical plan table (post-3-dm-c1). The `week_of` column is type `date` (string in PostgREST). No `plan_items` join needed — the plan row contains the full tree in `payload` JSONB.

---

### Task 4 — `DataExportJobPlugin` (AC: #2–#7) ✅

Create **`apps/api/src/jobs/data-export.job.ts`**:

**Key structural difference from `memory-forget.job.ts`:** This job has **no `upsertJobScheduler`** call — it is an on-demand job triggered by the POST route. The plugin registers ONLY the worker.

```typescript
import { createHmac, randomUUID } from 'node:crypto';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync } from 'fastify';
import type { Job } from 'bullmq';
import { DataExportRepository } from '../modules/data-export/data-export.repository.js';

export const DATA_EXPORT_QUEUE = 'data-export';

export interface DataExportJobData {
  household_id: string;
  user_id: string;
  request_id: string;
}

const dataExportPlugin: FastifyPluginAsync = async (fastify) => {
  const kek = fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY ?? null;

  fastify.bullmq.getWorker(DATA_EXPORT_QUEUE, async (job: Job<DataExportJobData>) => {
    const { household_id, user_id, request_id } = job.data;
    const repo = new DataExportRepository(fastify.supabase, kek);

    // ── 1. Compose snapshot ──────────────────────────────────────────────────
    const [
      household,
      children,
      memoryNodes,
      plans,
      heartNotes,
      lunchLinkSessions,
      vpcConsents,
      consentAuditSubset,
    ] = await Promise.all([
      repo.getHousehold(household_id),
      repo.getChildren(household_id),
      repo.getMemoryNodes(household_id),
      repo.getRecentPlans(household_id),
      repo.getHeartNotes(household_id),
      repo.getLunchLinkSessions(household_id),
      repo.getVpcConsents(household_id),
      repo.getConsentAuditSubset(household_id),
    ]);

    const billingSummary = {
      tier: (household as Record<string, unknown>)['subscription_tier'] ?? null,
      status: (household as Record<string, unknown>)['subscription_status'] ?? null,
    };

    const snapshot = {
      exported_at: new Date().toISOString(),
      household,
      billing_summary: billingSummary,
      children,
      memory_nodes: memoryNodes,
      plans,
      heart_notes: heartNotes,
      lunch_link_sessions: lunchLinkSessions,
      vpc_consents: vpcConsents,
      consent_audit_subset: consentAuditSubset,
    };

    // ── 2. HMAC-sign ─────────────────────────────────────────────────────────
    const dataJson = JSON.stringify(snapshot);
    const signature =
      'sha256=' +
      createHmac('sha256', fastify.env.JWT_SECRET).update(dataJson).digest('hex');
    const exportPayload = { data: snapshot, signature };
    const exportJson = JSON.stringify(exportPayload, null, 2);

    // ── 3. Upload to Supabase Storage (throws → BullMQ retry) ───────────────
    const isoDate = new Date().toISOString().slice(0, 10);
    const exportPath = `exports/${household_id}/${isoDate}.json`;

    const { error: uploadError } = await fastify.supabase.storage
      .from('data-exports')
      .upload(exportPath, Buffer.from(exportJson), {
        contentType: 'application/json',
        upsert: true,
      });
    if (uploadError) throw uploadError;

    // ── 4. Create 30-day signed URL (throws → BullMQ retry) ─────────────────
    const THIRTY_DAYS_S = 2592000;
    const { data: signedUrlData, error: urlError } = await fastify.supabase.storage
      .from('data-exports')
      .createSignedUrl(exportPath, THIRTY_DAYS_S);
    if (urlError) throw urlError;
    const signedUrl = signedUrlData.signedUrl;
    const expiresAt = new Date(Date.now() + THIRTY_DAYS_S * 1000).toISOString();

    // ── 5. Get user email (for SendGrid) ─────────────────────────────────────
    const {
      data: { user },
      error: userError,
    } = await fastify.supabase.auth.admin.getUserById(user_id);
    if (userError) throw userError;
    const userEmail = user?.email;

    // ── 6. Send email (best-effort) ──────────────────────────────────────────
    if (userEmail) {
      try {
        await fastify.sendgrid.send({
          to: userEmail,
          from: 'no-reply@hivekitchen.app',
          subject: 'Your HiveKitchen data export is ready',
          text: [
            'Your HiveKitchen data export is ready.',
            '',
            `Download it here: ${signedUrl}`,
            '',
            `This link expires on ${new Date(expiresAt).toLocaleDateString('en-US', {
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}.`,
            '',
            'The export includes all data HiveKitchen holds for your household, with encrypted fields decrypted to plain text.',
          ].join('\n'),
        });
      } catch (emailErr) {
        fastify.log.warn(
          { err: emailErr, module: 'data-export', action: 'email.failed', household_id },
          'data-export: email delivery failed — export uploaded, continuing to audit',
        );
      }
    } else {
      fastify.log.warn(
        { module: 'data-export', action: 'email.no_address', user_id },
        'data-export: no email on user record — skipping email',
      );
    }

    // ── 7. Audit row (best-effort) ───────────────────────────────────────────
    try {
      await fastify.auditService.write({
        event_type: 'account.exported',
        household_id,
        user_id,
        request_id,
        metadata: { export_path: exportPath, signed_url_expires_at: expiresAt },
      });
    } catch (auditErr) {
      fastify.log.warn(
        { err: auditErr, module: 'data-export', action: 'audit.failed', household_id },
        'data-export: audit write failed — export delivered, continuing',
      );
    }

    fastify.log.info(
      { module: 'data-export', action: 'export.complete', household_id, export_path: exportPath },
      'data-export: export composed, uploaded, and emailed',
    );
  });
};

export const dataExportJobPlugin = fp(dataExportPlugin, {
  name: 'data-export-job',
});
```

> **`supabase.auth.admin.getUserById`** — uses the service-role key. Already set up in the Supabase plugin (`SUPABASE_SERVICE_ROLE_KEY`). The call signature is `(userId: string): Promise<{ data: { user: User | null }, error: AuthError | null }>`. Check the existing auth.service.ts or auth.repository.ts for existing usage if needed.

> **`ENVELOPE_ENCRYPTION_MASTER_KEY`** — optional env var (`string | undefined`). The `?? null` coercion is correct. If null, the decryption repositories use NOOP passthrough (no error; fields are returned as-is, which in dev is plain text anyway).

> **`from: 'no-reply@hivekitchen.app'`** — CHECK the existing sendgrid call sites in the codebase (heart-note delivery or auth invite emails) for the actual sender address. If a different address is already in use, match it. Do NOT introduce a new sender address without checking.

> **`parallel reads`** — `Promise.all` is safe here; all reads are independent and scoped to the same household. No cross-read dependencies.

---

### Task 5 — Route: `POST /v1/households/:householdId/export` (AC: #1) ✅

In **`apps/api/src/modules/households/households.routes.ts`**:

**Add imports** (at the top of the plugin function, after existing imports — keep alphabetical within the block):
```typescript
import { randomUUID } from 'node:crypto';
import { DataExportResponseSchema } from '@hivekitchen/contracts';
import {
  DATA_EXPORT_QUEUE,
  type DataExportJobData,
} from '../../jobs/data-export.job.js';
```

> `randomUUID` may already be imported. Check before adding.

**Add route** (after the `GET /v1/households/:householdId/consent-history` route — the last 7-S9 route):

```typescript
// Story 7-S10 — POST /v1/households/:householdId/export
// Data portability: queues a BullMQ job to compose a full JSON snapshot and
// email a signed 30-day Supabase Storage URL. Primary Parent only (AADC
// right-to-portability; secondary_caregiver cannot initiate an export).
// Returns 202 immediately — export runs asynchronously in the background.
fastify.post(
  '/v1/households/:householdId/export',
  {
    preHandler: authorize(['primary_parent']),
    schema: {
      params: z.object({ householdId: z.string().uuid() }),
      response: { 202: DataExportResponseSchema },
    },
  },
  async (request, reply) => {
    const { householdId } = request.params as { householdId: string };
    if (householdId !== request.user.household_id) {
      throw new ForbiddenError('Cannot export another household');
    }
    const exportQueue = fastify.bullmq.getQueue(DATA_EXPORT_QUEUE);
    await exportQueue.add(
      'compose-export',
      {
        household_id: householdId,
        user_id: request.user.id,
        request_id: randomUUID(),
      } satisfies DataExportJobData,
      {
        attempts: 3,
        backoff: { type: 'exponential' as const, delay: 60_000 },
        removeOnComplete: { count: 10 },
        removeOnFail: { count: 10 },
      },
    );
    reply.status(202);
    return {
      status: 'queued' as const,
      message:
        "We're preparing your export. You'll receive an email with a download link within 72 hours.",
    };
  },
);
```

> **`authorize` is already imported** at line 30 of `households.routes.ts` as `import { authorize } from '../../middleware/authorize.hook.js'`. Use it inline as `preHandler: authorize(['primary_parent'])` — NOT a named binding. This matches the pattern at lines 279, 353, 387, 447 in the existing file.

> **`ForbiddenError`** — check the existing import/usage for this error class in `households.routes.ts`. The consent-history and memory routes throw it for cross-household access. It is the same error class used throughout; do NOT introduce a new one.

> **`reply.status(202)`** — must be called BEFORE returning the body, otherwise Fastify sends 200. The `satisfies DataExportJobData` constraint catches a missing field at compile time without widening the type.

---

### Task 6 — Register in `app.ts` (AC: #1) ✅

In **`apps/api/src/app.ts`**, add to the job imports block (after `memoryForgetJobPlugin`):
```typescript
import { dataExportJobPlugin } from './jobs/data-export.job.js';
```

Register (after `await app.register(memoryForgetJobPlugin)`):
```typescript
await app.register(dataExportJobPlugin);
```

---

### Task 7 — Web: Account page "Export my data" section (AC: #8) ✅

Modify **`apps/web/src/routes/(app)/account.tsx`** (the existing Account settings page, registered at `/account` in `app.tsx`).

**Add to the component's state** (near the top of the component function):
```typescript
const [exportState, setExportState] = useState<'idle' | 'pending' | 'success' | 'error'>('idle');
```

**Add handler** (near other handlers in the component):
```typescript
async function handleExport() {
  setExportState('pending');
  try {
    await hkFetch<unknown>(`/v1/households/${householdId}/export`, { method: 'POST' });
    setExportState('success');
  } catch (err) {
    if (err instanceof HkApiError && err.status === 401) {
      navigate('/auth/login?next=/account', { replace: true });
      return;
    }
    setExportState('error');
  }
}
```

**Add section** (place BEFORE any destructive "Delete account" section — data portability is benign, deletion is destructive):

```tsx
<section className="mt-12">
  <h2 className="font-serif text-xl text-fg">Data portability</h2>
  <p className="mt-2 font-sans text-sm text-fg-muted leading-relaxed">
    Download a copy of everything HiveKitchen has stored for your household.
    Encrypted fields are decrypted to plain text in the export.
  </p>
  {exportState === 'success' ? (
    <p className="mt-4 font-sans text-sm text-fg-muted">
      We're preparing your export. You'll receive an email with a download link within 72 hours.
    </p>
  ) : (
    <div className="mt-4">
      <button
        type="button"
        onClick={() => { void handleExport(); }}
        disabled={exportState === 'pending'}
        className="rounded-lg border border-border bg-surface px-4 py-2 font-sans text-sm text-fg hover:bg-surface/80 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {exportState === 'pending' ? 'Exporting…' : 'Export my data'}
      </button>
      {exportState === 'error' && (
        <p role="alert" className="mt-2 font-sans text-sm text-fg-muted">
          Something went wrong. Please try again.
        </p>
      )}
    </div>
  )}
</section>
```

> **Import check:** `hkFetch`, `HkApiError` — verify they are already imported in `account.tsx`. They should be, given 4-S17 already added a download section to this page. Also verify `useState` is in the React import. If `householdId` is not already derived from `useAuthStore` in this component, add `const householdId = useAuthStore((s) => s.user?.current_household_id ?? null)`.

> **Design system consistency:** The button uses `border border-border` + `bg-surface` — raw bordered style matching the existing 4-S17 download buttons on this page. Do NOT use `SecondaryButton` (it requires an icon prop) or `PrimaryButton` (this is not the primary CTA on the page).

---

### Task 8 — Tests (AC: #1–#8) ✅

#### 8a — Contract test: `packages/contracts/src/data-export.test.ts`

4 cases:
- Valid round-trip parse
- Reject missing `status`
- Reject wrong status literal (`'pending'`)
- Reject missing `message`

#### 8b — Route tests: `apps/api/src/modules/households/households.routes.test.ts`

Add `describe('POST /v1/households/:householdId/export (7-S10)')`:

Mock `fastify.bullmq.getQueue` to return `{ add: vi.fn().mockResolvedValue({}) }`. Assert `queue.add` is called with the correct queue name and job data shape.

Required cases:
- `202` happy path — job enqueued, body matches `DataExportResponseSchema`, `status === 'queued'`
- `403` cross-household (`householdId !== request.user.household_id`)
- `401` unauthenticated
- `400` non-UUID `:householdId`
- `403` `secondary_caregiver` role (not `primary_parent`)

> **Fixture note:** `bullmq` mock may not exist in the route test file. If absent, add it as a mock decorator on the Fastify instance for the test app. Pattern: check how `bullmq` is used in other route test files (e.g., plan routes) — if they don't mock it, you may need to create a minimal mock in the test app builder.

#### 8c — Job unit tests: `apps/api/src/jobs/data-export.job.test.ts`

Extract the worker body into a testable `runDataExport(deps)` function (same pattern as `runMemoryForgetSweep` from 7-S5) — OR test by directly calling the worker callback with mocked `DataExportRepository` and `fastify` deps.

Required cases:
- HMAC signature format: starts with `'sha256='`, is 71 chars (`'sha256=' + 64 hex chars`)
- Upload path matches pattern `exports/{uuid}/{YYYY-MM-DD}.json`
- `createSignedUrl` called with `2592000` seconds
- `sendgrid.send` called once with correct subject
- Email failure logs `warn` and continues (audit still writes)
- Audit failure logs `warn` and continues (no re-throw)
- Storage upload error re-throws (BullMQ retry path — no email, no audit)
- `Promise.all` composes 8 data sources (assert all 8 repo methods called)

#### 8d — Web tests: new `apps/web/src/routes/(app)/account-export.test.tsx` (or add to existing `account.test.tsx`)

Mock `hkFetch` and `useAuthStore`.

Required cases:
- Idle: "Export my data" button renders, enabled
- Pending: after click, button is disabled + shows "Exporting…"
- Success: confirmation copy renders, button absent
- Error: `role="alert"` error line renders after `hkFetch` throws

---

## Dev Notes

### Zod 4 note (critical)
The project runs **Zod 4**, NOT Zod 3.23 as `project-context.md` claims. `z.record` requires two arguments under Zod 4:
```typescript
z.record(z.string(), z.unknown())  // ✅ Zod 4
z.record(z.unknown())               // ❌ throws under Zod 4
```
Use `z.record(z.string(), z.unknown())` wherever record types are needed. This matches existing contracts (`memory.ts`, `thread.ts`).

### BullMQ: on-demand vs cron

This job uses a **worker-only** pattern — no `upsertJobScheduler`. The route calls `queue.add()` and the worker consumes it. Compare:

| Pattern | When | How |
|---|---|---|
| `memory-forget.job.ts` | Nightly cron | `upsertJobScheduler` + `getWorker` |
| `data-export.job.ts` (this) | On-demand (POST) | `getWorker` only; route calls `queue.add()` |
| `plan-regeneration.job.ts` | On-demand (plan regen) | Same pattern — worker registers; route calls `add()` |

Use `plan-regeneration.job.ts` as the structural reference for this job, not `memory-forget.job.ts`.

### On the `DATA_EXPORT_QUEUE` import

Export `DATA_EXPORT_QUEUE` from `data-export.job.ts` and import it in `households.routes.ts`. This is the same pattern as `REGEN_QUEUE` exported from `plan-regeneration.job.ts` and imported in plan routes. Keeps the queue name as a single source of truth.

### Supabase Storage `.upload()` with `upsert: true`

If the parent re-requests an export on the same day, the path `exports/{id}/{date}.json` will be the same. Using `upsert: true` silently replaces — this is intentional. No dedup logic needed at MVP.

### Supabase Storage `.createSignedUrl()` — service role required

`createSignedUrl` requires the service-role key to generate. The `fastify.supabase` client is already initialized with the service-role key in `supabase.plugin.ts`. No additional auth needed.

### Envelope decryption — use existing repositories

**DO NOT** re-implement envelope decryption. Both `ChildrenRepository` and `HeartNoteRepository` already handle KEK-based field decryption. Pass the same `kek = fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY ?? null` that `households.routes.ts` already uses when constructing these repos (line 55–56 in the existing routes file).

### `account.exported` in `AUDIT_EVENT_TYPES`

`AuditWriteInput.event_type` is typed to `AuditEventType` — a union of `AUDIT_EVENT_TYPES`. The migration adds `account.exported` to the Postgres enum; the TypeScript update adds it to the `AUDIT_EVENT_TYPES` tuple. Both sides must be updated together or `auditService.write()` will fail TypeScript. The enum-parity audit test (`audit.types.test.ts`) may fail if it compares the TypeScript array to the live DB enum — verify parity after adding the value.

### `sendgrid.send()` from address

CHECK the actual sender address used in the project. Search for `fastify.sendgrid.send` or `sendgrid.send` in `apps/api/src` — there may be an invite email or auth email that already uses a from address. Match it. `no-reply@hivekitchen.app` is a placeholder in this story.

### `requirePrimaryParent` vs inline `authorize()`

`households.routes.ts` does NOT have a named `requirePrimaryParent` binding. Instead, it uses inline `preHandler: authorize(['primary_parent'])` at lines 279, 353, 387, 447. This is the pattern to follow — NO new named binding needed.

### `reply.status(202)` with Fastify response schema

Fastify 5 validates the response body against the schema keyed by status code. Since the schema is registered at key `202`, and `reply.status(202)` is called before returning, the response will validate correctly. Do NOT set the schema at `200` if the route returns `202` — the keys must match.

### Plans table structure (post-3-dm-c1)

The canonical plan shape post-3-dm-c1 stores the full plan tree in `payload` JSONB on the `plans` table. There is no `plan_items` join needed. The `week_of` column is type `date` (string `YYYY-MM-DD` in PostgREST). The query uses `.gte('week_of', cutoff)` where `cutoff` is a `YYYY-MM-DD` string — this matches the expected date comparison semantics.

### HeartNoteRepository method for full list

The export needs all heart notes for the household. Check `apps/api/src/modules/heart-notes/heart-note.repository.ts` for an existing `findAll(householdId)` or `list(householdId)` style method. If it only has `findByChildAndDate` or similar point-lookup methods, add a `findAllForHousehold(householdId)` method to the existing repository. Do NOT inline a raw query that bypasses decryption.

### Test baseline (do not introduce NEW failures)

- **Web tests before this slice:** 459/459 (post-7-S9 baseline)
- **API tests before this slice:** ~1520-pass / 20-fail / 13-skip
- **Contracts:** consent-history 4/4 + parental-dashboard 4/4 — must hold; new `data-export.test.ts` adds
- **TypeScript:** API 11 pre-existing errors (≤14 allowed), web 3, contracts 1, types 1 — zero new errors in changed files

---

## Dev Agent Record

### Completion Notes

Implemented all 8 ACs across 8 tasks (2026-06-05). Async-only data-portability export: `POST /v1/households/:householdId/export` (primary_parent only) enqueues a BullMQ `data-export` job and returns `202` immediately; the on-demand worker composes the full household JSON snapshot, HMAC-signs it (`JWT_SECRET`), uploads to the new private `data-exports` Supabase Storage bucket, mints a 30-day signed URL, emails it via `fastify.sendgrid` (best-effort), and writes an `account.exported` audit row (best-effort).

**Spec reconciliations (story snippets vs. live codebase):**

1. **`kek` is a `Buffer`, not a string.** The story job/repo snippets passed `fastify.env.ENVELOPE_ENCRYPTION_MASTER_KEY ?? null` (a string) into the repositories. The canonical pattern (`households.routes.ts:53-54`) decodes hex: `const kek = kekHex ? Buffer.from(kekHex, 'hex') : null`. `ChildrenRepository`/`HeartNoteRepository`/`ChildAllergensRepository` all type `kek: Buffer | null`. The job + `DataExportRepository` were corrected to derive and pass a `Buffer`.

2. **`ChildrenRepository` constructor needs 4 args, not 2.** The story snippet did `new ChildrenRepository(client, kek)`. The real signature is `(client, kek, logger, childAllergensRepo)` (per `households.routes.ts:70-75`). `DataExportRepository` now constructs a `ChildAllergensRepository` and threads a `FastifyBaseLogger` through. Its list method is `findByHouseholdId(householdId)` — there is no `list()`.

3. **`HeartNoteRepository` had no full-list method.** It only had `listByHousehold` (the UI "All Notes" list, capped at `.limit(50)`) — wrong for a complete export. Added a dedicated `findAllForHousehold(householdId)` (no cap, `created_at` DESC, reuses the household-DEK decrypt path) per the story's Task-3/Dev-Notes sanction ("add a `findAllForHousehold` method … DO NOT re-implement decryption").

4. **`children.repository.ts` NOT modified.** The "possibly modified" entry was unneeded — `findByHouseholdId` already exists.

5. **No existing `sendgrid.send()` call site.** Searched `apps/api/src` — `heart-note-delivery.job.ts` only flips status (sacred channel; never emails) and no other sender exists. Used the story's placeholder `no-reply@hivekitchen.app` (documented as a constant in the job for easy replacement once a verified sender is established).

6. **Testability: extracted `runDataExport(deps, data)`** from the worker callback (same pattern as 7-S5's `runMemoryForgetSweep`) so the job unit-tests without standing up BullMQ.

7. **Web `account-export.test.tsx` is a new file** (story 8d sanctioned "new … or add to existing"); chose new to keep it isolated from the 4-S17 `account.test.tsx` suite. The export section is gated to `primary_parent` only (privileged action) and matches the page's raw-bordered button idiom + `text-safety-red` error style (4-S17 precedent), not the story snippet's `bg-surface`/`text-fg` variant.

8. **`account.exported` enum parity is balanced** — added to BOTH `AUDIT_EVENT_TYPES` (TS) and migration `20260610000000`, so the pre-existing audit-parity drift is unchanged (does not appear in the test's TS-only `+` list; mirrors 7-S5's `memory.hard_forgotten` handling).

**Verification:**
- Contracts `data-export.test.ts` 4/4.
- Full API suite: **1567 pass / 20 fail / 13 skip** — the 20 failures are exactly the documented pre-existing baseline (auth ×7, children ×3, extra-library ×3, lunch-link, onboarding.tools, audit-parity-drift, catalog-seed, plan-adjustment, memory-partial-seeding, households memory-200-case). The `households` memory-200-case was confirmed pre-existing by `git stash` of all my tracked changes (still fails on the clean tree). My 13 new API tests (job ×8, export route ×5) all pass.
- Full web suite: **463/463** (459 baseline + 4 new `account-export` tests; 0 failures).
- Typecheck: **0 new errors** — contracts 1, types 1, api 11 (≤14), web 3 — all documented baselines; nothing in any 7-S10 file (the api `households.routes.test.ts:448` error is the pre-existing `buildBriefApp` helper).
- Lint: all new/changed files clean. Remaining errors are the pre-existing `_cols`/`_col`/`_val` mock-helper params in `households.routes.test.ts` (lines 694–1114, slices 2-s27/3.29) + the pre-existing `account.tsx:104` exhaustive-deps warning — none introduced by this slice.

**USER-SIDE GATE:** `supabase db push --include-all` (migration `20260610000000`) before any live export — registers the `account.exported` enum value and the `data-exports` storage bucket. Live email + signed-URL delivery is a manual demo (live stack + Supabase + SendGrid).

### Debug Log

No blocking issues. The pnpm `ERR_..."vitest" not found` / `Command failed` lines after test runs are pnpm's Windows non-zero-exit wrapper noise — the suites executed and reported normally.

---

## File List

**New files:**
- `supabase/migrations/20260610000000_add_account_exported_and_data_exports_bucket.sql`
- `packages/contracts/src/data-export.ts`
- `packages/contracts/src/data-export.test.ts`
- `apps/api/src/modules/data-export/data-export.repository.ts`
- `apps/api/src/jobs/data-export.job.ts`
- `apps/api/src/jobs/data-export.job.test.ts`

**Modified files:**
- `apps/api/src/audit/audit.types.ts` — add `'account.exported'` to `AUDIT_EVENT_TYPES`
- `packages/contracts/src/index.ts` — add `export * from './data-export.js'`
- `packages/types/src/index.ts` — add `DataExportResponse` type re-export
- `apps/api/src/modules/households/households.routes.ts` — add `DataExportResponseSchema` + `DATA_EXPORT_QUEUE` imports, add `POST /v1/households/:householdId/export` route
- `apps/api/src/modules/households/households.routes.test.ts` — add export route test block
- `apps/api/src/app.ts` — import + register `dataExportJobPlugin`
- `apps/web/src/routes/(app)/account.tsx` — add `householdId` selector + export state + handler + primary-parent "Data portability" section
- `apps/api/src/modules/heart-notes/heart-note.repository.ts` — added `findAllForHousehold(householdId)` (uncapped full list for the export; `listByHousehold` is capped at 50)

**New files (added during impl, beyond the original plan):**
- `apps/web/src/routes/(app)/account-export.test.tsx` — web tests for the Data portability section (idle / pending / success / error)

**Not modified (plan's "possibly modified" — turned out unnecessary):**
- `apps/api/src/modules/children/children.repository.ts` — `findByHouseholdId(householdId)` already exists; no `list()` added

---

## References

- [`_bmad-output/planning-artifacts/epic-7-vertical-slices.md#Slice 7-S10`] — demo path, layers, PRD codes FR71 / NFR-PRIV-6 / AR-22
- [`_bmad-output/planning-artifacts/epics.md` §Story 7.7] — original AC: background job, JSON snapshot, decrypted fields, signed tamper-evidence, signed URL 30d, `account.exported` audit row
- [`apps/api/src/jobs/plan-regeneration.job.ts`] — canonical on-demand BullMQ job pattern (no cron scheduler — worker only; route calls `queue.add()`). Copy structural pattern.
- [`apps/api/src/jobs/heart-note-delivery.job.ts`] — `fp()` export wrapper + scheduler cron pattern (for contrast: this is the cron job, 7-S10 is on-demand)
- [`apps/api/src/jobs/memory-forget.job.ts`] — `fastify.auditService.write` + best-effort audit pattern (mirror exactly for audit write in 7-S10)
- [`apps/api/src/plugins/sendgrid.plugin.ts`] — `fastify.sendgrid` decoration (`MailService` from `@sendgrid/mail`)
- [`apps/api/src/types/fastify.d.ts`] — `fastify.bullmq.getQueue()`, `fastify.sendgrid`, `fastify.auditService` declarations
- [`apps/api/src/audit/audit.types.ts`] — `AUDIT_EVENT_TYPES` + `AuditWriteInput` — add `'account.exported'` to the `// account` cluster
- [`apps/api/src/modules/households/households.routes.ts:30,184,279`] — `authorize` import, `requireParentOrCaregiver` binding (for contrast — use inline `authorize(['primary_parent'])` for this route), existing route patterns
- [`_bmad-output/implementation-artifacts/7-s9-consent-history-view.md`] — previous story: consent audit subset pattern (`getConsentAuditSubset`) mirrors `findConsentEventsByHousehold` exactly
- [`_bmad-output/implementation-artifacts/7-s5-soft-hard-promotion-job.md`] — BullMQ job plugin pattern, `fastify.auditService.write` best-effort, `fp()` wrapper name
- [`_bmad-output/project-context.md`] — thin-handler rule, Tailwind-only UI, `===`/`!==` only, no non-null assertions across Zod boundary

---

### Review Findings

- [x] [Review][Patch] `getUserById` error re-throws — violates AC5/AC7 best-effort boundary [`apps/api/src/jobs/data-export.job.ts:119-121`]
- [x] [Review][Patch] `guest_author` 403 test absent — AC1 explicitly names guest_author as a 403 path [`apps/api/src/modules/households/households.routes.test.ts`]
- [x] [Review][Patch] `consentAuditSubset` omits `user_id` + `household_id` columns — AC2 portability intent, no column exclusion specified [`apps/api/src/modules/data-export/data-export.repository.ts:105`]
- [x] [Review][Defer] Unbounded export payload — no size guard before JSON.stringify + upload [`apps/api/src/jobs/data-export.job.ts`] — deferred, pre-existing beta-scale design constraint; no spec requirement
- [x] [Review][Defer] Email re-sent on BullMQ retry — on storage-success/email-failure retry, a duplicate email may be sent [`apps/api/src/jobs/data-export.job.ts`] — deferred, known limitation of on-demand job pattern; no dedup spec requirement
- [x] [Review][Defer] DEK-null in `findAllForHousehold` if household DEK row deleted — same exposure as existing `listByHousehold`; not introduced by this story [`apps/api/src/modules/heart-notes/heart-note.repository.ts`] — deferred, pre-existing
- [x] [Review][Defer] HMAC verification complexity — signed bytes differ from stored `{data, signature}` envelope; verifier must re-serialize `.data` canonically [`apps/api/src/jobs/data-export.job.ts`] — deferred, latent; no verification procedure defined in spec
- [x] [Review][Defer] Dead `(household ?? {})` null-coalesce — `getHousehold` uses `.single()` which throws on no-row; fallback is unreachable [`apps/api/src/jobs/data-export.job.ts:69`] — deferred, harmless dead code

---

## Change Log

| Date       | Change                                                                                    |
| ---------- | ----------------------------------------------------------------------------------------- |
| 2026-06-05 | Story file authored for 7-S10 JSON Data Export. Status → ready-for-dev.                  |
| 2026-06-05 | Implemented all 8 ACs / 8 tasks. 8 spec reconciliations (kek Buffer, ChildrenRepo 4-arg ctor + findByHouseholdId, new HeartNote.findAllForHousehold, no children.repo change, placeholder sender, extracted runDataExport, new web test file, balanced account.exported enum). API 1567✓/20✗(baseline)/13skip + web 463/463 + contracts 4/4; 0 new typecheck/lint. Status → review. |
