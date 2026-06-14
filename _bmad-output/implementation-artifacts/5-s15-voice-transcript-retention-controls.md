# 5-S15 — Voice transcript retention controls

> **Folds:** story 5.16, PRD FR75
> **Status:** done
> **Epic:** 5 — Household Coordination & Ambient Intelligence

---

## Story

**As a parent** who has used voice turns, I want to see my voice transcripts in Account settings
and choose whether to keep them or delete them immediately, so that I feel in control of
what Lumi remembers from my voice.

---

## Acceptance Criteria

| # | Criterion |
|---|-----------|
| AC1 | `GET /v1/users/me/voice-transcripts` returns `{ transcripts: VoiceTranscriptItem[], voice_retention_mode: 'standard' \| 'immediate_delete' }` for the authenticated user. |
| AC2 | Each item has `{ id: uuid, transcript: string, retention_until: ISO8601, created_at: ISO8601 }`. |
| AC3 | Transcripts are returned newest-first, capped at 20 items. |
| AC4 | `PATCH /v1/users/me/voice-retention` with `{ voice_retention_mode: 'standard' \| 'immediate_delete' }` returns the updated `UserProfile` (which includes the `voice_retention_mode` field). |
| AC5 | When mode switches to `'immediate_delete'`, all existing `voice_transcripts` rows for the user are deleted synchronously before the 200 response is returned. |
| AC6 | When mode is `'immediate_delete'` and a new voice turn is submitted, no transcript row is inserted. |
| AC7 | `GET /v1/users/me/voice-transcripts` returns `transcripts: []` when mode is `'immediate_delete'` (none persisted per AC6, any prior ones deleted per AC5). |
| AC8 | A nightly BullMQ job (cron `0 4 * * *` UTC) deletes all `voice_transcripts` rows where `retention_until < NOW()`. The job re-throws on delete failure so BullMQ retries (attempts: 3). |
| AC9 | The Account page renders a "Voice Data" section with the current mode toggle and a transcript list (standard mode) or empty state (immediate_delete mode). |
| AC10 | Toggling to "Immediate-delete" in the UI optimistically clears the transcript list, then calls `PATCH`; on API failure the toggle reverts and the transcript list is restored. |
| AC11 | `UserProfileSchema.voice_retention_mode` is present; `GET /v1/users/me` returns it alongside the existing profile fields. |
| AC12 | Unit tests cover: schema round-trips for both modes; GET 200 transcripts; PATCH 200 update; PATCH immediate_delete empties transcripts; nightly job deletes expired rows; web section renders; optimistic revert on API failure. |

---

## Scope Notes

### What this slice ships

- **Migration** `20261023000000`: `users.voice_retention_mode TEXT NOT NULL DEFAULT 'standard' CHECK (...)` + `voice_transcripts.user_id uuid` column
- **Contracts**: `VoiceRetentionModeSchema`, `UpdateVoiceRetentionRequestSchema`, `VoiceTranscriptItemSchema`, `VoiceTranscriptsResponseSchema` in new `voice-retention.ts`; `UserProfileSchema.voice_retention_mode` added to `users.ts`
- **Repository**: `VoiceTranscriptRepository.findByUserId`, `deleteByUserId`, `deleteExpired`; `insertTranscript` gains optional `userId` param
- **UserRepository**: `voice_retention_mode` added to `UserProfileRow`, `UpdateUserProfileInput`, `PROFILE_COLUMNS`
- **UserService**: `updateVoiceRetention` method + `toUserProfile` mapper extended
- **User routes**: `GET /v1/users/me/voice-transcripts` + `PATCH /v1/users/me/voice-retention`
- **LumiService**: `LumiVoiceWsState` gains `userId` + `voiceRetentionMode`; `submitTextTurn` skips insert and passes `userId` when voice
- **Lumi routes**: WS setup reads user row for `voice_retention_mode` once per connection
- **Nightly purge job**: `apps/api/src/jobs/voice-transcript-purge.job.ts` (mirrors memory-forget pattern)
- **Web**: Account → Voice Data section

### What is explicitly deferred

- **Per-turn mode refresh**: if the user changes mode mid-voice-session, the WS state is stale until reconnect — acceptable for MVP; documented as D-5S15-1
- **Pagination** of transcript list: capped at 20 items; full pagination deferred — D-5S15-2
- **Audit log**: mode change audit (`account.updated` events already cover profile changes; a dedicated voice_retention audit event is not added here)
- **Server-side TTS skip on immediate_delete** (transcripts not written ≠ "never heard"); D-5S13-1 from 5-S13 review

---

## Implementation Tasks

### Task 1 — Migration (`supabase/migrations/20261023000000_add_voice_retention_mode.sql`)

```sql
-- 5-S15: Voice retention controls
-- Add per-user retention mode to users table.
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS voice_retention_mode TEXT NOT NULL DEFAULT 'standard'
    CHECK (voice_retention_mode IN ('standard', 'immediate_delete'));

-- Add user_id to voice_transcripts for per-user scoping (insert + delete by user).
-- Nullable to avoid breaking existing rows (5-S5 inserts had no user_id).
-- ON DELETE CASCADE: if a user is hard-deleted (7-S11), their transcripts go too.
ALTER TABLE voice_transcripts
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE;

-- Index backs per-user queries (AC1, AC5).
CREATE INDEX IF NOT EXISTS idx_voice_transcripts_user_id ON voice_transcripts(user_id);
```

Migration timestamp `20261023000000` sorts after `20261022000000` (5-S14). No new audit enum needed — mode changes are covered by the existing `account.updated` event type.

**USER-SIDE GATE:** `supabase db push --include-all` before any live testing.

---

### Task 2 — Contracts (`packages/contracts/src/voice-retention.ts`) [NEW FILE]

