# 5-S13 — Caption-only mode

> **Folds:** story 5.9 (full), PRD FR60, UX-DR58  
> **Status:** review  
> **Epic:** 5 — Household Coordination & Ambient Intelligence

---

## Story

**As a parent** who prefers text over audio — or uses a screen reader — I want to
enable "Text only" in Accessibility settings so that when I send a voice query
Lumi still transcribes and replies, but the TTS audio never auto-plays; captions
stream to the thread as usual so I can follow the conversation.

---

## Acceptance Criteria

| # | Criterion |
|---|-----------|
| AC1 | `GET /v1/users/me` returns a `caption_only_mode: boolean` field (default `false`). |
| AC2 | `PATCH /v1/users/me/accessibility` with `{ caption_only_mode: true }` persists the change and returns the updated `UserProfile`. A missing body field returns 400. |
| AC3 | Account page shows an "Accessibility" section with a "Text only — captions without audio" toggle that reads `caption_only_mode` from the loaded profile. |
| AC4 | Toggling the switch calls `PATCH /v1/users/me/accessibility` (optimistic UI — revert on error, same pattern as the notification-prefs toggles). |
| AC5 | When `caption_only_mode` is `true` and a voice reply arrives (`response.end` frame), `playBufferedAudio()` is NOT called — the MP3 chunks are discarded. |
| AC6 | When `caption_only_mode` is `true`, `onLumiReply(msg.text)` is still called on every `response.end` frame — captions stream to `captionLumiReply` in the store and the `<CaptionRibbon>` renders them as normal. |
| AC7 | When `caption_only_mode` is `false` (the default), behaviour is unchanged — TTS plays exactly as before 5-S13. No regression. |
| AC8 | Account page hydrates the lumi store's `captionOnlyMode` flag from the `/v1/users/me` response (same pattern as `proactiveNudges` in 12-S12). |
| AC9 | Unit tests cover: (a) `UserProfileSchema` parses `caption_only_mode`; (b) route returns 200 with updated value; (c) route returns 400 for empty body; (d) voice-session hook skips playback when mode is true; (e) voice-session hook plays audio when mode is false; (f) account page toggle fires the PATCH call. |

---

## Scope Notes

### What this slice ships

- DB column `users.caption_only_mode` (migration)
- `UserProfileSchema.caption_only_mode` + `UpdateAccessibilityRequestSchema` in contracts
- `PATCH /v1/users/me/accessibility` API route
- `captionOnlyMode` in lumi store + hydration from account page
- Hook skip-TTS logic (3-line change in `response.end` handler)
- Account page Accessibility section (toggle + optimistic handler)

### What is explicitly deferred

