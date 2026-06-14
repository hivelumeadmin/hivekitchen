# 5-S16 — Voice Tier Cap

> **Folds:** story 5.7 (tier-cap side), PRD FR58, FR104 partial
> **Status:** done
> **Epic:** 5 — Household Coordination & Ambient Intelligence

---

## Story

**As a standard-tier parent** using voice turns, I want Lumi to tell me clearly when I've used
my weekly voice time, so that I'm not confused by silent failures and I know text turns still
work.

---

## Acceptance Criteria

| # | Criterion |
|---|-----------|
| AC1 | New `voice_usage(user_id uuid, week_start date, ms_consumed bigint)` table with composite PK on `(user_id, week_start)`. |
| AC2 | `POST /v1/lumi/voice/sessions` returns HTTP 429 with `{ statusCode: 429, error: 'Too Many Requests', message: "You've used this week's voice time. Text still works.", code: 'voice_cap_reached' }` when the user's `ms_consumed ≥ 600_000` (10 min) for the current week. |
| AC3 | `POST /v1/lumi/voice/sessions` succeeds normally when weekly usage is `< 600_000` ms. |
| AC4 | During an open voice WS, a WAV utterance when `ms_consumed ≥ 600_000` triggers `{ type: 'error', code: 'voice_cap_reached', message: "You've used this week's voice time. Text still works." }`. The WAV is NOT sent to ElevenLabs Scribe. |
| AC5 | After each successful STT call, `voice_usage.ms_consumed` increments by the estimated WAV duration (read from WAV header bytes). The increment is best-effort — failure is logged and does not abort the turn. |
| AC6 | `POST /v1/lumi/turns` (text turns) is NEVER affected by the voice cap — no usage read, no cap check. |
| AC7 | `'voice_cap_reached'` is a valid member of `WsErrorCodeSchema` in `packages/contracts/src/voice.ts`. |
| AC8 | Weekly usage resets automatically — each Monday UTC begins a new `voice_usage` row. Prior weeks' rows are retained (natural history). |
| AC9 | `useLumiVoiceSession` handles a 429 from session creation: sets `capReached = true`, does not open the WS. |
| AC10 | `useLumiVoiceSession` handles a `voice_cap_reached` WS error frame: sets `capReached = true`, voice input is disabled. |
| AC11 | Unit tests cover: cap-reached WS error frame when over cap; normal flow when under cap; usage increment after successful STT; 429 at session creation; text turn is unaffected; `WsErrorCodeSchema` round-trip for `voice_cap_reached`; `VoiceUsageRepository` `getWeeklyUsage` returns 0 on missing row; `incrementUsage` upsert. |

---

## Scope Notes

### What this slice ships

- **Migration** `20261024000000`: new `voice_usage` table + `increment_voice_usage` PostgreSQL function
- **Contracts**: `'voice_cap_reached'` added to `WsErrorCodeSchema` in `voice.ts`
- **Repository**: `VoiceUsageRepository` (`getWeeklyUsage`, `incrementUsage` via RPC)
- **LumiService**: `voiceUsageRepository` optional dep; cap check + usage increment in `processVoiceUtterance`; `getWeekStart()` + `estimateWavDurationMs()` helpers; `STANDARD_TIER_CAP_MS` constant
- **Lumi routes**: `POST /v1/lumi/voice/sessions` pre-check (read current week usage; 429 if ≥ cap)
- **Web**: `useLumiVoiceSession` — `capReached` state; handle 429 from session creation + `voice_cap_reached` WS frame

### What is explicitly deferred

- **Remaining quota display** (e.g., "8 min 42 sec remaining this week") — Epic 8/10
- **Per-tier cap lookup** from a subscriptions table — Epic 8. Cap is hardcoded to 600,000 ms here.
- **Atomic RPC for incrementUsage** is provided via a PostgreSQL function (see Task 1b) to avoid TOCTOU. The `isProcessing` guard in `processVoiceUtterance` prevents concurrent increments from the same WS session, but concurrent WS sessions from the same user (unlikely in beta) could race. Documented as D-5S16-1.
- **Quota carry-forward / rollover logic** — not needed; each week starts from 0.
- **Retroactive backfill** of usage from 5-S5/5-S5b voice turns — those rows have no duration info; start fresh from this slice.

---

## Implementation Tasks

### Task 1 — Migration

#### 1a. Table (`supabase/migrations/20261024000000_create_voice_usage.sql`)

```sql
-- 5-S16: Voice tier cap — weekly per-user usage counter.
CREATE TABLE IF NOT EXISTS voice_usage (
  user_id    uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  week_start date NOT NULL,                          -- Monday UTC, 'YYYY-MM-DD'
  ms_consumed bigint NOT NULL DEFAULT 0,
  CONSTRAINT voice_usage_pkey PRIMARY KEY (user_id, week_start)
);

CREATE INDEX IF NOT EXISTS idx_voice_usage_user_week
  ON voice_usage (user_id, week_start);
```

#### 1b. PostgreSQL increment function (same migration file, below the table)

