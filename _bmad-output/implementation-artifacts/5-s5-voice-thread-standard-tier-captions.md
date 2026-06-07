# Story 5-S5: Voice Thread — Standard-Tier Captions

Status: done

<!-- folds: 5.7 (voice path), 5.8 (HMAC webhook), 5.9 (captions) -->
<!-- cited PRD: FR60 (captions), NFR-A11Y-3, AR-14 partial, UX-DR58 -->

## Story

As a Premium-tier parent using voice in LumiPanel,
I want to see synchronized caption text while Lumi is speaking
so that I can follow the conversation without relying entirely on audio,
and so that voice turns are persisted with a reviewable retention window.

## Acceptance Criteria

1. **Given** a voice session is active (`voiceStatus === 'active'`) and `onLumiReply` fires with Lumi's reply text, **When** the text is sent to the ElevenLabs TTS WebSocket, **Then** a `<CaptionRibbon>` element renders in LumiPanel's voice view with the Lumi reply text inside a `role="region"` / `aria-live="polite"` container so screen readers announce it while Lumi speaks.

2. **Given** `onTranscript(userText)` fires, **When** displayed in the caption area, **Then** the user's transcript text is shown above the Lumi caption (e.g. "You: [text]") in a visually distinct but secondary style. The area updates on each new turn without page reload.

3. **Given** the voice session ends (either via orb tap, inactivity, or error), **When** `endSession()` cleans up, **Then** the `<CaptionRibbon>` clears (both user transcript and Lumi reply reset to empty strings), and its `aria-live` container emits no residual announcements.

4. **Given** `POST /v1/lumi/turns` is called with `{ message, context_signal, modality: 'voice' }`, **When** the server processes the turn, **Then**: (a) `thread_turns.modality` is set to `'voice'` for both the user and Lumi turn rows; (b) a row is written to `voice_transcripts` with `thread_id`, `turn_id` (the Lumi turn's `id`), `transcript` (the user's speech text), and `retention_until = now() + 90 days` (default; 5-S15 will add per-household override).