```ts
import { z } from 'zod';

export const VoiceRetentionModeSchema = z.enum(['standard', 'immediate_delete']);

// PATCH /v1/users/me/voice-retention request body.
export const UpdateVoiceRetentionRequestSchema = z.object({
  voice_retention_mode: VoiceRetentionModeSchema,
});

// One item in the GET /v1/users/me/voice-transcripts list.
export const VoiceTranscriptItemSchema = z.object({
  id: z.string().uuid(),
  transcript: z.string(),
  retention_until: z.string().datetime({ offset: true }),
  created_at: z.string().datetime({ offset: true }),
});

// GET /v1/users/me/voice-transcripts response.
export const VoiceTranscriptsResponseSchema = z.object({
  transcripts: z.array(VoiceTranscriptItemSchema),
  voice_retention_mode: VoiceRetentionModeSchema,
});

export type VoiceRetentionMode = z.infer<typeof VoiceRetentionModeSchema>;
export type UpdateVoiceRetentionRequest = z.infer<typeof UpdateVoiceRetentionRequestSchema>;
export type VoiceTranscriptItem = z.infer<typeof VoiceTranscriptItemSchema>;
export type VoiceTranscriptsResponse = z.infer<typeof VoiceTranscriptsResponseSchema>;
```

Register in `packages/contracts/src/index.ts`:
```ts
export * from './voice-retention.js';
```

Register types in `packages/types/src/index.ts`:
```ts
export type {
  VoiceRetentionMode,
  UpdateVoiceRetentionRequest,
  VoiceTranscriptItem,
  VoiceTranscriptsResponse,
} from '@hivekitchen/contracts';
```

#### Extend `UserProfileSchema` in `packages/contracts/src/users.ts`

Add ONE field to the existing schema object (after `caption_only_mode`):
```ts
// Slice 5-S15 — voice transcript retention preference. Controls whether
// transcripts are kept (standard → 90-day expiry) or immediately deleted.
// Mirrors users.voice_retention_mode (DB default 'standard').
voice_retention_mode: VoiceRetentionModeSchema,
```

Import `VoiceRetentionModeSchema` from `'./voice-retention.js'` at the top of `users.ts`.

> **Re-export order**: `users.ts` must import from `./voice-retention.js` (NOT from the contracts index) to avoid a circular import. Both are top-level `contracts/src/` files so relative import is fine.

**Verify:** `pnpm --filter @hivekitchen/contracts build` passes with 0 errors.

---

### Task 3 — VoiceTranscriptRepository (`apps/api/src/modules/voice/voice-transcript.repository.ts`)

Add three methods after the existing `insertTranscript`. Update `insertTranscript` to accept `userId`.

#### 3a. Update `insertTranscript`

```ts
async insertTranscript(
  threadId: string,
  turnId: string,
  transcript: string,
  retentionDays = DEFAULT_RETENTION_DAYS,
  userId?: string,          // 5-S15 — optional; undefined for legacy/text callers
): Promise<void> {
  const retentionUntil = new Date();
  retentionUntil.setDate(retentionUntil.getDate() + retentionDays);

  const row: Record<string, unknown> = {
    thread_id: threadId,
    turn_id: turnId,
    transcript,
    retention_until: retentionUntil.toISOString(),
  };
  if (userId !== undefined) row.user_id = userId;

  const { error } = await this.client.from('voice_transcripts').insert(row);
  if (error) throw error;
}
```

> The `user_id` column is nullable in the migration (existing rows have no user), so `undefined` callers remain valid. New voice callers (5-S15) pass `userId`.

#### 3b. New read method

```ts
async findByUserId(userId: string, limit = 20): Promise<VoiceTranscriptItemRow[]> {
  const { data, error } = await this.client
    .from('voice_transcripts')
    .select('id, transcript, retention_until, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data as VoiceTranscriptItemRow[]) ?? [];
}
```

Where `VoiceTranscriptItemRow` is an inline interface or the inferred Supabase type — match the project's pattern (no explicit interface if the codebase uses inline casting, as in `voice-transcript.repository.ts` itself).

#### 3c. New delete-by-user method

```ts
async deleteByUserId(userId: string): Promise<void> {
  const { error } = await this.client
    .from('voice_transcripts')
    .delete()
    .eq('user_id', userId);
  if (error) throw error;
}
```

#### 3d. New purge-expired method (for the nightly job)

```ts
async deleteExpired(): Promise<{ count: number }> {
  const now = new Date().toISOString();
  const { data, error } = await this.client
    .from('voice_transcripts')
    .delete()
    .lt('retention_until', now)
    .select('id');
  if (error) throw error;
  return { count: (data as { id: string }[] | null)?.length ?? 0 };
}
```

> **`.select('id')` after `.delete()`**: Supabase PostgREST requires `Prefer: return=representation` to get deleted rows back. If the client doesn't support this cleanly, use a two-step count-then-delete or just return `{ count: 0 }` as best-effort. Check the existing `hardDeleteSoftForgotten` in `MemoryRepository` for the proven codebase pattern — it uses `.select(columns)` chained after `.delete()`.

---

### Task 4 — UserRepository (`apps/api/src/modules/users/user.repository.ts`)

#### 4a. Extend `UserProfileRow`

Add after `caption_only_mode`:
```ts
// Slice 5-S15 — voice retention preference.
voice_retention_mode: 'standard' | 'immediate_delete';
```

#### 4b. Extend `UpdateUserProfileInput`

Add:
```ts
voice_retention_mode?: 'standard' | 'immediate_delete';
```

#### 4c. Update `PROFILE_COLUMNS`

Append `, voice_retention_mode` to the existing column string:
```ts
const PROFILE_COLUMNS =
  'id, email, display_name, preferred_language, role, notification_prefs, cultural_language, parental_notice_acknowledged_at, parental_notice_acknowledged_version, caption_only_mode, voice_retention_mode';
```

---

### Task 5 — UserService (`apps/api/src/modules/users/user.service.ts`)

#### 5a. New `updateVoiceRetention` method

Add after `updateMyAccessibility`:

```ts
// Slice 5-S15 — update voice retention mode. Returns the updated profile.
// Transcript deletion (when switching to immediate_delete) is handled at the
// route layer to avoid coupling UserService to VoiceTranscriptRepository.
async updateVoiceRetention(
  userId: string,
  householdId: string,
  input: UpdateVoiceRetentionRequest,
): Promise<UserProfile> {
  const row = await this.repository.updateUserProfile(userId, {
    voice_retention_mode: input.voice_retention_mode,
  });
  const auth_providers = await this.fetchAuthProviders(userId);
  const flags = await this.deriveOnboardingFlags(row, householdId);
  return toUserProfile(row, auth_providers, flags);
}
```