```sql
-- Atomic increment via INSERT ... ON CONFLICT DO UPDATE.
-- Called by VoiceUsageRepository.incrementUsage via rpc().
CREATE OR REPLACE FUNCTION increment_voice_usage(
  p_user_id    uuid,
  p_week_start date,
  p_duration_ms bigint
) RETURNS void LANGUAGE sql AS $$
  INSERT INTO voice_usage (user_id, week_start, ms_consumed)
  VALUES (p_user_id, p_week_start, p_duration_ms)
  ON CONFLICT (user_id, week_start)
  DO UPDATE SET ms_consumed = voice_usage.ms_consumed + EXCLUDED.ms_consumed;
$$;
```

**USER-SIDE GATE:** `supabase db push --include-all` (migration `20261024000000`) before any live testing.

---

### Task 2 — Contracts (`packages/contracts/src/voice.ts`)

Add `'voice_cap_reached'` to `WsErrorCodeSchema`:

```ts
export const WsErrorCodeSchema = z.enum([
  'stt_failed',
  'agent_failed',
  'tts_failed',
  'summary_failed',
  'audio_too_large',
  'voice_cap_reached',   // 5-S16 — standard-tier weekly voice cap exceeded
]);
```

Update the test in `packages/contracts/src/voice.test.ts`:

```ts
describe('WsErrorCodeSchema', () => {
  it('accepts all known error codes', () => {
    for (const code of [
      'stt_failed', 'agent_failed', 'tts_failed', 'summary_failed',
      'audio_too_large', 'voice_cap_reached',  // 5-S16
    ] as const) {
      expect(WsErrorCodeSchema.safeParse(code).success).toBe(true);
    }
  });
  // ... existing reject tests unchanged
});
```

> **No new contract file needed.** The cap error on the HTTP side (`POST /v1/lumi/voice/sessions` 429) uses Fastify's standard error format — no custom Zod response schema. The web client detects it by `status === 429`.

---

### Task 3 — VoiceUsageRepository (`apps/api/src/modules/voice/voice-usage.repository.ts`) [NEW FILE]

```ts
import { BaseRepository } from '../../repository/base.repository.js';

export class VoiceUsageRepository extends BaseRepository {
  // Returns ms_consumed for the given week, or 0 if no row exists.
  async getWeeklyUsage(userId: string, weekStart: string): Promise<number> {
    const { data, error } = await this.client
      .from('voice_usage')
      .select('ms_consumed')
      .eq('user_id', userId)
      .eq('week_start', weekStart)
      .maybeSingle();
    if (error) throw error;
    return (data as { ms_consumed: number } | null)?.ms_consumed ?? 0;
  }

  // Atomically increments ms_consumed via the increment_voice_usage PostgreSQL function.
  // INSERT ... ON CONFLICT DO UPDATE ensures the counter never under-counts even under
  // concurrent sessions (see D-5S16-1 for the race window that still exists).
  async incrementUsage(userId: string, weekStart: string, durationMs: number): Promise<void> {
    const { error } = await this.client.rpc('increment_voice_usage', {
      p_user_id: userId,
      p_week_start: weekStart,
      p_duration_ms: durationMs,
    });
    if (error) throw error;
  }
}
```

> **`BaseRepository` pattern**: the constructor takes `client` (the Supabase client) only. `this.client` is how `VoiceTranscriptRepository`, `VoiceUsageRepository`, and all other repositories access it. Confirm by looking at `apps/api/src/repository/base.repository.ts` — the pattern is `protected readonly client`.

---

### Task 4 — LumiService (`apps/api/src/modules/lumi/lumi.service.ts`)

#### 4a. Add import

```ts
import type { VoiceUsageRepository } from '../voice/voice-usage.repository.js';
```

#### 4b. Extend `LumiServiceDeps`

Add one field **after** `familyLanguageRepository`:

```ts
voiceUsageRepository?: VoiceUsageRepository; // 5-S16 — tier cap; absent = cap disabled (tests, nudge-job)
```

> **Optional like `memoryService` and `familyLanguageRepository`**: `lumi-nudge.job.ts` creates a `LumiService` for text turns only — it must not require `voiceUsageRepository`. Making it optional keeps that ctor unchanged.

#### 4c. Add constants and helpers (module-scope, below `TTS_FAILED_COPY`)

```ts
// 5-S16 — standard-tier weekly voice cap. Full tier lookup moves to Epic 8.
const STANDARD_TIER_CAP_MS = 600_000; // 10 minutes
const VOICE_CAP_COPY = "You've used this week's voice time. Text still works.";

// 5-S16 — returns the Monday UTC date for the current week as 'YYYY-MM-DD'.
function getWeekStart(): string {
  const now = new Date();
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay(); // 0=Sun, 1=Mon, ..., 6=Sat
  const daysToMonday = day === 0 ? 6 : day - 1;
  d.setUTCDate(d.getUTCDate() - daysToMonday);
  return d.toISOString().split('T')[0]!; // 'YYYY-MM-DD'
}

// 5-S16 — estimate WAV audio duration from buffer header (PCM WAV format).
// Reads sample rate, channels, and bit depth from the standard 44-byte WAV header.
// Returns 0 for malformed or sub-header buffers.
function estimateWavDurationMs(buf: Buffer): number {
  if (buf.length <= 44) return 0;
  const sampleRate = buf.readUInt32LE(24);   // bytes 24–27: sample rate (Hz)
  const numChannels = buf.readUInt16LE(22);  // bytes 22–23: channel count
  const bitsPerSample = buf.readUInt16LE(34); // bytes 34–35: bit depth
  if (sampleRate === 0 || numChannels === 0 || bitsPerSample === 0) return 0;
  const bytesPerSecond = sampleRate * numChannels * (bitsPerSample / 8);
  return ((buf.length - 44) / bytesPerSecond) * 1_000;
}
```