- **Server-side TTS skip**: The HK WS server (`LumiService.processVoiceUtterance`) still calls `streamTtsToWs` regardless of client preference — the server cannot yet detect caption-only mode. The MP3 chunks stream to the client but are discarded unplayed. This wastes bandwidth but is safe. Log as **D-5S13-1** in `deferred-work.md` (pass `caption_only` flag in the context frame → server skips TTS generation).
- Voice-first demo path (AC#5 in original 5-S5 scope) — caption-only on the onboarding voice path — is out of scope here; this slice covers only the ambient Lumi `useLumiVoiceSession` path.

---

## Implementation Tasks

### Task 1 — Migration (`supabase/migrations/20261021000000_add_caption_only_mode.sql`)

```sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS caption_only_mode BOOLEAN NOT NULL DEFAULT false;
```

Migration timestamp `20261021000000` sorts after `20261020000000` (5-S10 family-language). No index needed — reads happen only on the per-user `/v1/users/me` fetch.

**USER-SIDE GATE:** `supabase db push --include-all` before any live testing.

---

### Task 2 — Contracts (`packages/contracts/src/users.ts`)

#### 2a. Extend `UserProfileSchema`

Add `caption_only_mode` as the last field (before the closing `}`):

```ts
caption_only_mode: z.boolean(),
```

#### 2b. New `UpdateAccessibilityRequestSchema`

Add after `UpdateNotificationPrefsRequestSchema`:

```ts
// PATCH /v1/users/me/accessibility — single-field update for accessibility prefs.
export const UpdateAccessibilityRequestSchema = z.object({
  caption_only_mode: z.boolean(),
});
```

#### 2c. Types re-export (`packages/types/src/index.ts`)

Add alongside the existing users imports:

```ts
export type { UpdateAccessibilityRequest } from '@hivekitchen/contracts';
```

And infer the type in `contracts/src/users.ts`:

```ts
export type UpdateAccessibilityRequest = z.infer<typeof UpdateAccessibilityRequestSchema>;
```

**Verify:** `pnpm --filter @hivekitchen/contracts build` passes with 0 errors.

---

### Task 3 — Repository (`apps/api/src/modules/users/user.repository.ts`)

#### 3a. `UserProfileRow` interface

Add `caption_only_mode: boolean` as a new field:

```ts
export interface UserProfileRow {
  // ... existing fields ...
  caption_only_mode: boolean;
}
```

#### 3b. `UpdateUserProfileInput` type

Add the optional field:

```ts
export type UpdateUserProfileInput = Partial<{
  // ... existing fields ...
  caption_only_mode: boolean;
}>;
```

#### 3c. `PROFILE_COLUMNS` constant

Append `caption_only_mode` to the bare-string select list:

```ts
const PROFILE_COLUMNS =
  'id, email, display_name, preferred_language, role, notification_prefs, cultural_language, ' +
  'parental_notice_acknowledged_at, parental_notice_acknowledged_version, caption_only_mode';
```

> **TRAP:** This is a plain string constant, not an array. Forget to add here and `findUserById` returns `undefined` for `caption_only_mode`, causing Zod parse failures on `GET /v1/users/me`.

#### 3d. `updateUserById`

The existing `updateUserById` method likely uses a generic `Partial<UpdateUserProfileInput>` spread — verify that it passes arbitrary JSONB/column fields through to Supabase `.update()`. If so, no code change needed here (the service sets the field via the existing update path). If `updateUserById` has an explicit column allowlist, add `caption_only_mode` to it.

---

### Task 4 — Service (`apps/api/src/modules/users/user.service.ts`)

Add `updateMyAccessibility` after `updateMyPreferences`:

```ts
async updateMyAccessibility(
  userId: string,
  householdId: string,
  input: UpdateAccessibilityRequest,
): Promise<UserProfile> {
  await this.repository.updateUserById(userId, {
    caption_only_mode: input.caption_only_mode,
  });
  return this.getMyProfile(userId, householdId);
}
```

Import `UpdateAccessibilityRequest` from `@hivekitchen/types`.

---

### Task 5 — Route (`apps/api/src/modules/users/user.routes.ts`)

Add after the `PATCH /v1/users/me/preferences` handler:

```ts
fastify.patch(
  '/v1/users/me/accessibility',
  {
    schema: {
      body: UpdateAccessibilityRequestSchema,
      response: { 200: UserProfileSchema },
    },
  },
  async (request) => {
    const body = request.body as UpdateAccessibilityRequest;
    const profile = await service.updateMyAccessibility(
      request.user.id,
      request.user.household_id,
      body,
    );
    request.auditContext = {
      event_type: 'account.updated',
      user_id: request.user.id,
      household_id: request.user.household_id,
      request_id: request.id,
      metadata: { fields_changed: ['caption_only_mode'] },
    };
    return profile;
  },
);
```

Add the missing imports at the top of `user.routes.ts`:

```ts
import {
  // existing imports ...
  UpdateAccessibilityRequestSchema,
} from '@hivekitchen/contracts';
import type {
  // existing imports ...
  UpdateAccessibilityRequest,
} from '@hivekitchen/types';
```

---

### Task 6 — Lumi store (`apps/web/src/stores/lumi.store.ts`)

#### 6a. State field

Add `captionOnlyMode: boolean` to `LumiState` interface (after `proactiveNudges`):

```ts
// Story 5-S13 — mirrors users.caption_only_mode. When true, the voice-session
// hook skips TTS playback; captions still stream. Hydrated from /v1/users/me
// at account page load (same pattern as proactiveNudges).
captionOnlyMode: boolean;
```

#### 6b. Initial state

```ts
captionOnlyMode: false,
```

#### 6c. Action in `LumiActions`

```ts
setCaptionOnlyMode: (value: boolean) => void;
```

#### 6d. Action implementation

```ts
setCaptionOnlyMode: (value) => set({ captionOnlyMode: value }),
```

---

### Task 7 — Voice session hook (`apps/web/src/hooks/useLumiVoiceSession.ts`)

**Minimal change — 4 lines in `handleServerMessage`.** Find the `case 'response.end':` block (currently lines ~142-145) and update it:

```ts
case 'response.end':
  useLumiStore.getState().setLumiThinking(false);
  onLumiReplyRef.current(msg.text);                      // captions ALWAYS fire
  if (useLumiStore.getState().captionOnlyMode) {
    audioBufferRef.current = null;                       // discard accumulated MP3 chunks
  } else {
    playBufferedAudio();
  }
  return;
```

> **Why `getState()` not a hook:** This is inside a WebSocket `message` event handler — not a React render. `useLumiStore.getState()` is the correct synchronous store read for closures. The value is fresh at dispatch time (reads the current state, not a stale closure over the initial render).
>
> **MP3 chunks still accumulate:** The `response.start` handler (sets `audioBufferRef.current = { seq, chunks: [] }`) and the binary message handler (pushes chunks) are unchanged. When `captionOnlyMode` is true, `response.end` just discards the buffer instead of playing it. This is a single-tick noop — no timeout, no leak. The alternative (skipping `audioBufferRef` allocation in `response.start`) would save memory in theory but complicates the binary handler's null-check path with no meaningful benefit at this data scale.

---

### Task 8 — Account page (`apps/web/src/routes/(app)/account.tsx`)

#### 8a. New state

Add alongside the existing `culturalSaving`/`culturalError` state vars:

```ts
const [captionOnlyMode, setCaptionOnlyModeLocal] = useState(false);
const [captionOnlySaving, setCaptionOnlySaving] = useState(false);
const [captionOnlyError, setCaptionOnlyError] = useState<string | null>(null);
```

#### 8b. Hydrate from profile fetch

Inside the existing `useEffect` profile loader, after `setCulturalLanguage(result.cultural_language)`:

```ts
setCaptionOnlyModeLocal(result.caption_only_mode);
useLumiStore.getState().setCaptionOnlyMode(result.caption_only_mode);
```

#### 8c. Toggle handler

```ts
async function handleAccessibilityToggle(checked: boolean) {
  if (!profile) return;
  const previous = captionOnlyMode;
  setCaptionOnlyError(null);
  setCaptionOnlySaving(true);
  setCaptionOnlyModeLocal(checked);                          // optimistic
  useLumiStore.getState().setCaptionOnlyMode(checked);
  try {
    const updated = await hkFetch<UserProfile>('/v1/users/me/accessibility', {
      method: 'PATCH',
      body: { caption_only_mode: checked },
    });
    setProfile(updated);
    setCaptionOnlyModeLocal(updated.caption_only_mode);
    useLumiStore.getState().setCaptionOnlyMode(updated.caption_only_mode);
  } catch {
    setCaptionOnlyModeLocal(previous);                       // revert
    useLumiStore.getState().setCaptionOnlyMode(previous);
    setCaptionOnlyError('Could not update accessibility setting. Please try again.');
  } finally {
    setCaptionOnlySaving(false);
  }
}
```

> **`hkFetch` body**: pass the raw object — `hkFetch` already `JSON.stringify`s `init.body` internally (confirmed in `lib/fetch.ts`). Do NOT double-stringify.

#### 8d. JSX section

Add an "Accessibility" section before or after the "Notifications" section.
Follow the existing section separator pattern (`border-t border-stone-200/50 pt-6 space-y-3`):

```tsx
{/* Accessibility — Story 5-S13 */}
<div className="border-t border-stone-200/50 pt-6 space-y-3">
  <h2 className="text-heading3 text-fg">Accessibility</h2>
  <div className="flex items-start justify-between gap-4">
    <div>
      <p className="text-body text-fg">Text only</p>
      <p className="text-sm text-fg-muted">Captions stream normally — Lumi's voice reply won't auto-play.</p>
    </div>
    <button
      type="button"
      role="switch"
      aria-checked={captionOnlyMode}
      aria-label="Text only — captions without audio"
      disabled={captionOnlySaving || loadState !== 'ready'}
      onClick={() => { void handleAccessibilityToggle(!captionOnlyMode); }}
      className={[
        'relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent',
        'transition-colors duration-200 ease-in-out motion-reduce:transition-none',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-honey-amber-400',
        'disabled:opacity-50',
        captionOnlyMode ? 'bg-honey-amber-500' : 'bg-stone-300',
      ].join(' ')}
    >
      <span
        aria-hidden
        className={[
          'pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0',
          'transition duration-200 ease-in-out motion-reduce:transition-none',
          captionOnlyMode ? 'translate-x-5' : 'translate-x-0',
        ].join(' ')}
      />
    </button>
  </div>
  {captionOnlyError && (
    <p role="alert" className="text-sm text-safety-red-600">{captionOnlyError}</p>
  )}
</div>
```

> **Design tokens**: Use `bg-honey-amber-500` (enabled) and `bg-stone-300` (disabled) — matches the existing notification-prefs toggle pattern in the codebase (`LumiPanel.tsx` uses `honey-amber` for Lumi identity). There is no pre-built `<Toggle>` component; the raw `role=switch` button pattern is how the other account toggles are done. Check that `text-safety-red-600` is the correct token for error copy — search for existing error copy usage in account.tsx to confirm the token name.

---

### Task 9 — Tests

#### 9a. Contracts (`packages/contracts/src/users.test.ts`)

```ts
it('UpdateAccessibilityRequestSchema accepts caption_only_mode boolean', () => {
  expect(UpdateAccessibilityRequestSchema.parse({ caption_only_mode: true })).toEqual({ caption_only_mode: true });
});

it('UserProfileSchema includes caption_only_mode', () => {
  const profile = UserProfileSchema.parse({ ...validProfile, caption_only_mode: false });
  expect(profile.caption_only_mode).toBe(false);
});
```

#### 9b. API route (`apps/api/src/modules/users/user.routes.test.ts`)

```ts
describe('PATCH /v1/users/me/accessibility', () => {
  it('200 — updates caption_only_mode', async () => {
    // mock service.updateMyAccessibility to return updated profile
    // assert response.caption_only_mode matches
  });

  it('400 — missing body field', async () => {
    // send empty body {}; assert 400
  });

  it('401 — unauthenticated', async () => {
    // no auth header; assert 401
  });
});
```

#### 9c. Voice session hook (`apps/web/src/hooks/useLumiVoiceSession.test.ts`)

If this file doesn't exist, create a minimal test file alongside the hook.

```ts
it('skips TTS playback when captionOnlyMode is true', () => {
  // set useLumiStore state { captionOnlyMode: true }
  // fire a 'response.end' message through the handler
  // assert playBufferedAudio (or new Audio) was NOT called
  // assert onLumiReply WAS called with the text
});

it('plays TTS when captionOnlyMode is false', () => {
  // set useLumiStore state { captionOnlyMode: false }
  // fire a 'response.end' message through the handler
  // assert Audio playback path was called
});
```

> The hook is tightly coupled to WebSocket and VAD — prefer testing the handler function in isolation (extract `handleServerMessage` to be accessible in tests, or spy on `playBufferedAudio` via module-level approach). If extraction is too invasive, a `vi.spyOn(window, 'Audio')` approach works.

#### 9d. Account page (`apps/web/src/routes/(app)/account.test.tsx`)

```ts
it('renders Accessibility section when profile loads', async () => {
  // mock /v1/users/me with caption_only_mode: false
  // render AccountPage; assert "Text only" toggle is present and unchecked
});

it('fires PATCH /accessibility on toggle click and updates UI', async () => {
  // mock GET profile + PATCH response
  // click toggle; assert PATCH called with { caption_only_mode: true }
});
```

#### 9e. Lumi store

```ts
it('setCaptionOnlyMode sets captionOnlyMode', () => {
  useLumiStore.getState().setCaptionOnlyMode(true);
  expect(useLumiStore.getState().captionOnlyMode).toBe(true);
});
```

---

## Deferred Work

| ID | Item |
|---|---|
| D-5S13-1 | Server-side TTS skip: when `caption_only_mode` is true on the user row, the server should detect it from the context frame and skip `streamTtsToWs` entirely — avoiding wasted bandwidth. Currently the server streams MP3 chunks the client silently discards. |

Add this entry to `_bmad-output/implementation-artifacts/deferred-work.md`.

---

## Key Reconciliations (pre-empting dev traps)

1. **`PROFILE_COLUMNS` is a bare string, not an array.** `user.repository.ts:34` — append `caption_only_mode` to the existing string literal. If missed, Supabase returns `undefined` for the field and `UserProfileSchema.parse()` throws on every `/v1/users/me` call.

2. **`hkFetch` body double-encode trap.** Pass `body: { caption_only_mode: checked }` as a plain object — `hkFetch` in `lib/fetch.ts` already serializes `init.body`. The story's `handleCulturalLanguageChange` handler (line ~214 in `account.tsx`) shows the correct raw-object pattern: `body: { cultural_language: value }`.

3. **`useLumiStore.getState()` in the WS closure.** The `handleServerMessage` function lives inside a `useCallback(…, [])` closure (effectively a singleton across renders). Reading `captionOnlyMode` via `useLumiStore.getState()` is the correct synchronous access pattern here — the same as how `endTalkSession`, `setLumiThinking`, and `voiceError` are set in the same handler. Do NOT attempt to read it as a hook state (that would be invalid outside a render).

4. **`toUserProfile` mapper in `user.service.ts`.** There is a `toUserProfile(row, auth_providers, flags)` helper that converts `UserProfileRow` into the `UserProfile` shape. If it copies fields explicitly (not a spread), add `caption_only_mode: row.caption_only_mode` to the mapper. Locate this function and inspect — if it does `...row` spreading then no change is needed.

5. **`UpdateUserProfileInput` covers the DB write path.** `updateUserById(userId, input)` uses `UpdateUserProfileInput`. Adding `caption_only_mode?: boolean` to that type ensures the new service method can pass the field through without TypeScript errors.

6. **Auth store user vs account page local state.** The `caption_only_mode` value is NOT stored in `auth.store.ts` — it lives in the lumi store (for the voice hook) and as local `useState` in the account page. This mirrors the `proactiveNudges` pattern exactly. Do NOT add it to `AuthUserSchema` or the JWT payload.

7. **Migration timestamp `20261021000000`.** Sorts after 20261020000000 (5-S10 family-language migration). If another migration with a conflicting timestamp exists in the local supabase/migrations folder, increment to `20261021000100`.

8. **No new npm deps.** This story is a thin feature add. No new packages needed.

9. **Error token `text-safety-red-600`**: Confirm the correct Tailwind error-text token by searching `account.tsx` for existing error copy — the account-deletion section uses `text-safety-red-600` (confirmed from 7-S11 dev notes). Use the same token.

10. **`toUserProfile` or `UserService.getMyProfile`** must pass `caption_only_mode` from the row to the returned `UserProfile`. Since `UserProfile` is now Zod-validated against `UserProfileSchema` which includes `caption_only_mode`, a missing field will cause a runtime Zod parse error on the route's `response: { 200: UserProfileSchema }` schema check.

---

## Previous Story Intelligence (from 5-S12)

From 5-S12 implementation and code review, the following patterns are established and must be followed:

- **`hkFetch` body**: pass raw objects, never pre-stringify (confirmed multiple times)
- **`PATCH` route tests**: assert status code using Fastify's injection pattern; the `requireIdempotencyKey` guard from `plans.routes.ts` is NOT present on user routes
- **`fastify.d.ts` decorator types**: if the service is constructed locally (not decorated), no type augmentation is needed — user routes construct `service` locally in the plugin function
- **Pre-existing failing tests**: API 20f/13skip, web 2f, contracts 7f — these are baselines, do NOT attempt to fix them
- **Typecheck baselines**: API 12, web 7, contracts 1, types 1 — zero new errors is the gate

---

## File List (predicted)

**New**
- `supabase/migrations/20261021000000_add_caption_only_mode.sql` — DB migration

**Modified**
- `packages/contracts/src/users.ts` — `UpdateAccessibilityRequestSchema` + `caption_only_mode` on `UserProfileSchema`
- `packages/contracts/src/users.test.ts` — 2 new schema tests
- `packages/types/src/index.ts` — `UpdateAccessibilityRequest` re-export
- `apps/api/src/modules/users/user.repository.ts` — `UserProfileRow` + `UpdateUserProfileInput` + `PROFILE_COLUMNS`
- `apps/api/src/modules/users/user.service.ts` — `updateMyAccessibility` method
- `apps/api/src/modules/users/user.routes.ts` — `PATCH /v1/users/me/accessibility` route
- `apps/api/src/modules/users/user.routes.test.ts` — 3 new route tests
- `apps/web/src/stores/lumi.store.ts` — `captionOnlyMode` state + `setCaptionOnlyMode` action
- `apps/web/src/hooks/useLumiVoiceSession.ts` — skip `playBufferedAudio()` when `captionOnlyMode`
- `apps/web/src/routes/(app)/account.tsx` — Accessibility section, hydration, handler
- `apps/web/src/routes/(app)/account.test.tsx` — 2 new account tests
- `apps/web/src/stores/lumi.store.test.ts` — 1 new store test + defaults assertion
- `apps/api/src/modules/users/user.repository.test.ts` — `PARENT_ROW` fixture +`caption_only_mode` (typecheck fix)
- `apps/api/src/jobs/lumi-nudge.job.test.ts` — `parentRow` fixture +`caption_only_mode` (typecheck fix)
- `_bmad-output/implementation-artifacts/deferred-work.md` — D-5S13-1

---

## Baselines (from 5-S12 done state)

- API: 1763p / 20f / 13skip
- Web: 545p / 2f
- Contracts: 722p / 7f
- Typecheck: API 12 / web 7 / contracts 1 / types 1

**Gate:** Zero new test failures, zero new typecheck errors, and `pnpm --filter @hivekitchen/contracts build` passes.

**USER-SIDE GATE:** `supabase db push --include-all` (migration `20261021000000`) before any live demo or integration test.

---

## Dev Agent Record

### Implementation Summary (2026-06-08)

All 9 ACs satisfied. Caption-only ("Text only") accessibility mode shipped end-to-end:
the voice hook discards the buffered MP3 on `response.end` when the flag is set,
captions still stream.

**Tasks completed (1–10):**

1. ✅ Migration `20261021000000_add_caption_only_mode.sql` — `users.caption_only_mode BOOLEAN NOT NULL DEFAULT false`.
2. ✅ Contracts — `UserProfileSchema.caption_only_mode` + new `UpdateAccessibilityRequestSchema`.
3. ✅ Repository — `UserProfileRow` / `UpdateUserProfileInput` field + `PROFILE_COLUMNS` append.
4. ✅ Service — `updateMyAccessibility` + `caption_only_mode` added to the explicit `toUserProfile` mapper.
5. ✅ Route — `PATCH /v1/users/me/accessibility` (account.updated audit, `fields_changed: ['caption_only_mode']`).
6. ✅ Lumi store — `captionOnlyMode` state + `setCaptionOnlyMode` action + initial `false`.
7. ✅ Voice hook — `response.end` discards `audioBufferRef` when `captionOnlyMode`, else `playBufferedAudio()`.
8. ✅ Account page — Accessibility section, hydration of local + store flag, optimistic toggle handler.
9. ✅ Tests — contracts (5), API route (3), voice hook (2), account page (2), lumi store (1).
10. ✅ Deferred-work — D-5S13-1 (server-side TTS skip) logged.

### Key reconciliations / deviations from the story spec

- **Type inference location (Task 2c).** The codebase infers request/response types in
  `packages/types/src/index.ts` via `z.infer<>` (e.g. `UpdateCulturalPreferenceRequest`), not by
  re-exporting from contracts. Followed that established pattern instead of the story's
  `export type … from '@hivekitchen/contracts'` snippet. Net result identical:
  `UpdateAccessibilityRequest` is importable from `@hivekitchen/types`.
- **Account toggle is a checkbox, not a custom honey-amber switch (Task 8d).** The story's switch
  markup uses tokens (`honey-amber-500`, `stone-300`, `safety-red-600`) that do NOT exist in this
  repo's Tailwind config — the existing account toggles (Notifications section) are plain
  `<input type="checkbox">` and AC4 says "same pattern as the notification-prefs toggles." Matched
  that pattern exactly (checkbox + `text-safety-red` error token), satisfying AC3/AC4 with verified
  tokens and zero new design-token risk. `role="switch"` + `aria-label` kept for the "switch"
  semantics the AC/tests reference.
- **Repository write method is `updateUserProfile` (not `updateUserById`).** The service routes the
  write through the existing `updateUserProfile`, which spreads `...input` — no allowlist change
  needed, the field passes straight through.
- **`toUserProfile` copies fields explicitly** (not a spread), so `caption_only_mode: row.caption_only_mode`
  was added there (Key Reconciliation #4/#10) — required or the `response: { 200: UserProfileSchema }`
  serializer would throw on every `/v1/users/me`.

### Verification

- Targeted: contracts users 45/45, API user.routes 22/22, web hook+account+store 32/32.
- Full suites (failing counts = documented baselines, zero new): contracts 739p/**7f**,
  API 1777p/**20f**/13skip, web 564p/**2f** (2f = 5-S3 PackerAssignmentDialog debt).
- Typecheck: **zero new errors** — API back to baseline 12 (fixed 2 fixtures in
  `lumi-nudge.job.test.ts` + `user.repository.test.ts` that build `UserProfileRow`), web 7,
  contracts 1, types 1 (all pre-existing, incl. shared `heart-notes.ts`).
- No new npm dependencies.

**USER-SIDE GATE:** `supabase db push --include-all` (migration `20261021000000`) before any live
demo/integration test.

### Review Findings (2026-06-08)

3-layer adversarial review (Blind Hunter · Edge Case Hunter · Acceptance Auditor). **All 9 ACs SATISFIED.** 0 patches, 6 deferred, 7 dismissed.

- [x] [Review][Defer] `captionOnlyMode` only hydrated at account page load — a user with `caption_only_mode: true` in DB who never visits account settings hears TTS audio they opted out of; spec-defined pattern (matches `proactiveNudges`), notable for a11y impact [EC-1] — deferred, spec-compliant pattern
- [x] [Review][Defer] Optimistic store update before PATCH — a `response.end` frame arriving during the PATCH's in-flight window acts on the optimistic value, which is then silently reverted on error; inherent tradeoff of optimistic UI, same pattern as notification toggles [BH-5] — deferred, optimistic-UI tradeoff
- [x] [Review][Defer] `role="switch"` on `<input type="checkbox">` minor ARIA misuse — checkbox already has implicit `checkbox` role; overriding to `switch` may not be correctly conveyed by all AT; consistent with existing account toggle patterns [AA-1/AA-5] — deferred, codebase-wide a11y audit
- [x] [Review][Defer] `updateMyAccessibility` skips `findUserById` pre-fetch guard — if a user row is deleted between auth and the update, Supabase `.single()` throws a 500 (PGRST116) instead of a structured 401/404; very low probability [ECH-3] — deferred, pre-existing pattern gap
- [x] [Review][Defer] Double-tap race on accessibility toggle before `captionOnlySaving` gates — two clicks in the same render frame can both pass the `if (!profile)` guard; low probability, same pattern as other account toggles [ECH-4] — deferred, pre-existing pattern
- [x] [Review][Defer] Error-revert path in `handleAccessibilityToggle` is untested — the `catch` block's revert of local state + store flag has no unit test; AC9 does not require it [AA-6] — deferred, coverage gap

## Change Log

| Date | Change |
|---|---|
| 2026-06-08 | Story authored — 5-S13 caption-only mode. Status → ready-for-dev. |
| 2026-06-08 | IMPL COMPLETE (dev-story). All 9 ACs + tasks 1–10. PATCH /v1/users/me/accessibility, caption_only_mode end-to-end, voice-hook TTS skip. +13 tests. Zero new typecheck errors / test failures. Status → review. |
| 2026-06-08 | CODE REVIEW DONE: 3-layer adversarial (Blind/Edge/Auditor); all 9 ACs SATISFIED. 0 patches, 6 deferred (store hydration gap, optimistic-UI race, ARIA misuse, 500-on-deleted-user, double-tap race, revert untested), 7 dismissed (5 BH false positives + ProposeSwap clean + future-proofing noise). Status → done. |