Import at top of file:
```ts
import type { ..., UpdateVoiceRetentionRequest } from '@hivekitchen/types';
```

#### 5b. Extend `toUserProfile` mapper

Add one line in the return object:
```ts
voice_retention_mode: row.voice_retention_mode,
```

> **Import `VoiceRetentionMode`**: The mapper's return type is `UserProfile` (inferred from `UserProfileSchema` via `@hivekitchen/types`). No explicit import needed — the type flows from the Zod schema. Just ensure the string literal value matches.

---

### Task 6 — User Routes (`apps/api/src/modules/users/user.routes.ts`)

Add two new routes inside the existing `userRoutesPlugin` after the accessibility PATCH route.

```ts
import {
  ...,
  UpdateVoiceRetentionRequestSchema,
  VoiceTranscriptsResponseSchema,
} from '@hivekitchen/contracts';
import type { ..., UpdateVoiceRetentionRequest } from '@hivekitchen/types';
import { VoiceTranscriptRepository } from '../voice/voice-transcript.repository.js';
```

Inside the plugin:
```ts
const voiceTranscriptRepo = new VoiceTranscriptRepository(fastify.supabase);
```

Route 1 — GET voice transcripts:
```ts
fastify.get(
  '/v1/users/me/voice-transcripts',
  {
    schema: {
      response: { 200: VoiceTranscriptsResponseSchema },
    },
  },
  async (request) => {
    const userId = request.user.id;
    const [transcripts, userRow] = await Promise.all([
      voiceTranscriptRepo.findByUserId(userId),
      repository.findUserById(userId),
    ]);
    const voice_retention_mode = userRow?.voice_retention_mode ?? 'standard';
    return { transcripts, voice_retention_mode };
  },
);
```

Route 2 — PATCH voice retention mode:
```ts
fastify.patch(
  '/v1/users/me/voice-retention',
  {
    schema: {
      body: UpdateVoiceRetentionRequestSchema,
      response: { 200: UserProfileSchema },
    },
  },
  async (request) => {
    const body = request.body as UpdateVoiceRetentionRequest;
    const userId = request.user.id;

    // Delete existing transcripts synchronously before updating mode (AC5).
    // Only delete when switching to immediate_delete — standard mode keeps them.
    if (body.voice_retention_mode === 'immediate_delete') {
      await voiceTranscriptRepo.deleteByUserId(userId);
    }

    const profile = await service.updateVoiceRetention(
      userId,
      request.user.household_id,
      body,
    );
    request.auditContext = {
      event_type: 'account.updated',
      user_id: userId,
      household_id: request.user.household_id,
      request_id: request.id,
      metadata: { fields_changed: ['voice_retention_mode'] },
    };
    return profile;
  },
);
```

> **`repository` is already in scope** — it's the `UserRepository` instance created at the top of `userRoutesPlugin`. No second constructor call needed. Confirm by checking the existing `PATCH /v1/users/me` handler — it uses `service` (which wraps `repository`). The GET route here calls `repository.findUserById` directly for efficiency (avoids the full profile path).

---

### Task 7 — LumiService + LumiVoiceWsState (`apps/api/src/modules/lumi/lumi.service.ts`)

#### 7a. Extend `LumiVoiceWsState`

```ts
export interface LumiVoiceWsState {
  householdId: string;
  userId: string;                                           // 5-S15 — for transcript user_id
  voiceRetentionMode: 'standard' | 'immediate_delete';    // 5-S15 — cached at WS open
  contextSignal: LumiContextSignal | null;
  isProcessing: boolean;
  seq: number;
}
```

#### 7b. Extend `submitTextTurn` input

Add two optional fields to the input type:
```ts
async submitTextTurn(input: {
  householdId: string;
  message: string;
  contextSignal: LumiContextSignal;
  modality?: 'text' | 'voice';
  userId?: string;                                          // 5-S15 — passed for voice turns
  voiceRetentionMode?: 'standard' | 'immediate_delete';   // 5-S15 — skip insert if immediate_delete
}): Promise<...>
```

#### 7c. Update the voice_transcripts write block

Replace the existing `if (modality === 'voice')` block:

```ts
if (modality === 'voice') {
  // 5-S15: skip insert entirely when user has chosen immediate-delete mode.
  if (input.voiceRetentionMode !== 'immediate_delete') {
    try {
      await this.voiceTranscriptRepository.insertTranscript(
        thread.id,
        lumiTurn.id,
        input.message,
        90,              // default retention days
        input.userId,   // undefined for text callers; set for voice callers (5-S15)
      );
    } catch (err) {
      this.logger.warn(
        {
          err,
          module: 'lumi',
          action: 'lumi.voice_transcript_persist_failed',
          thread_id: thread.id,
        },
        'voice transcript persist failed — best-effort, continuing',
      );
    }
  }
}
```

---

### Task 8 — Lumi Routes WS setup (`apps/api/src/modules/lumi/lumi.routes.ts`)

In the WS handler, after verifying the session and before setting `resolvedState`:

```ts
// 5-S15 — fetch retention mode once per WS connection (not per turn).
// One extra DB read; cached in state for the connection's lifetime.
// Fail-open: if the user row is missing, default to 'standard'.
const userRepo = new UserRepository(fastify.supabase);
let voiceRetentionMode: 'standard' | 'immediate_delete' = 'standard';
try {
  const userRow = await userRepo.findUserById(session.user_id);
  voiceRetentionMode = userRow?.voice_retention_mode ?? 'standard';
} catch {
  // fail-open: transcript persist proceeds in standard mode
}

resolvedState = {
  householdId: session.household_id,
  userId: session.user_id,                 // 5-S15
  voiceRetentionMode,                      // 5-S15
  contextSignal: null,
  isProcessing: false,
  seq: 0,
};
```