#### 4d. Add cap check and usage increment in `processVoiceUtterance`

Insert **between** the `wav.length > MAX_AUDIO_BYTES` check and `state.isProcessing = true`:

```ts
// 5-S16 — standard-tier weekly cap check. Runs before the isProcessing lock to
// avoid holding it during a DB read. The isProcessing guard above prevents
// concurrent utterances from the same WS session.
if (this.deps.voiceUsageRepository) {
  const weekStart = getWeekStart();
  let consumed = 0;
  try {
    consumed = await this.deps.voiceUsageRepository.getWeeklyUsage(state.userId, weekStart);
  } catch (err) {
    this.logger.warn(
      { err, module: 'lumi', action: 'lumi.voice.usage_read_failed' },
      'voice usage read failed — failing open (not capping)',
    );
    // fail-open: do not block the user if the usage table is unreachable
  }
  if (consumed >= STANDARD_TIER_CAP_MS) {
    this.logger.info(
      { module: 'lumi', action: 'lumi.voice.cap_reached', user_id: state.userId, ms_consumed: consumed },
      'voice tier cap reached — rejecting utterance',
    );
    this.sendJson(ws, { type: 'error', code: 'voice_cap_reached', message: VOICE_CAP_COPY });
    return;
  }
}
```

Then, insert **immediately after the successful STT call** (after `transcript = await transcribeWav(...)` succeeds and before the `transcript.trim().length === 0` check):

```ts
// 5-S16 — increment usage after successful STT (duration now known).
// Best-effort: a failed increment logs + continues; the cap check fails-open
// for the same reason, so this cannot cause a session to be interrupted.
if (this.deps.voiceUsageRepository) {
  const durationMs = Math.round(estimateWavDurationMs(wav));
  if (durationMs > 0) {
    const weekStart = getWeekStart();
    this.deps.voiceUsageRepository.incrementUsage(state.userId, weekStart, durationMs).catch((err: unknown) => {
      this.logger.warn(
        { err, module: 'lumi', action: 'lumi.voice.usage_increment_failed', duration_ms: durationMs },
        'voice usage increment failed — best-effort, continuing',
      );
    });
  }
}
```

> **Fire-and-forget** with `.catch()` is intentional: the increment is best-effort and must never abort the in-flight turn. The `void` prefix is NOT used here because we want the `.catch()` handler to run — the promise is still pending. The catch prevents unhandled-rejection warnings.

---

### Task 5 — Lumi Routes (`apps/api/src/modules/lumi/lumi.routes.ts`)

#### 5a. Add import

```ts
import { VoiceUsageRepository } from '../voice/voice-usage.repository.js';
```

#### 5b. Add `VoiceUsageRepository` instantiation (below the existing `voiceTranscriptRepository = new VoiceTranscriptRepository(...)` line)

```ts
const voiceUsageRepository = new VoiceUsageRepository(fastify.supabase);
```

#### 5c. Wire into `LumiService` construction (add after `familyLanguageRepository`)

```ts
const service = new LumiService({
  repository,
  redis: fastify.redis,
  logger: fastify.log,
  elevenLabsApiKey: fastify.env.ELEVENLABS_API_KEY,
  voiceId: fastify.env.ELEVENLABS_VOICE_ID,
  openai: fastify.openai,
  childrenRepository,
  householdAllergensRepository,
  voiceTranscriptRepository,
  memoryService: fastify.memoryService,
  familyLanguageRepository,
  voiceUsageRepository, // 5-S16 — tier cap
});
```

#### 5d. Add cap pre-check to `POST /v1/lumi/voice/sessions` handler

Insert **before** `service.createTalkSession(...)`:

```ts
// 5-S16 — fast-path cap check at session creation.
// If the user is already at or over the weekly cap, reject before opening the WS.
// Fail-open: if the usage table is unreachable, allow session creation.
const VOICE_CAP_MESSAGE = "You've used this week's voice time. Text still works.";
try {
  const weekStart = getWeekStart(); // module-scope helper — add alongside constants
  const consumed = await voiceUsageRepository.getWeeklyUsage(request.user.id, weekStart);
  if (consumed >= STANDARD_TIER_CAP_MS) {
    return reply.status(429).send({
      statusCode: 429,
      error: 'Too Many Requests',
      message: VOICE_CAP_MESSAGE,
      code: 'voice_cap_reached',
    });
  }
} catch (err) {
  request.log.warn(
    { err, module: 'lumi', action: 'lumi.voice.session_cap_check_failed' },
    'voice usage read at session creation failed — allowing session',
  );
  // fail-open
}
```

> **`getWeekStart` in the routes file**: either import it from a shared utility or duplicate it here (two lines). Since it's a pure date helper with no side effects, duplication is acceptable for now. Alternatively, export it from `lumi.service.ts` — but that breaks the service encapsulation. Best approach: create `apps/api/src/common/week-start.ts` with the helper and import in both service + routes. If that feels like over-engineering for this slice, duplicate it and note the cleanup in Deferred Work.