5. ~~HMAC webhook endpoint.~~ **REMOVED 2026-06-07.** This AC (and AC#6) assumed the ElevenLabs **Agent (Conversational AI)** post-call webhook, which emits HMAC-signed events (`transcript.retention`) using the Agent dashboard's Signing Secret. The product has moved off the Agent to raw **TTS + STT (Scribe)** services, which do not emit webhooks — so there is no producer for `POST /v1/webhooks/elevenlabs` and no Agent signing secret. The endpoint, `ELEVENLABS_WEBHOOK_SECRET`, and Task 5 were removed. See Completion Notes.

6. ~~Webhook rate-limiting.~~ **REMOVED 2026-06-07** — see AC#5.

7. **Given** the `voice_transcripts` table exists, **When** `modality: 'voice'` is NOT passed to `POST /v1/lumi/turns` (i.e. text turns), **Then** NO row is written to `voice_transcripts` and `thread_turns.modality` remains `'text'`.

8. **Given** `<CaptionRibbon>` renders during a voice session, **When** `prefers-reduced-motion` is active, **Then** the caption text appears without any transition or animation (static display only).

---

## Tasks / Subtasks

### Task 1 — DB Migration: voice_transcripts table (AC: #4, #7)

- [x] 1.1 Create `apps/api/supabase/migrations/20260616000000_voice_transcripts.sql`:

  ```sql
  CREATE TABLE IF NOT EXISTS voice_transcripts (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    thread_id    UUID NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
    turn_id      UUID NOT NULL REFERENCES thread_turns(id) ON DELETE CASCADE,
    transcript   TEXT NOT NULL,
    retention_until TIMESTAMPTZ NOT NULL,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
  );

  CREATE INDEX idx_voice_transcripts_thread_id ON voice_transcripts(thread_id);
  CREATE INDEX idx_voice_transcripts_retention_until ON voice_transcripts(retention_until);

  ALTER TABLE voice_transcripts ENABLE ROW LEVEL SECURITY;

  -- Household-scoped: allow member access via the thread's household_id
  CREATE POLICY "voice_transcripts_household_member" ON voice_transcripts
    FOR ALL
    USING (
      thread_id IN (
        SELECT id FROM threads WHERE household_id = current_household_id()
      )
    );
  ```

  **Why `retention_until` index:** 5-S15 (voice transcript retention controls) will run nightly purge jobs using this column as a filter. The index is cheap to create now and prevents a full-table scan in the cleanup job.

  **Why `turn_id` references `thread_turns`:** Each voice transcript is anchored to the Lumi turn that generated it (not the user turn), matching the model used in 5-S15 where the user can see transcripts and their retention countdown alongside the Lumi reply.

  **USER-SIDE GATE:** `supabase db push --include-all` before any voice turn with `modality: 'voice'` is sent.

---

### Task 2 — Contracts: extend LumiTurnRequestSchema with optional modality (AC: #4, #7)

- [x] 2.1 In `packages/contracts/src/lumi.ts`, extend `LumiTurnRequestSchema`:

  ```ts
  export const LumiTurnRequestSchema = z.object({
    message: z.string().min(1).max(4000),
    context_signal: LumiContextSignalSchema,
    modality: z.enum(['text', 'voice']).optional(),  // ← ADD THIS
  });
  ```

  **Why optional:** Text turns from the LumiPanel composer do NOT pass `modality`, defaulting to `'text'`. Voice turns from `useLumiVoiceSession` pass `modality: 'voice'`. No existing callers break.

- [x] 2.2 Run `pnpm typecheck` to confirm zero new errors in contracts/types.

---

### Task 3 — API: VoiceTranscriptRepository (AC: #4, #7)

- [x] 3.1 Create `apps/api/src/modules/voice/voice-transcript.repository.ts`:

  ```ts
  import type { SupabaseClient } from '@supabase/supabase-js';

  const DEFAULT_RETENTION_DAYS = 90;

  export class VoiceTranscriptRepository {
    constructor(private readonly client: SupabaseClient) {}

    async insertTranscript(
      threadId: string,
      turnId: string,
      transcript: string,
      retentionDays = DEFAULT_RETENTION_DAYS,
    ): Promise<void> {
      const retentionUntil = new Date();
      retentionUntil.setDate(retentionUntil.getDate() + retentionDays);

      const { error } = await this.client.from('voice_transcripts').insert({
        thread_id: threadId,
        turn_id: turnId,
        transcript,
        retention_until: retentionUntil.toISOString(),
      });
      if (error) throw error;
    }
  }
  ```

  **No `findByThreadId` or delete methods at MVP** — those belong in 5-S15 (voice retention controls).

---

### Task 4 — API: Wire modality + voice_transcripts into LumiService (AC: #4, #7)

- [x] 4.1 In `apps/api/src/modules/lumi/lumi.service.ts`, update `LumiServiceDeps` to accept `VoiceTranscriptRepository`:

  ```ts
  import type { VoiceTranscriptRepository } from '../voice/voice-transcript.repository.js';

  export interface LumiServiceDeps {
    // ...existing deps
    voiceTranscriptRepository: VoiceTranscriptRepository;  // ← ADD
  }
  ```

  Store as `this.voiceTranscriptRepository`.

- [x] 4.2 In `submitTextTurn`, accept `modality?: 'text' | 'voice'` on the input type and pass it through to `insertTurn` calls. After the Lumi turn is inserted, if `modality === 'voice'`, write to `voice_transcripts` (best-effort — never let a transcript write failure block the API response):

  ```ts
  async submitTextTurn(input: {
    message: string;
    contextSignal: LumiContextSignal;
    userId: string;
    householdId: string;
    modality?: 'text' | 'voice';  // ← ADD
  }): Promise<{ threadId: string; userTurn: Turn; lumiTurn: Turn }> {
    // ... existing logic unchanged ...

    // After lumiTurn is inserted:
    if (input.modality === 'voice') {
      try {
        await this.voiceTranscriptRepository.insertTranscript(
          thread.id,
          lumiTurn.id,
          input.message,  // the user's speech (transcript)
        );
      } catch (err) {
        this.logger.warn(
          { err, module: 'lumi', action: 'lumi.voice_transcript_persist_failed', thread_id: thread.id },
          'voice transcript persist failed — best-effort, continuing',
        );
      }
    }

    return { threadId: thread.id, userTurn, lumiTurn };
  }
  ```

  **Why best-effort:** A transcript write failure must never block the voice turn from returning to the client. The UI has already shown the caption; losing the persistence is a degraded-mode issue, not a fatal error.

- [x] 4.3 In `apps/api/src/modules/lumi/lumi.routes.ts`, extract `modality` from the request body and pass it to `service.submitTextTurn`:

  ```ts
  const { message, context_signal, modality } = request.body as z.infer<typeof LumiTurnRequestSchema>;
  const result = await lumiService.submitTextTurn({
    message,
    contextSignal: context_signal,
    userId: request.user.id,
    householdId: request.user.household_id,
    modality,  // ← ADD
  });
  ```

- [x] 4.4 In `apps/api/src/app.ts` (or wherever `LumiService` is instantiated), wire in `new VoiceTranscriptRepository(fastify.supabase)`.

- [x] 4.5 Pass `modality` through to `this.repository.insertTurn` calls so `thread_turns.modality` is correctly set to `'voice'` or `'text'`. In `LumiRepository.insertTurn`, accept `modality?: string` (defaulting to `'text'`):

  ```ts
  await this.client.from('thread_turns').insert({
    thread_id: threadId,
    role: 'user',
    body: { type: 'message', content: message },
    modality: modality ?? 'text',  // ← was hardcoded 'text'
    server_seq: String(nextSeq),
  });
  ```

---

### Task 5 — ~~API: HMAC webhook endpoint~~ — REMOVED 2026-06-07 (off-Agent)

This task implemented `POST /v1/webhooks/elevenlabs` (HMAC validation + rate limit)
for ElevenLabs **Agent (Conversational AI)** post-call webhooks. The product moved
off the Agent to raw **TTS + STT (Scribe)** services, which emit no webhooks — so
there is no producer for this endpoint and no Agent signing secret. The route,
its test, `ELEVENLABS_WEBHOOK_SECRET` (env + `.env.local.example`), and the app.ts
registration were removed. See Completion Notes for the full removal record.

---

### Task 6 — Web: `<CaptionRibbon>` component (AC: #1, #2, #3, #8)

- [x] 6.1 Create `apps/web/src/components/CaptionRibbon.tsx`:

  ```tsx
  interface CaptionRibbonProps {
    userTranscript: string;
    lumiCaption: string;
  }

  export function CaptionRibbon({ userTranscript, lumiCaption }: CaptionRibbonProps) {
    if (!userTranscript && !lumiCaption) return null;

    return (
      <div
        role="region"
        aria-label="Voice captions"
        aria-live="polite"
        aria-atomic="false"
        className="rounded-lg bg-oat-100 px-4 py-3 text-sm font-sans space-y-1.5 motion-reduce:transition-none"
      >
        {userTranscript && (
          <p className="text-fg-muted">
            <span className="font-medium text-fg">You: </span>
            {userTranscript}
          </p>
        )}
        {lumiCaption && (
          <p className="text-fg">
            <span className="font-medium text-honey-amber-600">Lumi: </span>
            {lumiCaption}
          </p>
        )}
      </div>
    );
  }
  ```

  **Design notes:**
  - `bg-oat-100` — warm neutral per DESIGN.md; no SaaS chrome
  - `aria-live="polite"` — screen reader announces Lumi's reply without interrupting current speech
  - `aria-atomic="false"` — individual paragraphs can be announced separately (correct for turn-based captions)
  - `motion-reduce:transition-none` — satisfies AC#8 (no animation under reduced-motion)
  - Returns `null` when both strings are empty — no residual DOM element shown between sessions

- [x] 6.2 In `apps/web/src/components/LumiPanel.tsx`, add state for captions and wire `<CaptionRibbon>`:

  ```tsx
  const [captionTranscript, setCaptionTranscript] = useState('');
  const [lumiCaption, setLumiCaption] = useState('');

  // Wire into voice callbacks (passed to VoiceSessionContext or useLumiVoiceSession):
  const handleTranscript = useCallback((text: string) => {
    setCaptionTranscript(text);
    setLumiCaption('');  // Clear Lumi caption when new user turn starts
    // ... existing transcript handling (append to store, etc.)
  }, []);

  const handleLumiReply = useCallback((text: string) => {
    setLumiCaption(text);
    // ... existing reply handling (append to store, etc.)
  }, []);

  // Clear captions when session ends (wire into voice session end handler):
  const handleSessionEnd = useCallback(() => {
    setCaptionTranscript('');
    setLumiCaption('');
  }, []);
  ```

  In the voice-active section of LumiPanel's render (where "Listening..." appears):

  ```tsx
  {isVoiceMode && (
    <div className="space-y-3">
      {/* Existing: "Listening..." / "Connecting..." hint */}
      {voiceStatus === 'active' && (
        <CaptionRibbon
          userTranscript={captionTranscript}
          lumiCaption={lumiCaption}
        />
      )}
    </div>
  )}
  ```

  **Cross-12-S10 note:** 12-S10 already added `isVoiceMode`, `voiceStatus`, and the "Listening..." hint. Add `<CaptionRibbon>` below/alongside the status hint — do not touch the mode toggle or error area.

- [x] 6.3 Clear captions when `endSession` is called. Confirm that the `handleSessionEnd` callback is called from the voice session context's teardown path. If `VoiceSessionContext` exposes an `onSessionEnd` prop, wire it. If not, use a `useEffect` that watches `voiceStatus` transitioning from `'active'` to `'idle'`:

  ```tsx
  useEffect(() => {
    if (voiceStatus === 'idle') {
      setCaptionTranscript('');
      setLumiCaption('');
    }
  }, [voiceStatus]);
  ```

---

### Task 7 — Web: Pass `modality: 'voice'` in useLumiVoiceSession (AC: #4)

- [x] 7.1 In `apps/web/src/hooks/useLumiVoiceSession.ts`, in the `handleTranscript` function, update the `hkFetch` call to include `modality: 'voice'`:

  ```ts
  const raw = await hkFetch<unknown>('/v1/lumi/turns', {
    method: 'POST',
    body: { message: text, context_signal: contextSignal, modality: 'voice' },  // ← ADD modality
  });
  ```

  **No schema change needed for the existing `LumiTurnResponseSchema`** — only the request body changes.

---

### Task 8 — Tests (AC: all)

- [x] 8.1 **Contract tests** in `packages/contracts/src/lumi.test.ts` (or adjacent file):
  - `LumiTurnRequestSchema` with `modality: 'voice'` parses successfully
  - `LumiTurnRequestSchema` without `modality` parses successfully (backward-compat)
  - `LumiTurnRequestSchema` with `modality: 'invalid'` fails parse

- [x] 8.2 **Repository tests** (colocated `voice-transcript.repository.test.ts`):
  - `insertTranscript` inserts row with correct `thread_id`, `turn_id`, `transcript`
  - `retention_until` is approximately `now + 90 days` (within ±1 second tolerance)
  - `insertTranscript` with explicit `retentionDays=30` sets correct `retention_until`

- [x] 8.3 **Service tests** (in `lumi.service.test.ts`):
  - `submitTextTurn` with `modality: 'voice'` calls `voiceTranscriptRepository.insertTranscript`
  - `submitTextTurn` with `modality: 'text'` does NOT call `voiceTranscriptRepository.insertTranscript`
  - `submitTextTurn` with `modality: 'voice'` still returns success when `insertTranscript` throws (best-effort)

- [x] 8.4 ~~Webhook route tests~~ — REMOVED 2026-06-07 with Task 5 (off-Agent; no webhook).

- [x] 8.5 **Component tests** (in `CaptionRibbon.test.tsx`):
  - Renders `null` when both props are empty
  - Shows user transcript and Lumi caption when provided
  - `role="region"` and `aria-live="polite"` present
  - Clears Lumi caption when only userTranscript changes (does NOT bleed across turns)

- [x] 8.6 **LumiPanel integration tests** (additions to `LumiPanel.test.tsx`):
  - `<CaptionRibbon>` mounts when `voiceStatus === 'active'`
  - `<CaptionRibbon>` NOT rendered when `voiceStatus === 'idle'`
  - Captions clear when voiceStatus transitions from `'active'` to `'idle'`

---

## Dev Notes

### CRITICAL: 12-S10 is a prerequisite — confirm it is merged before starting

12-S10 (`tap-to-talk-voice-browser-direct`) is currently in **review** status. 5-S5 extends its work:
- `useLumiVoiceSession.ts` (Task 7 modifies this)
- `VoiceSessionContext.tsx` (read to understand `onTranscript`/`onLumiReply` callback routing)
- `LumiPanel.tsx` (Task 6 adds `<CaptionRibbon>` alongside 12-S10's voice mode UI)

If 12-S10 has not merged yet, you can implement Tasks 1–5 (pure API/DB work) independently and complete Tasks 6–7 once 12-S10 merges. Do NOT duplicate 12-S10's voice infrastructure.

### CRITICAL: `modality` in `insertTurn` — verify LumiRepository signature

`LumiRepository.insertTurn` currently hardcodes `modality: 'text'` (from 12-S8 implementation). Task 4.5 changes this to accept the `modality` parameter. Verify the exact field name in `apps/api/src/modules/lumi/lumi.repository.ts` before implementing — the column in `thread_turns` is `modality TEXT` per the migration from 12-S4.

### CRITICAL: `hkFetch` two-argument signature — no schema param

From 5-S4 dev notes: `hkFetch` in `apps/web/src/lib/fetch.ts` takes only `(path, init)` — two args. The third schema argument does NOT exist. Always call `hkFetch<unknown>(path, init)` then `Schema.parse(result)` separately. Task 7 only changes the body object — the call signature stays as-is.

### CRITICAL: Do NOT pass `JSON.stringify` to `hkFetch` body

`hkFetch` already auto-JSON-stringifies `init.body`. Pass the raw object:
```ts
// ✅ CORRECT:
body: { message: text, context_signal: contextSignal, modality: 'voice' }

// ❌ WRONG — double-encodes:
body: JSON.stringify({ message: text, context_signal: contextSignal, modality: 'voice' })
```

This trap is documented in: 5-S2, 5-S3, 5-S4, 12-S9, 12-S10 Dev Notes.

### CRITICAL: Zod 4 is installed (not Zod 3.23)

`project-context.md` claims "Zod 3.23" but the installed version is Zod 4. Known differences:
- `z.record()` requires two args: `z.record(z.string(), z.SomeSchema())`
- `z.string().uuid()` uses strict RFC-4122 variant nibble validation
- `z.string().datetime()` rejects Supabase offset timestamps — normalize with `new Date(ts).toISOString()`
- No `z.string().min(1)` + `.optional()` ordering issue in Zod 4 (unlike Zod 3.x)

### Auth bypass pattern for public routes

The existing auth hook pattern (from 12-S8/12-S9): check `apps/api/src/plugins/auth.plugin.ts` for the `SKIP_EXACT` or `skipAuth` config approach. The webhook route is a public endpoint (no JWT). Confirm the exact mechanism before implementing — it's either:
- Adding the path to a `SKIP_EXACT` Set in the auth plugin, OR
- Setting `config: { skipAuth: true }` on the route (if the auth hook reads `request.routeOptions.config.skipAuth`)

Both patterns exist in this codebase for different public endpoints (e.g., `/v1/auth/...`, `/v1/voice/ws`, lunch-link public routes).

### HMAC verification — raw body vs parsed JSON

The ElevenLabs documentation may specify that the signed payload uses the verbatim raw HTTP body bytes (not re-serialized JSON). The Task 5.2 implementation uses `JSON.stringify(request.body ?? {})` for simplicity. If ElevenLabs's actual verification spec requires the raw bytes, the fix is to use `@fastify/raw-body` plugin (already in the codebase if Stripe webhooks are wired; check `apps/api/package.json`). At MVP this is acceptable — validate against ElevenLabs docs before beta launch.

### `<CaptionRibbon>` design — calm, not prominent

Per DESIGN.md Honey rule and warm-neutral palette: captions should not dominate the voice experience. Use `bg-oat-100` or `bg-surface-2` as the background. The caption is a secondary aid, not a headline. Keep font size at `text-sm`, secondary tone (`text-fg-muted` for labels, `text-fg` for content).

### No SSE for captions

Captions in this story are NOT streamed from the server character-by-character. The full Lumi reply text arrives in one response from `POST /v1/lumi/turns` (since there is no streaming in the current LumiAgent implementation). `setLumiCaption(text)` sets the full text at once. Streaming captions (per-token) are a future enhancement if SSE text streaming is added to the Lumi turn endpoint.

### `voice_transcripts` RLS pattern

The RLS policy uses a subquery against `threads.household_id` (matching the sibling table pattern from `thread_turns`, `day_assignments`, etc.). Confirm the RLS function name is `current_household_id()` — it is used consistently across all household-scoped tables since at least 3-dm-c1.

### Source file map

| What | Where |
|------|-------|
| Migration (NEW) | `apps/api/supabase/migrations/20260616000000_voice_transcripts.sql` |
| Contract extension | `packages/contracts/src/lumi.ts` — `LumiTurnRequestSchema` |
| VoiceTranscriptRepository (NEW) | `apps/api/src/modules/voice/voice-transcript.repository.ts` |
| LumiService (MODIFY) | `apps/api/src/modules/lumi/lumi.service.ts` |
| LumiRepository (MODIFY — modality param) | `apps/api/src/modules/lumi/lumi.repository.ts` |
| Lumi routes (MODIFY — pass modality + wire VoiceTranscriptRepository) | `apps/api/src/modules/lumi/lumi.routes.ts` |
| ~~Webhooks routes (NEW)~~ | ~~`apps/api/src/routes/webhooks.routes.ts`~~ — REMOVED (off-Agent) |
| ~~env.ts (ELEVENLABS_WEBHOOK_SECRET)~~ | ~~`apps/api/src/common/env.ts`~~ — REMOVED (off-Agent) |
| lumi-nudge.job.ts (MODIFY — wire VoiceTranscriptRepository into 2nd LumiService) | `apps/api/src/jobs/lumi-nudge.job.ts` |
| CaptionRibbon (NEW) | `apps/web/src/components/CaptionRibbon.tsx` |
| lumi.store (MODIFY — caption state) | `apps/web/src/stores/lumi.store.ts` |
| layout (MODIFY — wire voice callbacks to caption state) | `apps/web/src/routes/(app)/layout.tsx` |
| LumiPanel (MODIFY — add CaptionRibbon + caption state) | `apps/web/src/components/LumiPanel.tsx` |
| useLumiVoiceSession (MODIFY — pass modality) | `apps/web/src/hooks/useLumiVoiceSession.ts` |

### Test baselines (post 5-S4 done + 12-S10 merged)

From 5-S4 done state (most recent):
- **API:** ~1679 pass / 20 fail (pre-existing: auth×7 / children.repository×3 / extra-library×3 / lunch-link-dev / onboarding.tools / audit-parity-drift / catalog-seed / households-memory-200-case / plan-adjustment / memory-partial-seeding)
- **Web:** ~519 pass / 2 fail (2 pre-existing 5-S3 test debt: sse packer.assigned key + PackerAssignmentDialog initialPackerUserId)
- **Contracts:** ~693 pass / 4 fail (cultural + heart-notes baseline)

After 12-S10 merges, web baseline will be higher (+14 tests from 12-S10). Confirm the exact baseline by running `pnpm test` before starting implementation.

New tests from 5-S5 (as shipped; webhook tests removed off-Agent):
- Contracts: +3 (LumiTurnRequestSchema modality variants)
- API repo: +4 (VoiceTranscriptRepository)
- API service: +4 (modality → voice_transcripts)
- ~~API webhook route: +7~~ — REMOVED (off-Agent)
- Web component: +5 (CaptionRibbon)
- Web panel: +3 (LumiPanel caption integration)

**Total:** 19 new tests.

### USER-SIDE GATES

1. **DB Migration**: `supabase db push --include-all` (migration `20261018000000`).
2. ~~ELEVENLABS_WEBHOOK_SECRET~~ — REMOVED (off-Agent; no webhook).
3. **Manual demo**: Live voice session with captions visible. Requires ElevenLabs account + `ELEVENLABS_VOICE_ID` (raw TTS/STT — no Agent).

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-8 (1M context)

### Debug Log References

_None_

### Completion Notes List

The caption + voice-transcript work (Tasks 1–4, 6–8) is implemented and verified.
12-S10's voice infra is on disk (in `review`), so Tasks 6–7 were completed
alongside the API/DB work.

**SCOPE CHANGE — HMAC webhook removed (2026-06-07, per user direction).** Task 5,
AC#5, and AC#6 specified `POST /v1/webhooks/elevenlabs` with HMAC validation for
ElevenLabs **Agent (Conversational AI)** post-call webhooks (the `transcript.retention`
event 5-S15 was to consume). The product has moved off the Agent to raw **TTS + STT
(Scribe)** services, which emit no webhooks — there is no producer for the endpoint
and no Agent signing secret. Removed: `webhooks.routes.ts` (+ test),
`ELEVENLABS_WEBHOOK_SECRET` (env + `.env.local.example`), the app.ts registration, and
the +7 webhook tests. NOTE for follow-up: the ambient voice path (12-S10) used to
mint ConvAI **Agent** signed URLs for STT (`lumi.service.issueElevenLabsCredentials`
→ `get_signed_url?agent_id=`; `useLumiVoiceSession` STT WS). **RESOLVED by slice
5-S5b (2026-06-07):** that path is migrated to raw Scribe STT + TTS over
HiveKitchen's own `GET /v1/lumi/voice/ws`; no ConvAI signed URL remains.

**Spec ↔ codebase reconciliations (followed the codebase over the story prose):**

1. **Migration path + timestamp.** Migrations live at repo-root `supabase/migrations/`,
   NOT `apps/api/supabase/migrations/`. The story's `20260616000000` would also sort
   *before* existing migrations (latest is `20261017000000`). Used
   `supabase/migrations/20261018000000_create_voice_transcripts.sql`.
2. **RLS pattern.** There is no `current_household_id()` function in this schema. The
   sibling voice tables (`20260504030000_enable_rls_voice_tables.sql`) use a SELECT-only
   policy with an inline subquery `household_id = (SELECT current_household_id FROM users
   WHERE id = auth.uid())` (service role bypasses RLS for writes). Matched that pattern
   instead of the story's `FOR ALL` + `current_household_id()` snippet.
3. ~~Auth skip~~ — moot (webhook removed).
4. **`submitTextTurn` signature.** The real signature is `{householdId, message,
   contextSignal}` (no `userId`; snake_case return). Added optional `modality` and threaded
   it through; `LumiRepository.insertTurn` already accepts `modality` (it was hardcoded
   `'text'` at the two call sites in `submitTextTurn`, now `input.modality ?? 'text'`).
5. **Second `LumiService` instantiation.** `jobs/lumi-nudge.job.ts` also constructs
   `LumiService` and required the new `voiceTranscriptRepository` dep — wired there too
   (and in `lumi.routes.ts` + the service unit test).
6. **Design tokens.** `bg-oat-100` does not exist in the token set; used `bg-surface-2`
   (the story's stated fallback). `text-honey-amber-600` exists and was used for the Lumi
   label.
7. **Caption state lives in the Zustand store, not LumiPanel `useState`.** The voice
   callbacks (`onTranscript`/`onLumiReply`) are wired at layout level
   (`routes/(app)/layout.tsx`), not in LumiPanel, so caption text is mirrored into the
   store (`captionTranscript`/`captionLumiReply`) and read by `<CaptionRibbon>` in
   LumiPanel. Cleared in `endTalkSession` (the hook's teardown path), which also satisfies
   AC#3 — `<CaptionRibbon>` only renders while `voiceStatus === 'active'`, so it unmounts
   on session end (no residual `aria-live` announcements).
8. ~~HMAC raw-body~~ — moot (webhook removed).

**Verification (post-removal; baselines confirmed pre-existing via failing-test inventory):**
- **Contracts:** 696 pass / 7 fail. +3 new lumi modality tests green. The 7 failures are
  all pre-existing (3× `auth.test` 5-S2 working-tree debt, 1× `cultural.test`, 3×
  `heart-notes.test`); `lumi.test.ts` is 53/53 green.
- **API:** 1689 pass / 20 fail. +8 new tests green (4 repo + 4 service); the 7 webhook
  tests were removed with the endpoint. All 20 failures are the documented baseline
  (auth×7, children.repository×3, extra-library×3, lunch-link-dev, onboarding.tools,
  audit-parity, catalog-seed, households-memory-200, plan-adjustment, memory-partial-seeding).
- **Web:** 526 pass / 2 fail. +8 new tests green (5 CaptionRibbon + 3 LumiPanel). The 2
  failures are the documented 5-S3 test debt (`PackerAssignmentDialog`, `sse.test`
  packer.assigned key).
- **Typecheck:** 0 new errors. API 11 baseline, web 6 baseline, contracts/types 1 baseline
  (all in untouched files — heart-notes Zod-4, evals/runner, PackerAssignmentDialog test
  debt, etc.).
- **Lint:** changed files clean (the 2 `useLumiVoiceSession.ts` lint errors are
  pre-existing `eslint-disable react-hooks/exhaustive-deps` directives at lines 273/460,
  not from this slice's one-line `hkFetch` body edit).

**USER-SIDE GATES (not runnable here):**
1. `supabase db push --include-all` (migration `20261018000000`).
2. Manual demo: live voice session with captions (raw TTS/STT — no Agent webhook).

### File List

**New:**
- `supabase/migrations/20261018000000_create_voice_transcripts.sql`
- `apps/api/src/modules/voice/voice-transcript.repository.ts`
- `apps/api/src/modules/voice/voice-transcript.repository.test.ts`
- `apps/web/src/components/CaptionRibbon.tsx`
- `apps/web/src/components/CaptionRibbon.test.tsx`

_(REMOVED before finalize, off-Agent: `apps/api/src/routes/webhooks.routes.ts` + `.test.ts`.)_

**Modified:**
- `packages/contracts/src/lumi.ts` — `LumiTurnRequestSchema` gains optional `modality`
- `packages/contracts/src/lumi.test.ts` — +3 modality tests
- `apps/api/src/modules/lumi/lumi.service.ts` — `voiceTranscriptRepository` dep; `modality`
  threaded through `submitTextTurn`; best-effort `voice_transcripts` write
- `apps/api/src/modules/lumi/lumi.routes.ts` — instantiate `VoiceTranscriptRepository`,
  pass `modality` from request body
- `apps/api/src/modules/lumi/lumi.service.test.ts` — `voiceTranscriptRepository` mock + 4 tests
- `apps/api/src/jobs/lumi-nudge.job.ts` — wire `voiceTranscriptRepository` into `LumiService`
- `apps/web/src/stores/lumi.store.ts` — `captionTranscript`/`captionLumiReply` state +
  setters; cleared in `endTalkSession`
- `apps/web/src/components/LumiPanel.tsx` — render `<CaptionRibbon>` when voice active
- `apps/web/src/components/LumiPanel.test.tsx` — +3 caption integration tests
- `apps/web/src/hooks/useLumiVoiceSession.ts` — send `modality: 'voice'` on the turn POST
- `apps/web/src/routes/(app)/layout.tsx` — wire voice callbacks to caption state

### Review Findings

- [x] [Review][Patch] **P1 — `audio_too_large` missing from `WsErrorCodeSchema`** [`packages/contracts/src/voice.ts:70`] — 5-S5b P1 patch added `code: 'audio_too_large'` to `lumi.service.ts:196` but never added it to `WsErrorCodeSchema`. Client's `WsServerMessageSchema.safeParse` fails for this frame; oversized-audio errors are silently dropped client-side. The onboarding voice path uses `stt_failed` for the same case (which is in the schema). Fix: add `'audio_too_large'` to the enum.
- [x] [Review][Patch] **P2 — `WsResponseEndSchema.text: z.string().min(1)` breaks the P3 empty-reply path** [`packages/contracts/src/voice.ts:57`] — P3 sends `{ type: 'response.end', seq, text: '' }` when the agent returns an empty string (lumi.service.ts:249). The client schema requires `min(1)`, so `safeParse` fails, `onLumiReply` is never called, and the audio buffer ref is left orphaned. Fix: change to `z.string()` (allow empty).
- [x] [Review][Defer] **D1 — Cross-household read via mutable `current_household_id` in RLS** [`supabase/migrations/20261018000000_create_voice_transcripts.sql:35`] — pre-existing pattern across all household-scoped tables; household membership changes could expose prior transcripts. Not introduced here.
- [x] [Review][Defer] **D2 — No INSERT/UPDATE/DELETE RLS on `voice_transcripts`** [`supabase/migrations/20261018000000_create_voice_transcripts.sql`] — pre-existing SELECT-only pattern for all voice tables; relies on service-role bypass. Not introduced here.
- [x] [Review][Defer] **D3 — `role="region"` + `aria-live="polite"` a11y hybrid in CaptionRibbon** [`apps/web/src/components/CaptionRibbon.tsx:16`] — spec-prescribed combination; some screen readers (NVDA, JAWS) may announce the region label on every update. Future a11y pass: consider `role="log"` or plain `<div aria-live="polite">` without a landmark role.
- [x] [Review][Defer] **D4 — Caption clears visually while TTS audio is still playing** [`apps/web/src/stores/lumi.store.ts:133`] — `setCaptionTranscript` clears `captionLumiReply` on each new utterance. If user speaks while prior audio plays (server `isProcessing` is reset before client-side playback finishes), Lumi's caption disappears mid-speech. Minor UX desync; spec does not constrain this behaviour.
- [x] [Review][Defer] **D5 — Stale Lumi caption survives non-fatal error frames** [`apps/web/src/hooks/useLumiVoiceSession.ts`] — non-fatal `error` frames (`stt_failed`, `agent_failed`) set `voiceError` but do not clear `captionLumiReply`, leaving the prior turn's Lumi caption visible alongside the error. Minor UX; harmless at current session sizes.
- [x] [Review][Defer] **D6 — `retention_until` DST drift in non-UTC containers** [`apps/api/src/modules/voice/voice-transcript.repository.ts:15`] — `setDate(getDate() + 90)` may drift ±1 hour across DST boundaries if the server timezone is not UTC. Enforce `TZ=UTC` in the container environment before the 5-S15 purge job ships.

### Change Log

| Date | Change |
|------|--------|
| 2026-06-07 | Story 5-S5 authored: voice thread + captions — DB migration, HMAC webhook, voice_transcripts persistence, CaptionRibbon component, modality wiring in useLumiVoiceSession. |
| 2026-06-07 | Implemented all 8 tasks / 8 ACs. Migration `20261018000000` (voice_transcripts, SELECT-only RLS); `LumiTurnRequestSchema.modality`; `VoiceTranscriptRepository`; modality + best-effort transcript persistence in `LumiService` (wired in routes + nudge job); HMAC `POST /v1/webhooks/elevenlabs` (10/min/IP rate-limit, 5-min replay window); `<CaptionRibbon>` + store-backed caption state in LumiPanel; `modality:'voice'` on the voice turn POST. +26 tests (contracts 3 / api 15 / web 8). 0 new typecheck errors, 0 regressions. Status → review. |
| 2026-06-07 | SCOPE CHANGE per user: removed Task 5 / AC#5 / AC#6 (HMAC webhook). Product is off the ElevenLabs Agent (raw TTS + STT/Scribe), so there is no Agent webhook producer or signing secret. Deleted `webhooks.routes.ts` (+ test), reverted `ELEVENLABS_WEBHOOK_SECRET` (env + `.env.local.example`) and the app.ts registration. Net tests now +19 (api −7 webhook). Re-verified: API 1689p/20f, web 526p/2f, contracts 696p/7f; 0 new typecheck errors; 0 regressions. |