Add the import at the top of `lumi.routes.ts`:
```ts
import { UserRepository } from '../users/user.repository.js';
```

In `processVoiceUtterance` call (already passing `state`), also pass the new state fields to `submitTextTurn`:
```ts
result = await this.submitTextTurn({
  householdId: state.householdId,
  userId: state.userId,                        // 5-S15
  voiceRetentionMode: state.voiceRetentionMode, // 5-S15
  message: transcript,
  contextSignal,
  modality: 'voice',
});
```

This call is in `processVoiceUtterance` inside `lumi.service.ts` — update that call site.

---

### Task 9 — Nightly purge job (`apps/api/src/jobs/voice-transcript-purge.job.ts`) [NEW FILE]

```ts
import fp from 'fastify-plugin';
import type { FastifyBaseLogger, FastifyPluginAsync } from 'fastify';
import { VoiceTranscriptRepository } from '../modules/voice/voice-transcript.repository.js';

const VOICE_TRANSCRIPT_PURGE_QUEUE = 'voice-transcript-purge';
const VOICE_TRANSCRIPT_PURGE_SCHEDULER_ID = 'nightly-voice-transcript-purge';

export interface VoiceTranscriptPurgeDeps {
  repo: Pick<VoiceTranscriptRepository, 'deleteExpired'>;
  logger: FastifyBaseLogger;
}

// 5-S15 — extracted for unit testability (mirrors runMemoryForgetSweep pattern).
export async function runVoiceTranscriptPurge(
  deps: VoiceTranscriptPurgeDeps,
): Promise<{ count: number }> {
  let result: { count: number };
  try {
    result = await deps.repo.deleteExpired();
  } catch (err) {
    deps.logger.error(
      { err, module: 'voice-transcript-purge', action: 'purge.failed' },
      'voice-transcript-purge: delete query failed',
    );
    throw err; // BullMQ retries (attempts: 3)
  }

  deps.logger.info(
    { module: 'voice-transcript-purge', action: 'purge.complete', count: result.count },
    'voice-transcript-purge: deleted expired transcripts',
  );

  return result;
}

const voiceTranscriptPurgePlugin: FastifyPluginAsync = async (fastify) => {
  if (!fastify.supabase) {
    throw new Error('voiceTranscriptPurgePlugin requires supabase — register supabasePlugin first');
  }

  const repo = new VoiceTranscriptRepository(fastify.supabase);
  const queue = fastify.bullmq.getQueue(VOICE_TRANSCRIPT_PURGE_QUEUE);

  void queue
    .upsertJobScheduler(
      VOICE_TRANSCRIPT_PURGE_SCHEDULER_ID,
      { pattern: '0 4 * * *', tz: 'UTC' },
      {
        name: 'purge-expired-transcripts',
        data: {},
        opts: {
          attempts: 3,
          backoff: { type: 'exponential' as const, delay: 60_000 },
          removeOnComplete: { count: 30 },
          removeOnFail: { count: 14 },
        },
      },
    )
    .catch((err: unknown) => {
      fastify.log.error(
        { err, module: 'voice-transcript-purge', action: 'scheduler.registration.failed' },
        'failed to register voice-transcript-purge scheduler',
      );
    });

  fastify.bullmq.getWorker(VOICE_TRANSCRIPT_PURGE_QUEUE, async () => {
    await runVoiceTranscriptPurge({ repo, logger: fastify.log });
  });
};

export const voiceTranscriptPurgeJobPlugin = fp(voiceTranscriptPurgePlugin, {
  name: 'voice-transcript-purge-job',
});
```

**Register in `apps/api/src/app.ts`:**
Add after `memoryForgetJobPlugin`:
```ts
import { voiceTranscriptPurgeJobPlugin } from './jobs/voice-transcript-purge.job.js';
// ...
await fastify.register(voiceTranscriptPurgeJobPlugin);
```

---

### Task 10 — Web: Account Voice Data section (`apps/web/src/routes/(app)/account.tsx`)

Add a new section **after** the Accessibility section (5-S13). The pattern follows `caption_only_mode` exactly.

#### 10a. Imports

```ts
import type { VoiceTranscriptItem, VoiceRetentionMode } from '@hivekitchen/types';
```

#### 10b. State

```ts
const [voiceRetentionMode, setVoiceRetentionMode] = useState<VoiceRetentionMode>('standard');
const [voiceTranscripts, setVoiceTranscripts] = useState<VoiceTranscriptItem[]>([]);
const [voiceRetentionLoading, setVoiceRetentionLoading] = useState(false);
const [voiceRetentionError, setVoiceRetentionError] = useState<string | null>(null);
```

#### 10c. Mount fetch

Extend the existing `useEffect` (or add a separate one) to also load voice data:
```ts
async function fetchVoiceData() {
  try {
    const data = await hkFetch<{ transcripts: VoiceTranscriptItem[]; voice_retention_mode: VoiceRetentionMode }>(
      '/v1/users/me/voice-transcripts',
    );
    setVoiceRetentionMode(data.voice_retention_mode);
    setVoiceTranscripts(data.transcripts);
  } catch {
    // fail-open: section renders with defaults
  }
}
void fetchVoiceData();
```

You can also hydrate `voiceRetentionMode` from the profile if already loaded:
- `GET /v1/users/me` already returns `voice_retention_mode` (AC11). If the page already calls `/me`, use that for the toggle initial state, and only call `/voice-transcripts` for the list.
- **Check the existing pattern**: look at how `caption_only_mode` is hydrated from the profile response (likely via `setProfile()` call). Match that exact pattern for `voice_retention_mode`.

#### 10d. Toggle handler

```ts
async function handleVoiceRetentionToggle(immediate: boolean) {
  setVoiceRetentionError(null);
  const newMode: VoiceRetentionMode = immediate ? 'immediate_delete' : 'standard';

  // Optimistic update (AC10).
  const prevMode = voiceRetentionMode;
  const prevTranscripts = voiceTranscripts;
  setVoiceRetentionMode(newMode);
  if (newMode === 'immediate_delete') setVoiceTranscripts([]);

  setVoiceRetentionLoading(true);
  try {
    await hkFetch('/v1/users/me/voice-retention', {
      method: 'PATCH',
      body: { voice_retention_mode: newMode },
    });
  } catch {
    // Revert on failure (AC10).
    setVoiceRetentionMode(prevMode);
    setVoiceTranscripts(prevTranscripts);
    setVoiceRetentionError('Could not update voice data setting. Please try again.');
  } finally {
    setVoiceRetentionLoading(false);
  }
}
```