> **`STANDARD_TIER_CAP_MS` constant in routes**: same recommendation — either share via a constants module or import from `lumi.service.ts`. The simplest approach for this slice is to define `const STANDARD_TIER_CAP_MS = 600_000` at the module scope of `lumi.routes.ts` (matching the constant in `lumi.service.ts`). Epic 8 will replace both with a tier-config lookup.

---

### Task 6 — Web: `useLumiVoiceSession` (`apps/web/src/hooks/useLumiVoiceSession.ts`)

#### 6a. Add `capReached` state

```ts
const [capReached, setCapReached] = useState(false);
```

#### 6b. Handle 429 at session creation

In the session creation `try/catch` block (wherever `POST /v1/lumi/voice/sessions` is called):

```ts
try {
  const session = await hkFetch<{ talk_session_id: string; ... }>('/v1/lumi/voice/sessions', {
    method: 'POST',
    body: { context_signal: contextSignal },
  });
  // ... proceed to open WS
} catch (err) {
  const apiErr = err as { status?: number };
  if (apiErr.status === 429) {
    setCapReached(true);
    return; // do not open WS
  }
  // existing error handling...
}
```

#### 6c. Handle `voice_cap_reached` WS frame

In the WS `message` handler, inside the `switch (frame.type)` (or equivalent `if/else`):

```ts
case 'error':
  if (frame.code === 'voice_cap_reached') {
    setCapReached(true);
  }
  // existing error handling (setError, etc.) continues...
  break;
```

#### 6d. Return `capReached` from the hook

Ensure `capReached` is in the hook's return shape so components can display the cap UI.

#### 6e. UI copy (in whichever component renders the cap state)

Display the copy exactly as: `"You've used this week's voice time. Text still works."`

This can live inline in `LumiOrb` or `LumiPanel` wherever voice errors are shown. Do NOT add a new component — use the existing error display path.

> **Where `hkFetch` lives**: `apps/web/src/lib/fetch.ts`. It parses errors via the `HkApiError` class (or equivalent). Confirm the exact error class and `.status` property before writing the 429 check — look at how `useLumiVoiceSession` already catches errors from `hkFetch`. The `err.status === 429` check must match the actual shape thrown by `hkFetch` on non-2xx responses.

---

### Task 7 — Tests

#### 7a. Contracts (`packages/contracts/src/voice.test.ts`) — add to existing `WsErrorCodeSchema` test

```ts
it('accepts all known error codes', () => {
  for (const code of [
    'stt_failed', 'agent_failed', 'tts_failed', 'summary_failed',
    'audio_too_large', 'voice_cap_reached',  // 5-S16
  ] as const) {
    expect(WsErrorCodeSchema.safeParse(code).success).toBe(true);
  }
});
```

#### 7b. VoiceUsageRepository tests (`apps/api/src/modules/voice/voice-usage.repository.test.ts`) [NEW FILE]

```ts
import { describe, expect, it, vi } from 'vitest';
import { VoiceUsageRepository } from './voice-usage.repository.js';

const SAMPLE_USER_ID = '00000000-0000-4000-8000-000000000001';
const WEEK_START = '2026-10-19'; // a Monday

function buildClient(overrides = {}) {
  const base = {
    from: vi.fn().mockReturnThis(),
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
    rpc: vi.fn().mockResolvedValue({ data: null, error: null }),
    ...overrides,
  };
  return base;
}

describe('VoiceUsageRepository.getWeeklyUsage', () => {
  it('returns 0 when no row exists', async () => {
    const client = buildClient();
    const repo = new VoiceUsageRepository(client as never);
    const result = await repo.getWeeklyUsage(SAMPLE_USER_ID, WEEK_START);
    expect(result).toBe(0);
  });

  it('returns ms_consumed from existing row', async () => {
    const client = buildClient({
      maybeSingle: vi.fn().mockResolvedValue({ data: { ms_consumed: 300_000 }, error: null }),
    });
    const repo = new VoiceUsageRepository(client as never);
    const result = await repo.getWeeklyUsage(SAMPLE_USER_ID, WEEK_START);
    expect(result).toBe(300_000);
  });

  it('throws on DB error', async () => {
    const client = buildClient({
      maybeSingle: vi.fn().mockResolvedValue({ data: null, error: new Error('db error') }),
    });
    const repo = new VoiceUsageRepository(client as never);
    await expect(repo.getWeeklyUsage(SAMPLE_USER_ID, WEEK_START)).rejects.toThrow('db error');
  });
});

describe('VoiceUsageRepository.incrementUsage', () => {
  it('calls increment_voice_usage RPC with correct args', async () => {
    const rpcMock = vi.fn().mockResolvedValue({ data: null, error: null });
    const client = { rpc: rpcMock };
    const repo = new VoiceUsageRepository(client as never);
    await repo.incrementUsage(SAMPLE_USER_ID, WEEK_START, 5_000);
    expect(rpcMock).toHaveBeenCalledWith('increment_voice_usage', {
      p_user_id: SAMPLE_USER_ID,
      p_week_start: WEEK_START,
      p_duration_ms: 5_000,
    });
  });

  it('throws on RPC error', async () => {
    const client = { rpc: vi.fn().mockResolvedValue({ error: new Error('rpc error') }) };
    const repo = new VoiceUsageRepository(client as never);
    await expect(repo.incrementUsage(SAMPLE_USER_ID, WEEK_START, 5_000)).rejects.toThrow('rpc error');
  });
});
```