#### 10e. JSX section

```tsx
{/* Voice Data — shown to all roles; voice is per-user, not role-gated */}
<div className="border-t border-stone-200/50 pt-6 space-y-3">
  <h2 className="text-heading3 text-fg">Voice Data</h2>
  <div className="flex items-start justify-between gap-4">
    <div>
      <p className="text-body text-fg">Delete transcripts immediately</p>
      <p className="text-sm text-fg-muted">
        When on, Lumi forgets your voice turns as soon as they're processed. When off,
        transcripts are kept for 90 days.
      </p>
    </div>
    <input
      type="checkbox"
      role="switch"
      aria-label="Delete transcripts immediately"
      aria-checked={voiceRetentionMode === 'immediate_delete'}
      checked={voiceRetentionMode === 'immediate_delete'}
      disabled={voiceRetentionLoading}
      onChange={(e) => { void handleVoiceRetentionToggle(e.target.checked); }}
    />
  </div>
  {voiceRetentionError && (
    <p role="alert" className="text-sm text-safety-red">{voiceRetentionError}</p>
  )}

  {voiceRetentionMode === 'standard' && voiceTranscripts.length > 0 && (
    <div className="space-y-2 pt-2">
      <p className="text-sm text-fg-muted">Recent voice transcripts</p>
      <ul className="space-y-2">
        {voiceTranscripts.map((t) => {
          const daysLeft = Math.ceil(
            (new Date(t.retention_until).getTime() - Date.now()) / (1000 * 60 * 60 * 24),
          );
          return (
            <li key={t.id} className="text-sm text-fg border border-stone-200/50 rounded-md p-3">
              <p className="line-clamp-2">{t.transcript}</p>
              <p className="text-fg-muted mt-1">
                {daysLeft > 0 ? `Expires in ${daysLeft} day${daysLeft === 1 ? '' : 's'}` : 'Expiring soon'}
              </p>
            </li>
          );
        })}
      </ul>
    </div>
  )}

  {voiceRetentionMode === 'standard' && voiceTranscripts.length === 0 && (
    <p className="text-sm text-fg-muted pt-1">No voice transcripts yet.</p>
  )}
</div>
```

> **Checkbox pattern**: Exact same `<input type="checkbox" role="switch" className="h-4 w-4">` class as the Notifications and Accessibility toggles — NO extra className here, match whatever class the Notifications toggle uses in `account.tsx`. Do NOT use honey-amber switch tokens unless confirmed in tailwind.config.
>
> **`line-clamp-2`**: Standard Tailwind class — confirm it's used elsewhere in the codebase; if not, use `overflow-hidden` with a max-height instead.

---

### Task 11 — Tests

#### 11a. Contracts (`packages/contracts/src/voice-retention.test.ts`) [NEW FILE]

```ts
import { describe, expect, it } from 'vitest';
import {
  VoiceRetentionModeSchema,
  UpdateVoiceRetentionRequestSchema,
  VoiceTranscriptItemSchema,
  VoiceTranscriptsResponseSchema,
} from './voice-retention.js';

describe('VoiceRetentionModeSchema', () => {
  it('accepts standard', () => expect(VoiceRetentionModeSchema.parse('standard')).toBe('standard'));
  it('accepts immediate_delete', () =>
    expect(VoiceRetentionModeSchema.parse('immediate_delete')).toBe('immediate_delete'));
  it('rejects unknown mode', () => expect(() => VoiceRetentionModeSchema.parse('delete')).toThrow());
});

describe('UpdateVoiceRetentionRequestSchema', () => {
  it('accepts standard', () =>
    expect(UpdateVoiceRetentionRequestSchema.parse({ voice_retention_mode: 'standard' })).toEqual({
      voice_retention_mode: 'standard',
    }));
  it('accepts immediate_delete', () =>
    expect(UpdateVoiceRetentionRequestSchema.parse({ voice_retention_mode: 'immediate_delete' })).toEqual({
      voice_retention_mode: 'immediate_delete',
    }));
  it('rejects empty body', () =>
    expect(() => UpdateVoiceRetentionRequestSchema.parse({})).toThrow());
});

describe('VoiceTranscriptsResponseSchema', () => {
  it('parses response with transcripts', () => {
    const result = VoiceTranscriptsResponseSchema.parse({
      transcripts: [
        {
          id: '00000000-0000-0000-8000-000000000001',
          transcript: 'What is for lunch today?',
          retention_until: '2026-11-01T00:00:00.000Z',
          created_at: '2026-10-23T10:00:00.000Z',
        },
      ],
      voice_retention_mode: 'standard',
    });
    expect(result.transcripts).toHaveLength(1);
    expect(result.voice_retention_mode).toBe('standard');
  });

  it('parses empty transcripts for immediate_delete', () => {
    const result = VoiceTranscriptsResponseSchema.parse({
      transcripts: [],
      voice_retention_mode: 'immediate_delete',
    });
    expect(result.transcripts).toHaveLength(0);
  });
});
```

#### 11b. API routes (add to `apps/api/src/modules/users/user.routes.test.ts`)

```ts
describe('GET /v1/users/me/voice-transcripts', () => {
  it('200 — returns transcripts and mode for authenticated user', async () => {
    // mock voiceTranscriptRepo.findByUserId → [{ id, transcript, retention_until, created_at }]
    // mock repository.findUserById → { ..., voice_retention_mode: 'standard' }
    // assert 200 + body matches VoiceTranscriptsResponseSchema
  });

  it('200 — returns empty array when no transcripts', async () => {
    // mock findByUserId → []
    // assert body.transcripts.length === 0
  });
});

describe('PATCH /v1/users/me/voice-retention', () => {
  it('200 — updates mode to immediate_delete and deletes transcripts', async () => {
    // mock voiceTranscriptRepo.deleteByUserId (called when immediate_delete)
    // mock service.updateVoiceRetention → updated profile
    // assert 200 + body.voice_retention_mode === 'immediate_delete'
    // assert deleteByUserId was called with request.user.id
  });

  it('200 — updates mode to standard (no delete)', async () => {
    // mock service.updateVoiceRetention; assert deleteByUserId NOT called
  });

  it('400 — rejects invalid mode', async () => {
    // send { voice_retention_mode: 'never' }; assert 400
  });
});
```

#### 11c. Nightly job test (`apps/api/src/jobs/voice-transcript-purge.job.test.ts`) [NEW FILE]

```ts
describe('runVoiceTranscriptPurge', () => {
  it('deletes expired transcripts and returns count', async () => {
    const repo = { deleteExpired: vi.fn().mockResolvedValue({ count: 3 }) };
    const logger = { info: vi.fn(), error: vi.fn() };
    const result = await runVoiceTranscriptPurge({ repo, logger } as never);
    expect(result.count).toBe(3);
    expect(repo.deleteExpired).toHaveBeenCalledOnce();
  });

  it('re-throws on delete failure (BullMQ retry)', async () => {
    const repo = { deleteExpired: vi.fn().mockRejectedValue(new Error('DB error')) };
    const logger = { info: vi.fn(), error: vi.fn() };
    await expect(runVoiceTranscriptPurge({ repo, logger } as never)).rejects.toThrow('DB error');
  });
});
```

#### 11d. Web (`apps/web/src/routes/(app)/account.test.tsx`)

Add to the existing test file:

```ts
it('renders Voice Data section with toggle', async () => {
  // mock GET /v1/users/me → { ..., voice_retention_mode: 'standard' }
  // mock GET /v1/users/me/voice-transcripts → { transcripts: [], voice_retention_mode: 'standard' }
  // render account page; assert "Delete transcripts immediately" toggle is present
});

it('calls PATCH and clears list when switching to immediate-delete', async () => {
  // mock GET /v1/users/me/voice-transcripts → { transcripts: [sampleTranscript], voice_retention_mode: 'standard' }
  // mock PATCH /v1/users/me/voice-retention → success
  // click toggle; assert PATCH called with { voice_retention_mode: 'immediate_delete' }
  // assert transcript list disappears
});

it('reverts toggle and list on PATCH failure', async () => {
  // mock PATCH → 500
  // click toggle; assert toggle reverts to 'standard' and transcripts restore
  // assert error message appears
});
```

---

## Deferred Work

| ID | Item |
|---|---|
| D-5S15-1 | Per-turn mode refresh: `voiceRetentionMode` is cached in `LumiVoiceWsState` at WS open. If the user changes mode mid-session, the WS state is stale until reconnect. Acceptable for MVP — document as a known edge case. |
| D-5S15-2 | Transcript list pagination: GET is capped at 20 items. Full pagination deferred. |
| D-5S15-3 | Server-side TTS skip: when mode is `immediate_delete`, the server still streams MP3 chunks even though no transcript is persisted. Reuse D-5S13-1 (from 5-S13 review). |

Add these to `_bmad-output/implementation-artifacts/deferred-work.md`.

---

## Key Reconciliations (pre-empting dev traps)

1. **`voice_transcripts.user_id` is nullable (existing rows)**. The migration adds the column with `ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES users(id) ON DELETE CASCADE` — no `NOT NULL` constraint — so existing rows (from 5-S5 inserts that had no `userId`) are valid. `findByUserId` only returns rows where `user_id = $userId`, so old null-user rows are invisible via the API.

2. **`UserProfileSchema` circular import risk**. `users.ts` must import `VoiceRetentionModeSchema` from `'./voice-retention.js'` (relative), NOT from `'@hivekitchen/contracts'` (the index). Both are in the same `packages/contracts/src/` folder. Circular imports in this package break `pnpm build`.

3. **`toUserProfile` mapper must include `voice_retention_mode`**. The mapper is an explicit mapping function (not a spread). Adding `voice_retention_mode` to `UserProfileRow` and `PROFILE_COLUMNS` but forgetting to add it to `toUserProfile` will cause a TypeScript error (strict mode). Check the existing mapper in `user.service.ts` line by line.

4. **Transcript delete before mode update (AC5)**. The route handler deletes transcripts FIRST (`deleteByUserId`), then calls `updateVoiceRetention`. If the delete succeeds but the DB update fails, the transcripts are gone but the mode is still `standard` — acceptable MVP behavior (transcripts were cleared, which is the safer outcome). Do NOT reverse the order.

5. **`GET /v1/users/me/voice-transcripts` uses two parallel reads**. The route fires `findByUserId` and `findUserById` in `Promise.all`. If `findUserById` returns null (edge case: user deleted mid-request), fall back to `voice_retention_mode: 'standard'` via `?? 'standard'`.

6. **LumiVoiceWsState `userId` source**. The `session.user_id` is already validated against `payload.sub` (JWT sub) in the existing WS auth check. So `state.userId = session.user_id` is already validated — no extra auth check needed.

7. **`UserRepository` in `lumi.routes.ts`**. The lumi routes plugin does not currently instantiate `UserRepository`. Add `const userRepo = new UserRepository(fastify.supabase)` inside the WS handler's async setup block (not at plugin scope, so it's scoped to the connection). The `UserRepository` constructor takes one argument: `fastify.supabase`.

8. **Nightly job cron time: `0 4 * * *` UTC** — runs 1 hour after `memory-forget.job.ts` (`0 3 * * *`). Register `voiceTranscriptPurgeJobPlugin` in `app.ts` after `memoryForgetJobPlugin` (canonical ordering for nightly jobs).