#### 7c. LumiService tests (add to `apps/api/src/modules/lumi/lumi.service.test.ts`)

Add `voiceUsageRepository` mock to `buildDeps`:

```ts
const voiceUsageRepository = {
  getWeeklyUsage: vi.fn().mockResolvedValue(0),       // under cap by default
  incrementUsage: vi.fn().mockResolvedValue(undefined),
};
// include in the LumiService constructor call inside buildDeps
```

New test cases within the `LumiService.processVoiceUtterance` describe block:

```ts
it('sends voice_cap_reached error and skips STT when user is at cap', async () => {
  const { service, voiceUsageRepository } = buildDeps({ activeThread: null });
  voiceUsageRepository.getWeeklyUsage.mockResolvedValueOnce(600_000); // exactly at cap
  const ws = makeMockWs();

  await service.processVoiceUtterance(makeVoiceState(), Buffer.from('wav-bytes'), ws);

  expect(transcribeWavMock).not.toHaveBeenCalled();
  const frames = sentFrames(ws);
  expect(frames.find((f) => f.type === 'error' && f.code === 'voice_cap_reached')).toBeDefined();
});

it('processes utterance normally and increments usage when under cap', async () => {
  const { service, voiceUsageRepository } = buildDeps({ activeThread: null });
  voiceUsageRepository.getWeeklyUsage.mockResolvedValueOnce(300_000); // under cap
  const ws = makeMockWs();

  await service.processVoiceUtterance(makeVoiceState(), Buffer.from('wav-bytes'), ws);

  expect(transcribeWavMock).toHaveBeenCalledOnce();
  // increment is fire-and-forget — assert it was called (may need to await a tick)
  await new Promise((r) => setTimeout(r, 0)); // let the .catch handler settle
  expect(voiceUsageRepository.incrementUsage).toHaveBeenCalledOnce();
});

it('does not increment usage if WAV buffer is too small to estimate duration', async () => {
  const { service, voiceUsageRepository } = buildDeps({ activeThread: null });
  const ws = makeMockWs();
  // 44-byte or smaller WAV → estimateWavDurationMs returns 0 → no increment call
  await service.processVoiceUtterance(makeVoiceState(), Buffer.alloc(44), ws);
  expect(voiceUsageRepository.incrementUsage).not.toHaveBeenCalled();
});
```

#### 7d. Lumi routes test (add to `apps/api/src/modules/lumi/lumi.routes.test.ts`)

```ts
describe('POST /v1/lumi/voice/sessions — 5-S16 cap', () => {
  it('returns 429 when user is at or over the weekly voice cap', async () => {
    // mock voiceUsageRepository.getWeeklyUsage → 600_000
    // inject app + send POST /v1/lumi/voice/sessions with valid auth + body
    // assert response.statusCode === 429
    // assert body.code === 'voice_cap_reached'
  });

  it('201 when usage is under cap', async () => {
    // mock voiceUsageRepository.getWeeklyUsage → 0
    // assert response.statusCode === 201
  });
});
```

> **Test file size awareness**: `lumi.routes.test.ts` may already be large. Add these as a `describe` block at the end of the file. If the file exceeds 300 lines, create a companion `lumi.routes.cap.test.ts` and note the split.

#### 7e. Web hook test (add to `apps/web/src/hooks/useLumiVoiceSession.test.ts` or equivalent)

```ts
it('sets capReached when session creation returns 429', async () => {
  // mock POST /v1/lumi/voice/sessions → status 429, body { code: 'voice_cap_reached' }
  // render with the hook; trigger session start
  // assert capReached === true
  // assert WS was never opened
});

it('sets capReached on voice_cap_reached WS error frame', async () => {
  // mock successful session creation
  // mock WS message: { type: 'error', code: 'voice_cap_reached', message: '...' }
  // assert capReached === true
});
```

---

## Deferred Work

| ID | Item |
|---|---|
| D-5S16-1 | Concurrent voice sessions from the same user race on `voice_usage` increment. The `increment_voice_usage` RPC handles atomicity at the DB level, but a user with two simultaneous WS sessions could each read the usage below cap before either increments. Acceptable at beta scale. Epic 8 subscription tier lookup makes this moot (tier enforcement at subscription layer). |
| D-5S16-2 | `getWeekStart()` / `STANDARD_TIER_CAP_MS` are duplicated between `lumi.service.ts` and `lumi.routes.ts`. Extract to `apps/api/src/common/voice-tier.ts` in a cleanup slice or Epic 8 when the full tier config model lands. |
| D-5S16-3 | Remaining quota display ("8 min 42 sec remaining this week") — deferred to Epic 8. No UI beyond the cap error copy is shipped in this slice. |
| D-5S16-4 | Retroactive usage backfill for 5-S5/5-S5b voice turns — those rows have no WAV buffer reference; start fresh. Prior-week usage is zero in `voice_usage` until this slice ships. |

Add these to `_bmad-output/implementation-artifacts/deferred-work.md`.

---

## Key Reconciliations (pre-empting dev traps)

1. **`WsErrorCodeSchema` is in `voice.ts`, not `lumi.ts`**. Both the onboarding and ambient Lumi voice pipelines share this enum. Adding `voice_cap_reached` to `voice.ts` is correct — confirm the import path in `lumi.service.ts` (it should come from `@hivekitchen/contracts` via the existing `WsError` type, not from a lumi-specific schema).

2. **`voiceUsageRepository` is OPTIONAL in `LumiServiceDeps`**. This is mandatory — `lumi-nudge.job.ts` creates a `LumiService` for text-only nudge generation and must not need a voice usage repo. The job uses `submitTextTurn` (not `processVoiceUtterance`), so the cap check never fires on the code path the nudge job takes.

3. **Cap check is OUTSIDE the `try...finally` block and BEFORE `state.isProcessing = true`**. If the cap check returns early, `isProcessing` is never set — the user can try again on a future utterance (not that it helps when they're over cap, but avoids a stuck lock state). Verify the insertion point in `processVoiceUtterance` carefully: it goes after the `MAX_AUDIO_BYTES` guard and before the `state.isProcessing = true` assignment.

4. **Usage increment is fire-and-forget**. The `.catch()` call on the returned promise prevents an unhandled rejection from breaking tests. In Vitest, use `await new Promise((r) => setTimeout(r, 0))` to let the microtask queue drain before asserting the increment was called. Alternatively, make the increment `await`-ed and wrap it in a `try/catch` for testability — either is acceptable; be consistent with what's in `lumi.service.ts`.

5. **`estimateWavDurationMs` reads the WAV header bytes directly**. The `@ricky0123/vad-react` library outputs 16kHz 16-bit mono WAV by default — meaning `sampleRate=16000, numChannels=1, bitsPerSample=16` → `bytesPerSecond=32000`. A 1-second utterance = 44 + 32000 = 32044 bytes. For a 10-min cap: `600_000 ms = 600 s × 32000 bytes/s = 19.2 MB` of audio (in theory). In practice, individual utterances are < 30s each, so WAV buffers are < ~1 MB — well below `MAX_AUDIO_BYTES` (2 MB). If the browser uses a different sample rate, the header bytes still give the right answer since we read them from the actual WAV header, not hardcode.

6. **`POST /v1/lumi/voice/sessions` 429 response format**. Fastify does NOT automatically serialize a `reply.status(429).send({...})` call through its Zod schema — the response schema in the route definition only covers the 201 path. The 429 body is sent as raw JSON. The web client reads `status === 429` from `hkFetch`'s error throw — confirm this by looking at how `hkFetch` propagates non-2xx responses (likely throws `{ status: number, body: {...} }` or an `HkApiError` class). Match whatever the existing pattern is.

7. **`lumi.routes.ts` already imports `UserRepository`** (added in 5-S15). The `VoiceUsageRepository` import follows the same pattern. The instantiation `const voiceUsageRepository = new VoiceUsageRepository(fastify.supabase)` goes alongside the other repository instantiations in the `lumiRoutes` plugin body (lines 48–77 of the current file).

8. **`getWeeklyUsage` uses `.maybeSingle()`** not `.single()`. If no row exists for the current week (e.g., a new week just started), `.maybeSingle()` returns `{ data: null, error: null }` → the function returns `0`. Using `.single()` would throw on "no rows" — wrong behavior here.

9. **Existing `buildDeps` in `lumi.service.test.ts` must be updated** to include `voiceUsageRepository`. Because it's optional, the `buildDeps` mock can still omit it to test the "no-cap" path, OR include it with all methods mocked to `vi.fn().mockResolvedValue(0)` for the new cap tests. Check what pattern the existing tests use and match it. From reading the test file structure, `buildDeps` takes options and constructs a mock `LumiService` — extend it to optionally include `voiceUsageRepository`.

10. **Text turns (`POST /v1/lumi/turns`)** call `submitTextTurn` directly, which has no cap logic. Do NOT add any cap check to `submitTextTurn` — text turns are explicitly unlimited (AC6). The cap only gates `processVoiceUtterance` (WS binary frames) and the session creation pre-check.

---

## Previous Story Intelligence (from 5-S15)

- **`voiceTranscriptRepository` as optional dep** established the pattern: optional deps in `LumiServiceDeps` have `?` suffix, are absent in the nudge-job ctor, and guarded with `if (this.deps.fooRepo)` at use sites. Follow this exactly for `voiceUsageRepository`.
- **`UserRepository` in `lumi.routes.ts`**: imported at line 17, instantiated with `new UserRepository(fastify.supabase)` inside the WS async handler. `VoiceUsageRepository` follows the same import+instantiate pattern at the plugin scope (not inside the WS handler — it's needed at session creation too).
- **Fire-and-forget with `.catch()`**: the transcript insert in 5-S15 used `try { await ... } catch { logger.warn(...) }`. For the usage increment, fire-and-forget is more appropriate (the increment must never delay the TTS streaming). Use `.catch()` on the returned promise.
- **Zod 4 confirmed** — `z.enum([...])` is valid. `WsErrorCodeSchema` already uses this pattern.
- **Checkbox toggle / account.tsx patterns**: NOT relevant to this slice — no account UI is shipped.
- **`hkFetch` JSON body**: always a raw object, no double-stringify. Relevant only to the web hook update.
- **Pre-existing failing tests baseline**: API 20f/13skip, web 2f, contracts 7f — do NOT fix them.
- **Typecheck baselines**: API 12, web 7, contracts 1, types 1 — zero new errors is the gate.
- **UUID fixture format**: use `'00000000-0000-4000-8000-<12digits>'` (variant nibble `8` = valid RFC-4122). Zod 4 `.uuid()` rejects the old `…-8444-…` format.

---

## File List (predicted)

**New**
- `supabase/migrations/20261024000000_create_voice_usage.sql`
- `apps/api/src/modules/voice/voice-usage.repository.ts`
- `apps/api/src/modules/voice/voice-usage.repository.test.ts`

**Modified**
- `packages/contracts/src/voice.ts` — add `'voice_cap_reached'` to `WsErrorCodeSchema`
- `packages/contracts/src/voice.test.ts` — add `voice_cap_reached` to known-codes test
- `apps/api/src/modules/lumi/lumi.service.ts` — `LumiServiceDeps.voiceUsageRepository?`, `STANDARD_TIER_CAP_MS`, `VOICE_CAP_COPY`, `getWeekStart()`, `estimateWavDurationMs()`, cap check + increment in `processVoiceUtterance`, `VoiceUsageRepository` import
- `apps/api/src/modules/lumi/lumi.service.test.ts` — `voiceUsageRepository` mock in `buildDeps` + 3 new test cases
- `apps/api/src/modules/lumi/lumi.routes.ts` — `VoiceUsageRepository` import + instantiation + service wiring + 429 pre-check in session creation handler
- `apps/api/src/modules/lumi/lumi.routes.test.ts` — 2 new test cases (or companion file)
- `apps/web/src/hooks/useLumiVoiceSession.ts` — `capReached` state + 429 handler + WS `voice_cap_reached` handler
- `apps/web/src/hooks/useLumiVoiceSession.test.ts` — 2 new test cases
- `_bmad-output/implementation-artifacts/deferred-work.md` — D-5S16-1 through D-5S16-4

---

## Baselines (from 5-S15 done state)

| Suite | Baseline |
|---|---|
| Contracts | 755p / 7f |
| API | 1797p / 20f / 13skip |
| Web | 571p / 2f |
| Typecheck | API 12 / web 7 / contracts 1 / types 1 |

**Gate:** Zero new test failures, zero new typecheck errors.

**USER-SIDE GATE:** `supabase db push --include-all` (migration `20261024000000`) before any live demo or integration test.

---

## Dev Agent Record

### Agent Model Used
claude-sonnet-4-6 (create-story); claude-opus-4-8 (dev-story)

### Completion Notes List

All 11 ACs satisfied. Implementation followed the story spec with four deliberate, documented deviations:

1. **Cap check moved INSIDE the `try/finally`** (story Key Reconciliation #3 said "outside, before `state.isProcessing = true`"). The story's placement put an `await` (the `getWeeklyUsage` DB read) *before* the `isProcessing` lock was set, which defeats the single-flight guard: two rapid utterances would both pass the `isProcessing === false` check before either set the lock, and an existing test (`drops a concurrent frame while a turn is already in flight`) failed (transcribeWav called twice). Fix: set `isProcessing = true` first, run the cap check as the first statement inside the `try` block. The `finally` still releases the lock, so a cap-reached early return never leaves it stuck — satisfying the story's stated intent without the concurrency regression. (AC4 still met; single-flight preserved.)

2. **Shared `apps/api/src/common/voice-tier.ts`** created for `STANDARD_TIER_CAP_MS`, `VOICE_CAP_COPY`, and `getWeekStart()`, imported by both `lumi.service.ts` and `lumi.routes.ts`. This is the story's own "best approach" recommendation (Task 5 note) and **resolves D-5S16-2 in-slice** — the cap value and the user-facing copy cannot drift between the WS gate (AC4) and the session pre-check (AC2). `estimateWavDurationMs()` stayed in `lumi.service.ts` (single use).

3. **429 response schema declared** (`VoiceCapReachedResponseSchema`, inline in `lumi.routes.ts`). The story said no schema was needed, but `fastify-type-provider-zod` narrows `reply.status()` to the declared response codes, so `reply.status(429)` was a type error against a `{ 201 }`-only response map. Declaring the 429 shape (`statusCode`/`error`/`message`/`code`) keeps the typed reply legal and serializes the exact AC2 body. The web client still routes on `status === 429` only.

4. **RLS added to the migration** (`ENABLE ROW LEVEL SECURITY` + `voice_usage_owner_select_policy` scoped to `user_id = auth.uid()`). The story SQL omitted RLS, but every sibling voice table (`voice_transcripts`) has it, and `voice_usage` holds per-user data — leaving a new table without RLS in an RLS-enforced schema is a security gap (project-context "Don't weaken RLS"). The service-role client bypasses RLS for writes, so the API path is unaffected.

Cap check + increment are both fail-open / best-effort (an unreachable `voice_usage` table never blocks a turn). The increment is fire-and-forget with `.catch()` and only fires when `estimateWavDurationMs(wav) > 0` (skips sub-header buffers). Text turns (`submitTextTurn` / `POST /v1/lumi/turns`) carry no cap logic (AC6). `voiceUsageRepository` is optional in `LumiServiceDeps` so the nudge-job ctor is unchanged.

**Verification:** Contracts 755p/7f, API 1807p/20f/13skip (1797p baseline + 10 new tests, 0 new failures), Web 573p/2f (571p baseline + 2 new tests, 0 new failures). Typecheck: API src 12 / web 7 / contracts 1 / types 1 — zero new errors. No new deps.

**USER-SIDE GATE:** `supabase db push --include-all` (migration `20261024000000`) before any live demo or integration test.

### File List

**New**
- `supabase/migrations/20261024000000_create_voice_usage.sql`
- `apps/api/src/common/voice-tier.ts`
- `apps/api/src/modules/voice/voice-usage.repository.ts`
- `apps/api/src/modules/voice/voice-usage.repository.test.ts`

**Modified**
- `packages/contracts/src/voice.ts` — `'voice_cap_reached'` added to `WsErrorCodeSchema`
- `packages/contracts/src/voice.test.ts` — `voice_cap_reached` added to the known-codes test
- `apps/api/src/modules/lumi/lumi.service.ts` — `LumiServiceDeps.voiceUsageRepository?` + field/ctor, `estimateWavDurationMs()`, cap check + fire-and-forget increment in `processVoiceUtterance`, imports from `common/voice-tier.js`
- `apps/api/src/modules/lumi/lumi.service.test.ts` — `voiceUsageRepository` mock in `buildDeps` + `makeWavBuffer()` helper + 3 new cases
- `apps/api/src/modules/lumi/lumi.routes.ts` — `VoiceUsageRepository` import/instantiation/wiring, `getWeekStart`/`STANDARD_TIER_CAP_MS`/`VOICE_CAP_COPY` imports, `VoiceCapReachedResponseSchema`, 429 pre-check in `POST /voice/sessions`
- `apps/api/src/modules/lumi/lumi.routes.test.ts` — `voice_usage` table in mock supabase + `voiceUsageMsConsumed` opt + 2 new cases (429 / under-cap 201)
- `apps/web/src/hooks/useLumiVoiceSession.ts` — `capReached` state + `VOICE_CAP_COPY`, 429 handler at session creation, `voice_cap_reached` WS-frame handler, `capReached` in return shape
- `apps/web/src/hooks/useLumiVoiceSession.test.ts` — 2 new cases (429 session creation / WS cap frame)
- `_bmad-output/implementation-artifacts/deferred-work.md` — D-5S16-1 / -2 (resolved) / -3 / -4

### Review Findings

- [x] [Review][Patch] Redundant index on `(user_id, week_start)` duplicates primary key B-tree — removed `CREATE INDEX idx_voice_usage_user_week` [`supabase/migrations/20261024000000_create_voice_usage.sql`]
- [x] [Review][Patch] `capReached` never reset at `startSession` entry — added `setCapReached(false)` at top of `startSession` before re-entrancy flags release [`apps/web/src/hooks/useLumiVoiceSession.ts`]
- [x] [Review][Patch] `getWeekStart()` called twice per utterance — captured as `const weekStart = getWeekStart()` before the first `if (this.voiceUsageRepository)` block; reused in both cap check and increment [`apps/api/src/modules/lumi/lumi.service.ts`]
- [x] [Review][Patch] AC11 gap: added route test `201 even when weekly voice usage is at the cap (AC6)` confirming text turns return 200 at cap [`apps/api/src/modules/lumi/lumi.routes.test.ts`]
- [x] [Review][Patch] AC8/AC11 gap: added `apps/api/src/common/voice-tier.test.ts` with 5 boundary cases (Monday, Sunday, Wednesday, Saturday, week-rollover tick)
- [x] [Review][Defer] TOCTOU: HTTP session pre-check + first WS utterance both pass near-cap boundary — deferred, aligns with D-5S16-1 (acceptable at beta scale)
- [x] [Review][Defer] WAV overcount: `buf.length - 44` includes trailing metadata chunks (JUNK/LIST/id3) — deferred, theoretical (vad-react outputs clean minimal PCM WAV without trailing chunks)
- [x] [Review][Defer] Multi-tab concurrent sessions each see their own `isProcessing` lock — two tabs can both pass the cap check and double-increment — deferred, aligns with D-5S16-1
- [x] [Review][Defer] VAD continues sending frames after `voice_cap_reached` WS frame — server correctly re-rejects each but fires repeated `voiceError` store updates — deferred, UX polish; consuming component should disable mic on `capReached`
- [x] [Review][Defer] `VOICE_CAP_COPY` string duplicated between `voice-tier.ts` (API) and `useLumiVoiceSession.ts` (web) — inherent to monorepo separation; 429 path uses local copy, WS path uses server message — deferred to Epic 8 tier-config centralization

### Change Log

| Date | Change |
|---|---|
| 2026-06-09 | Story file authored (5-S16 voice tier cap). |
| 2026-06-09 | Implemented (dev-story): migration + RLS, shared voice-tier helper, VoiceUsageRepository, LumiService cap check + usage increment, routes 429 pre-check, web capReached. All 11 ACs; baselines held; zero new typecheck errors. Status → review. |
| 2026-06-09 | Code review complete (3-layer adversarial): 5 patches applied, 5 deferred, 6 dismissed. Status → done. |