9. **`deleteExpired` return shape**. Check `hardDeleteSoftForgotten` in `memory.repository.ts` for the exact `.delete().select('id')` chain pattern. The Supabase JS client returns `{ data: [...], error }` — `data` is the deleted rows (only if `Prefer: return=representation` is honored). If the codebase's Supabase client version doesn't support this reliably, use `{ count: 0 }` as the fallback (the job doesn't need the exact count for correctness, only for logging).

10. **`processVoiceUtterance` call site**. The call to `submitTextTurn` happens inside `processVoiceUtterance` in `lumi.service.ts` (not in the route). The route file's WS handler calls `service.processVoiceUtterance(resolvedState!, buf, socket)` — the state now carries `userId` and `voiceRetentionMode`, and `processVoiceUtterance` passes them into `submitTextTurn`. Update the call in `lumi.service.ts` line ~289.

11. **No `audit_event_type` migration needed**. Mode changes use the existing `account.updated` event type. Do NOT add `ALTER TYPE audit_event_type ADD VALUE` to this migration.

12. **Zod 4 confirmed** (`packages/contracts` pins `zod: ^4.0.0`). Use `z.enum(['standard', 'immediate_delete'])` — valid in Zod 4. The `project-context.md` "Zod 3.23" note is stale (confirmed in 5-S14 dev notes).

---

## Previous Story Intelligence (from 5-S14)

- **Checkbox toggle pattern** established in `account.tsx`: `<input type="checkbox" role="switch" className="h-4 w-4" aria-checked={...} aria-label="...">`. Match exactly — confirmed working pattern. No honey-amber tokens.
- **Optimistic UI + revert**: same shape as 5-S14 geolocation toggle (set state optimistically, revert on catch). The voice retention handler follows the same pattern.
- **`hkFetch` body = plain object**: always pass `body: { ... }` as a raw object — `hkFetch` JSON-stringifies internally. Confirmed multiple times across stories. Never double-stringify.
- **Error token `text-safety-red`**: confirmed in `account.tsx`. No `-600` suffix.
- **Pre-existing failing tests**: API 20f/13skip, web 2f, contracts 7f — these are baselines. Do NOT fix them.
- **Typecheck baselines**: API 12, web 7, contracts 1, types 1 — zero new errors is the gate.
- **`isolatedModules` re-export rule**: use `export type { VoiceRetentionMode, ... }` in `packages/types/src/index.ts`, not `export { ... }`.
- **Migration timestamp ordering**: `20261023000000` follows `20261022000000` (5-S14). If a conflict exists locally, increment to `20261023000100`.
- **Service class uses `this.deps.repository`** (observed in HouseholdsService) vs `this.repository` (UserService). `UserService` uses `this.repository` directly — confirm before writing the new `updateVoiceRetention` method.

---

## File List (predicted)

**New**
- `supabase/migrations/20261023000000_add_voice_retention_mode.sql`
- `packages/contracts/src/voice-retention.ts`
- `packages/contracts/src/voice-retention.test.ts`
- `apps/api/src/jobs/voice-transcript-purge.job.ts`
- `apps/api/src/jobs/voice-transcript-purge.job.test.ts`

**Modified**
- `packages/contracts/src/users.ts` — `VoiceRetentionModeSchema` import + `UserProfileSchema.voice_retention_mode`
- `packages/contracts/src/index.ts` — `export * from './voice-retention.js'`
- `packages/types/src/index.ts` — 4 new voice-retention type re-exports
- `apps/api/src/modules/voice/voice-transcript.repository.ts` — `insertTranscript` + `userId` param + `findByUserId` + `deleteByUserId` + `deleteExpired`
- `apps/api/src/modules/users/user.repository.ts` — `voice_retention_mode` in `UserProfileRow` + `UpdateUserProfileInput` + `PROFILE_COLUMNS`
- `apps/api/src/modules/users/user.service.ts` — `updateVoiceRetention` + `toUserProfile` mapper
- `apps/api/src/modules/users/user.routes.ts` — GET + PATCH routes + `VoiceTranscriptRepository` import
- `apps/api/src/modules/users/user.routes.test.ts` — route tests for GET + PATCH
- `apps/api/src/modules/lumi/lumi.service.ts` — `LumiVoiceWsState` + `submitTextTurn` input + voice_transcripts write block
- `apps/api/src/modules/lumi/lumi.routes.ts` — WS setup reads user row + `UserRepository` import + `resolvedState` includes `userId` + `voiceRetentionMode`
- `apps/api/src/app.ts` — register `voiceTranscriptPurgeJobPlugin`
- `apps/web/src/routes/(app)/account.tsx` — Voice Data section + state + handlers
- `apps/web/src/routes/(app)/account.test.tsx` — 3 new web tests
- `_bmad-output/implementation-artifacts/deferred-work.md` — D-5S15-1, D-5S15-2, D-5S15-3

---

## Baselines (from 5-S14 done state)

| Suite | Baseline |
|---|---|
| Contracts | 745p / 7f |
| API | 1786p / 20f / 13skip |
| Web | 568p / 2f |
| Typecheck | API 12 / web 7 / contracts 1 / types 1 |

**Gate:** Zero new test failures, zero new typecheck errors, and `pnpm --filter @hivekitchen/contracts build` passes.

**USER-SIDE GATE:** `supabase db push --include-all` (migration `20261023000000`) before any live demo or integration test.

---

## Dev Agent Record

### Agent Model Used

claude-sonnet-4-6 (create-story); claude-opus-4-8 (dev-story)

### Completion Notes List

All 12 ACs implemented end-to-end and verified.

- **AC1–AC3, AC7** — `GET /v1/users/me/voice-transcripts` returns `{ transcripts, voice_retention_mode }`; `findByUserId` selects `id, transcript, retention_until, created_at`, scoped to `user_id`, newest-first, capped at 20. Legacy 5-S5 rows (NULL user_id) are invisible.
- **AC4, AC11** — `PATCH /v1/users/me/voice-retention` returns the updated `UserProfile`; `UserProfileSchema.voice_retention_mode` added and flows through `GET /v1/users/me` via the explicit `toUserProfile` mapper.
- **AC5** — route deletes transcripts synchronously (`deleteByUserId`) BEFORE the profile update, only when switching to `immediate_delete`.
- **AC6** — `LumiService.submitTextTurn` skips the `insertTranscript` call entirely when `voiceRetentionMode === 'immediate_delete'`; otherwise forwards `userId` (5-arg call: `threadId, turnId, message, 90, userId`).
- **AC8** — `runVoiceTranscriptPurge` + `voiceTranscriptPurgeJobPlugin` (cron `0 4 * * *` UTC, `attempts: 3`); `deleteExpired` uses the proven `.delete().lt().select('id')` pattern; re-throws on failure for BullMQ retry. Registered in `app.ts` after `memoryForgetJobPlugin`.
- **AC9, AC10** — Account "Voice Data" section: mode toggle + transcript list (standard) / empty state. `handleVoiceRetentionToggle` is optimistic (clears list immediately on immediate-delete) and reverts both mode and list on PATCH failure.
- **AC12** — Tests added: contracts schema round-trips (8) + UserProfileSchema voice_retention_mode round-trip/reject (2); API GET (3) + PATCH (4) routes; nightly job (2); LumiService skip/forward (2); web render + optimistic clear + revert (3).

**WS retention mode** is read once per connection in `lumi.routes.ts` (fail-open to `standard`), cached in `LumiVoiceWsState.voiceRetentionMode` — mid-session changes are stale until reconnect (D-5S15-1).

**Deviations from story spec (minor):**
- Contracts fixture UUID in the story (`...-0000-8000-...`) is not a valid v4 UUID; used `...-4000-8000-...` so Zod 4 `.uuid()` accepts it (same correction noted in 7-S9).
- Web section uses the codebase's existing `<section className="space-y-3 border-t border-border pt-6">` + `font-serif text-xl` + `h-4 w-4` checkbox pattern (matching Accessibility/Notifications), NOT the story's `border-stone-200/50` / `text-heading3` classes (not in this codebase).
- `pnpm --filter @hivekitchen/contracts build` does not exist (contracts is source-imported, no build step); verified via typecheck instead.
- Updated 5 existing test fixtures for the new `UserProfileRow`/`LumiVoiceWsState`/`UserProfileSchema` fields and converted one fragile call-order web mock to path-based (the new mount-time `/voice-transcripts` fetch adds an hkFetch call).

**Verification (baselines preserved, zero new failures):**
- Contracts 755p / 7f (baseline 7f) — +10 tests
- API 1797p / 20f / 13skip (baseline 20f/13skip) — +11 tests
- Web 571p / 2f (baseline 2f) — +3 tests
- Typecheck: API 12 / web 7 / contracts 1 / types 1 (zero new)

**USER-SIDE GATE:** `supabase db push --include-all` (migration `20261023000000`) before any live demo or integration test.

### File List

**New**
- `supabase/migrations/20261023000000_add_voice_retention_mode.sql`
- `packages/contracts/src/voice-retention.ts`
- `packages/contracts/src/voice-retention.test.ts`
- `apps/api/src/jobs/voice-transcript-purge.job.ts`
- `apps/api/src/jobs/voice-transcript-purge.job.test.ts`

**Modified**
- `packages/contracts/src/users.ts`
- `packages/contracts/src/users.test.ts`
- `packages/contracts/src/index.ts`
- `packages/types/src/index.ts`
- `apps/api/src/modules/voice/voice-transcript.repository.ts`
- `apps/api/src/modules/users/user.repository.ts`
- `apps/api/src/modules/users/user.repository.test.ts`
- `apps/api/src/modules/users/user.service.ts`
- `apps/api/src/modules/users/user.routes.ts`
- `apps/api/src/modules/users/user.routes.test.ts`
- `apps/api/src/modules/lumi/lumi.service.ts`
- `apps/api/src/modules/lumi/lumi.service.test.ts`
- `apps/api/src/modules/lumi/lumi.routes.ts`
- `apps/api/src/jobs/lumi-nudge.job.test.ts`
- `apps/api/src/app.ts`
- `apps/web/src/routes/(app)/account.tsx`
- `apps/web/src/routes/(app)/account.test.tsx`
- `_bmad-output/implementation-artifacts/deferred-work.md`
- `_bmad-output/implementation-artifacts/sprint-status.yaml`

### Change Log

| Date | Change |
|---|---|
| 2026-06-08 | Implemented 5-S15 voice transcript retention controls (all 12 ACs). Migration + contracts + repo/service/routes + Lumi WS wiring + nightly purge job + web Voice Data section + tests. Status → review. |

### Review Findings

- [x] [Review][Patch] AC9 empty state missing for immediate_delete mode [`apps/web/src/routes/(app)/account.tsx`] — Added `{voiceRetentionMode === 'immediate_delete' && <p>Your voice transcripts are deleted immediately and not stored.</p>}` below the standard-mode empty state. FIXED.
- [x] [Review][Defer] D-5S15-1: Mid-session WS stale voiceRetentionMode — already documented deferred; surfaced again as an edge case (user changes mode via PATCH while voice WS session is open; WS state cached at connect time). [`apps/api/src/modules/lumi/lumi.routes.ts`, `lumi.service.ts`]
- [x] [Review][Defer] D-5S15-2: Transcript list hard-capped at 20 with no count indicator — already documented deferred; silent truncation presents incomplete list as authoritative. [`apps/api/src/modules/voice/voice-transcript.repository.ts`]
- [x] [Review][Defer] D-5S15-CR1: Non-atomic PATCH delete+mode update — spec-accepted behavior: if `deleteByUserId` succeeds but `updateVoiceRetention` throws, transcripts are gone but mode stays `standard`; client reverts to showing phantom transcript list (cleared on next navigation). Spec explicitly names this "acceptable MVP behavior." [`apps/api/src/modules/users/user.routes.ts`]
- [x] [Review][Defer] D-5S15-CR2: Pre-migration null user_id orphan rows not cleaned by deleteByUserId — `voice_transcripts` rows inserted before 5-S15 have `user_id = NULL`; `deleteByUserId` only deletes rows where `user_id = <userId>`, leaving those rows untouched when user switches to `immediate_delete`. Invisible via `findByUserId` (API-correct) but not deleted on mode change. Nightly purge handles them at `retention_until`. By-design per spec reconciliation note. [`apps/api/src/modules/voice/voice-transcript.repository.ts`]
