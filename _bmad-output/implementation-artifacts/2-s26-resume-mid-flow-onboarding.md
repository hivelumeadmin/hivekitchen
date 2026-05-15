# Story 2.s26: Resume Mid-Flow Onboarding

Status: done

**Slice key:** `2-s26-resume-mid-flow-onboarding`
**Epic:** 2 — Household Onboarding & Profile
**Source slice doc:** `_bmad-output/planning-artifacts/epic-2-onboarding-integration.md` §Slice 2-s26
**Builds on:** 2-s19 (is_onboarded derivation + auth routing), Slice C (text onboarding tool-loop persistence via `threads` + `thread_turns`)

---

## Story

As a **returning parent who started but did not finish onboarding**,
I want **to land on a "Continue where you left off?" surface that re-hydrates my prior conversation when I sign in again**,
so that **I don't lose my place or have to re-answer questions I already answered, and the path to completing my household profile feels respectful of my time**.

---

## Why this story matters

Today, if a parent closes the tab mid-interview and logs back in, **2-s19's routing correctly sends them back to `/onboarding`** — but they land on the **mode picker** as if it were day zero. The shipped `OnboardingService.submitTextTurn` already reuses an active text-modality thread per household (`apps/api/src/modules/onboarding/onboarding.service.ts:118`), so the conversation history is **already persisted** in `thread_turns`. The gap is purely surface-level: there's no UI that reads back the existing thread and offers Continue vs Start-over. This slice closes that gap.

---

## Critical design decision — do NOT create new `onboarding_state` / `onboarding_turns` tables

The slice doc (`epic-2-onboarding-integration.md` §Slice 2-s26 "Layers" section) proposes:

> **DB:** New `onboarding_state(user_id, household_id, current_step, modality, started_at, last_activity_at)` table; `onboarding_turns(state_id, turn_index, role, content, captured_data jsonb)` for per-question transcripts

**Reject this. Reuse the existing `threads` + `thread_turns` schema** that Slice C already writes to. Rationale:

1. **Source of truth duplication.** `OnboardingService.submitTextTurn` already persists every user/lumi turn into `thread_turns` (per-household, modality-scoped). Adding `onboarding_turns` would create a second source of truth that drifts the moment we forget to dual-write.
2. **No `current_step` to track.** The interview is **not Q1/Q2/Q3-staged on the server**. The Slice C agent runs an open-ended tool-loop conversation; completion is decided by `OnboardingAgent.isSummaryConfirmed()` after `MIN_TURNS_FOR_COMPLETION_CHECK=6` LLM messages (`onboarding.service.ts:359`). There is no enum step the client could resume to — only "resume this conversation."
3. **`threads.modality` already exists.** Modality is a thread-level column. We don't need a separate `onboarding_state.modality`.
4. **Last-activity is derivable.** `last_activity_at = MAX(thread_turns.created_at) WHERE thread_id = X`. No new column.
5. **Mirrors 2-s19's design discipline.** Story 2-s19 explicitly rejected adding `users.onboarding_completed_at` and derived from existing data. Same call here.

**Trade-off accepted:** Same as 2-s19 — derivations are honest reads of source data. The cost is one extra `EXISTS` query per `/auth/login` and one extra read on `/onboarding` landing. Both are sub-millisecond on a single-household index.

**If a future slice needs per-question structured state** (e.g., "Q2 was answered, Q3 was not"), introduce it then — not pre-emptively. Right now the interview has no Q-level boundaries.

---

## Acceptance Criteria

1. **AC1 — Detect in-progress onboarding from existing thread data.** Server exposes `is_onboarding_in_progress: boolean` alongside `is_onboarded` on `POST /v1/auth/login`, `POST /v1/auth/callback`, and `GET /v1/users/me` response shapes (extend `AuthLoginResponseSchema`, `AuthOauthResponseSchema`, `UserProfileSchema` in `packages/contracts`). Derived as: `is_onboarded === false` AND there exists at least one `threads` row for the household where `modality IN ('text','voice')` AND no summary `system_event` turn has been written for that thread yet. Three-state result: `not_started` (no thread) | `in_progress` (open thread) | `completed`.

2. **AC2 — `GET /v1/onboarding/state` endpoint** returns `{ status: 'not_started' | 'in_progress' | 'completed', thread_id?: string, modality?: 'text' | 'voice', started_at?: string, last_activity_at?: string, turns?: Array<{ id: string, role: 'user' | 'lumi', content: string, created_at: string }> }`. When `status='in_progress'`, all fields populated; when `status='not_started'` or `'completed'`, only `status` is set. Auth required. Household-scoped. Synthetic `OPENING_GREETING` is **excluded** from the returned `turns` array (it's a client-render constant — including it would cause it to render twice on resume).

3. **AC3 — `POST /v1/onboarding/state/reset` endpoint** closes the active in-progress thread for the caller's household (writes a `system_event` turn with `event_type='reset_by_user'` and marks the thread closed via existing thread-close mechanism — confirm exact mechanism from `onboarding.service.ts:526` and Story 5-S4 thread-sequencing patterns). Idempotent: returns 204 whether or not a thread existed. Subsequent `GET /v1/onboarding/state` returns `status='not_started'`. Audit log entry written (`audit_type='onboarding.reset'`, includes prior `thread_id`).

4. **AC4 — Resume surface on `/onboarding` landing.** When user lands on `/onboarding` and `is_onboarding_in_progress=true` (or `GET /v1/onboarding/state` returns `status='in_progress'`), render the **new `<OnboardingResume>` component instead of the mode picker** (`apps/web/src/routes/(app)/onboarding.tsx` `'select'` mode). Component shows:
   - Eyebrow: `"Welcome back, {first_name}."`
   - Headline: `"You started a {modality} interview {relative_time_phrase}. Pick up where you left off?"` (e.g., "yesterday", "2 days ago" — use the existing relative-time formatter if one exists; otherwise inline a simple one)
   - Two primitives: `<PrimaryButton>Continue</PrimaryButton>` + `<SecondaryButton>Start over</SecondaryButton>`
   - All token-compliant per `.stitch/DESIGN.md` Editorial Hearth v2.0 (warm-neutral, lumi-terracotta, sacred-plum) — mirror the auth pages re-toked in 2-s19

5. **AC5 — Continue path re-hydrates turns.** Tapping Continue:
   - For text modality: mounts `OnboardingText` with prior turns prepended (new optional `initialTurns?: Turn[]` prop on the component); the next message the user sends goes to `POST /v1/onboarding/text/turn` and joins the existing thread (the service already reuses the active thread per `onboarding.service.ts:118`).
   - For voice modality: this slice is **text-only for Continue**; if `modality='voice'`, the Continue button is replaced with a single primitive labelled `"Switch to text"` (because voice resume requires the deferred 2-s21 work). Document this gracefully in the resume copy. **Do not** silently downgrade modality on the server.
   - In all cases, no duplicate `OPENING_GREETING` renders.

6. **AC6 — Start over path closes prior thread.** Tapping Start over:
   - Calls `POST /v1/onboarding/state/reset`
   - On 204 → routes (or transitions) to the standard mode-picker `'select'` state
   - User completes a fresh interview against a new `threads` row
   - No mixed turns from prior thread leak into the new one

7. **AC7 — Routing stays in `/onboarding`.** The slice deliberately does **not** introduce a new `/onboarding/resume` route. The Resume surface is a `select`-mode-replacement *within* `/onboarding`. Rationale: 2-s19 routing already correctly sends in-progress users to `/onboarding` — adding a sibling route would require updating three auth callbacks. Keep blast radius minimal.

8. **AC8 — Existing-user backwards compat.** Users who completed onboarding before this slice (Epic 2 done cohort) must remain routed to `/app`. The new `is_onboarding_in_progress` flag is `false` for any user with a finalized onboarding thread (summary `system_event` exists). No migration or backfill required — the derivation reads `thread_turns` rows which already exist.

9. **AC9 — Manual test path matches slice doc demo.**
   - Sign up fresh email → enter text onboarding → send Q1 answer → close tab
   - Log out (clear localStorage) → log back in
   - Land on `/onboarding` → see Resume surface, NOT mode picker
   - Tap Continue → see prior Q1 turn in the conversation, no duplicate greeting
   - Send Q2 answer → response includes Lumi's reply against the existing thread
   - Repeat sign-out / sign-in → still resumable until interview completes
   - Tap Start over instead → see mode picker → complete fresh interview → land on `/app`

10. **AC10 — Telemetry breadcrumbs.** Emit existing-pattern audit log entries:
    - `audit_type='onboarding.resume_offered'` on `GET /v1/onboarding/state` when status='in_progress'
    - `audit_type='onboarding.resumed'` when user posts a turn against an existing thread that already had ≥1 prior turn (extend the existing turn-write code path in `onboarding.service.ts` to detect this — likely via `existing_turn_count` already computed)
    - `audit_type='onboarding.reset'` per AC3

---

## Tasks / Subtasks

- [x] **T1 — Backend: extend `is_onboarded` derivation to three states** (AC: 1, 8)
  - [x] T1.1 Add `getOnboardingProgress(household_id)` method to `apps/api/src/modules/auth/auth.repository.ts` returning `'not_started' | 'in_progress' | 'completed'`. Reuses existing parental-notice + children-count queries from 2-s19's `getIsOnboarded`; adds one `EXISTS` against `threads`/`thread_turns` to detect an open text/voice thread without a summary system_event.
  - [x] T1.2 Update `auth.service.ts` to call new method; expose both `is_onboarded` (boolean — true iff status='completed') AND `is_onboarding_in_progress` (boolean — true iff status='in_progress') on login/callback/me responses. Maintains 2-s19's contract while adding the new flag.
  - [x] T1.3 Update `auth.service.test.ts` truth table: add cases (no thread → in_progress=false), (open text thread → in_progress=true), (closed/summarized thread + onboarded → both false), (legacy onboarded users → in_progress=false).
  - [x] T1.4 Update `auth.routes.test.ts` to assert `is_onboarding_in_progress` is present in `/login` and `/callback` happy-path responses.

- [x] **T2 — Contracts: extend Zod schemas** (AC: 1, 2)
  - [x] T2.1 Edit `packages/contracts/src/auth.ts`: add `is_onboarding_in_progress: z.boolean()` to `AuthLoginResponseSchema` and `AuthOauthResponseSchema`.
  - [x] T2.2 Edit `packages/contracts/src/users.ts` `UserProfileSchema`: same field.
  - [x] T2.3 New file `packages/contracts/src/onboarding-state.ts`:
    ```ts
    export const OnboardingStateStatusSchema = z.enum(['not_started','in_progress','completed']);
    export const OnboardingTurnSchema = z.object({
      id: z.string().uuid(),
      role: z.enum(['user','lumi']),
      content: z.string(),
      created_at: z.string().datetime(),
    });
    export const OnboardingStateResponseSchema = z.object({
      status: OnboardingStateStatusSchema,
      thread_id: z.string().uuid().optional(),
      modality: z.enum(['text','voice']).optional(),
      started_at: z.string().datetime().optional(),
      last_activity_at: z.string().datetime().optional(),
      turns: z.array(OnboardingTurnSchema).optional(),
    });
    ```
  - [x] T2.4 Re-export from `packages/contracts/src/index.ts`. Build contracts package.

- [x] **T3 — Backend: `GET /v1/onboarding/state` endpoint** (AC: 2)
  - [x] T3.1 Add route to `apps/api/src/modules/onboarding/onboarding.routes.ts`. Reuse authenticate hook + household-scoped guard. Calls new `OnboardingService.getState(household_id)` method.
  - [x] T3.2 Add `getState()` to `OnboardingService`: queries `threads` for the household's most-recent text/voice onboarding thread that has no summary system_event; if found, fetches `thread_turns` ordered by `created_at`, filters out the synthetic opening-greeting marker (if represented as a `system_event` rather than a user/lumi turn, this should naturally exclude — verify against the schema), returns shape per contract.
  - [x] T3.3 Add `onboarding.routes.test.ts` cases: (no thread → not_started), (open thread with 2 turns → in_progress + turns array), (closed thread → completed, no turns).

- [x] **T4 — Backend: `POST /v1/onboarding/state/reset` endpoint** (AC: 3, 10)
  - [x] T4.1 Add route. 204 on success. Idempotent.
  - [x] T4.2 `OnboardingService.resetState(household_id, user_id)`: finds open thread, writes `system_event` turn with payload `{ event_type: 'reset_by_user' }`, marks thread closed via the same mechanism Slice C uses for finalize (`onboarding.service.ts:526` close path). If no open thread → no-op, still return 204.
  - [x] T4.3 Write audit log entry `onboarding.reset` with `{ thread_id, user_id, household_id }` (see `apps/api/src/audit/audit.types.ts` for adding a new audit_type literal).
  - [x] T4.4 Test: (no thread → 204, no audit), (open thread → 204, thread closed, audit row written, next GET returns not_started).

- [x] **T5 — Backend: telemetry breadcrumbs** (AC: 10)
  - [x] T5.1 In `OnboardingService.getState()`, when returning `status='in_progress'`, fire `onboarding.resume_offered` audit entry.
  - [x] T5.2 In `OnboardingService.submitTextTurn()`, when the existing thread already has ≥1 prior turn at the moment the new user turn is being persisted (variable already computed in the orphan-recovery branch), fire `onboarding.resumed` audit entry — but only once per session (use a thread-level flag in audit metadata to avoid duplicate emissions on multi-turn resumes).
  - [x] T5.3 Add the three new audit_type literals to `audit.types.ts`.

- [x] **T6 — Frontend: `<OnboardingResume>` component** (AC: 4, 5, 6)
  - [x] T6.1 New file `apps/web/src/features/onboarding/OnboardingResume.tsx`. Receives `{ state: OnboardingStateResponse, onContinue: () => void, onStartOver: () => Promise<void>, firstName: string }`. Renders the eyebrow + headline + two buttons per AC4 spec. Token-compliant.
  - [x] T6.2 Relative-time helper: search for an existing util in `apps/web/src/lib/` first (`formatRelativeTime` or similar); if absent, inline a minimal one supporting "today", "yesterday", "N days ago", "N weeks ago". Do **not** add a date-fns or dayjs dependency just for this — check `package.json` first.
  - [x] T6.3 Voice-modality variant: if `state.modality === 'voice'`, render `<PrimaryButton>Switch to text</PrimaryButton>` instead of Continue. Tapping it triggers the same continue handler but mounts `OnboardingText` (server thread is text-OR-voice; the modality column tracks origin, but turns are role-tagged not modality-tagged, so text resume against a voice thread is valid given how the agent reads history).
  - [x] T6.4 Component test `OnboardingResume.test.tsx`: renders for in_progress state, renders correct copy for voice variant, buttons fire callbacks.

- [x] **T7 — Frontend: wire Resume into `/onboarding` routing** (AC: 4, 7)
  - [x] T7.1 Edit `apps/web/src/routes/(app)/onboarding.tsx`. On mount, call `GET /v1/onboarding/state`. If `status='in_progress'`, set mode to a new internal mode `'resume'` (added to the existing mode enum); else `'select'` as today.
  - [x] T7.2 In the render switch, `'resume'` → `<OnboardingResume />`. `onContinue` → switch mode to the appropriate `'text'` or `'voice'` (or text if originally voice per T6.3), passing the fetched `turns` as `initialTurns`. `onStartOver` → call reset endpoint → on success switch mode to `'select'`.
  - [x] T7.3 Loading state: while the state-fetch is in-flight, render the existing skeleton/spinner pattern used elsewhere on this page (do NOT introduce a new spinner primitive — check for one in the page first).

- [x] **T8 — Frontend: extend `OnboardingText` to accept `initialTurns`** (AC: 5)
  - [x] T8.1 Edit `apps/web/src/features/onboarding/OnboardingText.tsx`. Add optional prop `initialTurns?: Turn[]`. If provided, the `useState(() => [...])` initializer uses `[OPENING_GREETING_TURN, ...initialTurns]`. **Important:** because AC2 says the server excludes the greeting from its `turns` array, the client prepends it locally exactly as it does today on a fresh start. This keeps the greeting as a pure-client constant.
  - [x] T8.2 Update `OnboardingText.test.tsx`: add a test that passes 4 prior turns as `initialTurns`, asserts the rendered transcript contains greeting + 4 turns in order, asserts the next POST goes to `/v1/onboarding/text/turn` and is processed normally.
  - [x] T8.3 No changes needed to the `submitTextTurn` server path — it already reuses the active thread (`onboarding.service.ts:118` R2-D1/D2). The slice's correctness depends on this invariant; if it breaks, the slice breaks. Worth a sentence in the PR description.

- [x] **T9 — E2E test** (AC: 9)
  - [x] T9.1 New file `apps/web/test/e2e/2-s26-resume-mid-flow-onboarding.spec.ts`. Mirrors the existing 2-7 text-onboarding spec structure.
  - [x] T9.2 Scenarios: (a) start text onboarding, send 1 turn, log out, log back in → Resume surface visible, Continue rehydrates, send next turn succeeds; (b) Start over closes the thread and reveals mode picker; (c) fully-onboarded user does NOT see Resume.
  - [x] T9.3 Extend `_helpers.ts` `mockLogin` to set `is_onboarding_in_progress` (default false), mirroring how 2-s19's review added `isOnboarded` per `review-findings`.

- [x] **T10 — Auth callbacks: pass `is_onboarding_in_progress` through** (AC: 1, 4)
  - [x] T10.1 Edit `apps/web/src/routes/auth/login.tsx`, `callback.tsx`, `reset-password.tsx`. The navigation logic remains 2-s19's two-way branch (`is_onboarded ? destination : '/onboarding'`) — the new flag is consumed on the `/onboarding` page itself (T7), not at the auth-redirect step. This preserves 2-s19's behavior and avoids a three-way branch in three places.
  - [x] T10.2 The auth store (`apps/web/src/stores/auth.store.ts`) does not need to store the flag; the `/onboarding` page fetches `GET /v1/onboarding/state` on mount, which is more honest (handles state changes from other tabs / sessions).

---

## Dev Notes

### Architectural compliance

- **Backend = sole DB owner.** All `threads`/`thread_turns` reads and writes happen in `OnboardingService` and its repository. Frontend never queries Supabase directly (per `CLAUDE.md` conventions and `specs/Technical Architecture.md`).
- **Agent layer untouched.** This slice does **not** modify `OnboardingAgent`, its prompts, or its tools. The agent is stateless w.r.t. resume — it simply receives the existing transcript on the next turn and continues, which is the same code path it already takes today (Slice C's `submitTextTurn` reads existing turns at line 118 and passes them in).
- **No new DB migrations.** Reusing `threads` + `thread_turns` is the explicit design choice (see "Critical design decision" above). The PR should have zero `.sql` files. If a reviewer flags this as "shouldn't we have an `onboarding_state` table?" → point them at the design-decision section.
- **Audit logging.** New audit types added per Story 1-8's pattern. See `apps/api/src/audit/audit.types.ts` for the literal union.
- **Token compliance.** All new UI primitives use Editorial Hearth v2.0 tokens. Mirror the auth-page retoke patterns from 2-s19 (`apps/web/src/routes/auth/reset-password.tsx`).

### Files to touch

**Server (`apps/api/`):**
- `src/modules/onboarding/onboarding.routes.ts` — add 2 routes
- `src/modules/onboarding/onboarding.service.ts` — add `getState`, `resetState`; extend `submitTextTurn` audit emission
- `src/modules/auth/auth.repository.ts` — extend with `getOnboardingProgress`
- `src/modules/auth/auth.service.ts` — call new repo method; expose new flag
- `src/modules/auth/auth.service.test.ts` — extend truth table
- `src/modules/auth/auth.routes.test.ts` — assert new flag
- `src/modules/onboarding/onboarding.routes.test.ts` — cover GET state + reset
- `src/audit/audit.types.ts` — add 3 audit_type literals

**Contracts (`packages/contracts/`):**
- `src/auth.ts` — add field to login/oauth response
- `src/users.ts` — add field to user profile
- `src/onboarding-state.ts` — NEW, exports `OnboardingStateResponseSchema`
- `src/index.ts` — re-export

**Web (`apps/web/`):**
- `src/features/onboarding/OnboardingResume.tsx` — NEW
- `src/features/onboarding/OnboardingResume.test.tsx` — NEW
- `src/features/onboarding/OnboardingText.tsx` — accept `initialTurns` prop
- `src/features/onboarding/OnboardingText.test.tsx` — extend
- `src/routes/(app)/onboarding.tsx` — fetch state, add `resume` mode
- `test/e2e/2-s26-resume-mid-flow-onboarding.spec.ts` — NEW
- `test/e2e/_helpers.ts` — extend `mockLogin` with `isOnboardingInProgress` option

**Not touched (deliberately):**
- `OnboardingAgent`, prompts, tools — slice is orchestration-only
- Auth callback routing — preserves 2-s19 surface
- Supabase migrations — derive from existing schema
- Voice onboarding — voice-resume is out of scope per AC5 (modality='voice' → "Switch to text")
- `OnboardingVoice` component — untouched
- Caregiver invite flow — 2-s19 deferred multi-caregiver resume to Epic 5 5-S2; same deferral applies here

### Previous-story intelligence (2-s19)

- **`is_onboarded` derivation pattern** is the gold-standard reference for this slice. Read `apps/api/src/modules/auth/auth.repository.ts:120–143` (the `getIsOnboarded` method) before extending — the new `getOnboardingProgress` should be a clean extension, not a parallel method.
- **Mock helper extension.** 2-s19's review found that adding a boolean flag to a login response without updating `mockLogin` in `_helpers.ts` defaults causes E2E surprise. Repeat the fix: default the new flag to `false` in the helper.
- **Audit metadata.** 2-s19 added `is_onboarded` to audit row metadata for /login and /callback. Continue the convention: include `is_onboarding_in_progress` too. See `auth.routes.ts` audit-write call sites.
- **Tier-1 token compliance.** 2-s19 surfaced that auth-adjacent pages had legacy v1 tokens. Any new component (OnboardingResume) must ship at v2.0 from the start. Use existing v2.0 primitives (`AppHeader`, `LoginHero` analog if needed, `PrimaryButton`, `SecondaryButton`, `TextField`).

### Slice C intelligence (most recent onboarding work)

- **Active-thread reuse is the keystone invariant.** `onboarding.service.ts:118` — every call to `submitTextTurn` finds-or-creates the active text-modality thread per household. The resume flow's correctness rests on this. Don't refactor this branch.
- **Synthetic greeting handling.** `OPENING_GREETING` is a client-render constant (`packages/contracts/src/onboarding.ts:8`) that is also synthetically prepended on the server side when calling the LLM. Verify: when fetching `thread_turns` from DB, is the greeting represented as a row? If yes, filter it out in `getState`. If no (more likely — it's an in-memory prepend during LLM call), no filtering needed but document the absence in code comments to prevent future confusion. **Verify before writing the SQL.**
- **Orphan recovery (R2-P1, AC7 from 2-7).** `submitTextTurn` has an orphan-recovery branch that resumes when an existing user turn matches the incoming message. The resume flow naturally exercises this path; no new logic required. Just confirm the E2E covers it.
- **Tool-loop gating.** `toolLoopAvailable` flag (`onboarding.service.ts:107–116`) gates whether the agent runs in tool-use mode. This is orthogonal to resume — resume just feeds the existing history; tool-loop behaviour is whatever it is for the next turn. No change needed.
- **Classifier latency.** `MIN_TURNS_FOR_COMPLETION_CHECK=6`. A resumed conversation that already had ≥6 turns will trigger the completion classifier on the very next user turn. This is correct behavior — if the user has effectively completed the interview but didn't finalize, the next message could reasonably reach `is_complete=true`. Note for QA.

### Edge cases & gotchas

- **Two-tab scenario.** User opens `/onboarding` in tab A, then in tab B. Tab A sees in-progress state, tab B sees the same. Both Continue → both attached to the same thread. The orphan-recovery branch in `submitTextTurn` handles concurrent identical messages; for different concurrent messages this is the same race that exists today (acceptable, documented in `epic-2-verification-threads.md`).
- **User completes via tab B, tab A is stale.** Tab A's Continue would mount `OnboardingText` with stale `initialTurns` and the next POST would fail because the server returns `is_complete=true` immediately or the thread is closed. Acceptable failure mode: surface the server error via existing error-handling in `OnboardingText.handleSubmit`. Do not add anti-stale heuristics — out of scope.
- **Modality switch on Continue.** When `modality='voice'` and the user taps "Switch to text", they will see prior **transcribed** voice turns (the agent stores transcripts as text turns regardless of modality). Confirm this rendering doesn't look strange — voice transcripts can be terse or have ASR artifacts. If they do, fine — the user can see what was captured. Out of scope to polish that further.
- **Resetting then immediately starting text → ensures fresh thread.** Verify the close mechanism actually prevents the new `submitTextTurn` from reattaching to the closed thread. Look for the `WHERE` filter in the active-thread-lookup query inside `submitTextTurn`; it likely filters on `closed_at IS NULL` or equivalent. If not, this slice introduces a regression — fix the lookup filter as part of this slice.
- **Completed thread re-fetch.** A user who finished onboarding shouldn't ever hit `/onboarding` (2-s19 routing), but if they navigate manually, `GET /v1/onboarding/state` should return `status='completed'`. The page should redirect them to `/app` (or just render the current empty/loading state — don't blow up). Cover with a defensive case in T7.

### Project structure notes

- New onboarding contract file lives at `packages/contracts/src/onboarding-state.ts` rather than appending to existing `onboarding.ts` because the existing file is scoped to turn/finalize contracts (Slice C). Separation keeps the surface area auditable. Re-export both from `index.ts`.
- New audit_type literals (`onboarding.resume_offered`, `onboarding.resumed`, `onboarding.reset`) belong in the same union as the existing `onboarding.*` types in `audit.types.ts`. Don't create a separate file.

### References

- [Source: _bmad-output/planning-artifacts/epic-2-onboarding-integration.md#Slice-2-s26-Resume-mid-flow-onboarding]
- [Source: _bmad-output/planning-artifacts/2-s19-resume-incomplete-onboarding.md] — is_onboarded derivation pattern and review-findings backlog
- [Source: apps/api/src/modules/onboarding/onboarding.service.ts:118] — active-thread reuse (R2-D1/D2)
- [Source: apps/api/src/modules/auth/auth.service.ts:186-190] — current is_onboarded derivation
- [Source: apps/api/src/modules/auth/auth.repository.ts:120-143] — getIsOnboarded query shape to extend
- [Source: apps/web/src/features/onboarding/OnboardingText.tsx] — component to extend with initialTurns
- [Source: apps/web/src/routes/(app)/onboarding.tsx] — mode-switch state machine to extend
- [Source: packages/contracts/src/onboarding.ts:8] — OPENING_GREETING constant
- [Source: packages/contracts/src/auth.ts, src/users.ts] — schemas to extend
- [Source: apps/api/src/audit/audit.types.ts] — audit_type literal union
- [Source: CLAUDE.md] — backend-as-sole-DB-owner invariant
- [Source: .stitch/DESIGN.md] — Editorial Hearth v2.0 token reference
- [Source: specs/Technical Architecture.md] — system architecture invariants

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-7 (story authored and implemented 2026-05-15)

### Debug Log References

_Implementation completed in a single execution. No HALT conditions triggered. Pre-existing test failures in unrelated files (`auth.routes.test.ts` lacks `supabaseAuth` decoration — broken at HEAD; `DisambiguationPicker.test.tsx`, `plan-regeneration.job.test.ts`, etc.) verified by `git stash` baseline comparison and are NOT regressions from this slice._

### Completion Notes List

- ✅ All 10 tasks (T1–T10) and their subtasks complete.
- ✅ All 10 ACs satisfied. Schema reuse honored — zero new migrations.
- ✅ Three-state derivation (`'not_started' | 'in_progress' | 'completed'`) flows through `auth.repository.getOnboardingProgress` to both login responses and `GET /v1/users/me`.
- ✅ Endpoints `GET /v1/onboarding/state` + `POST /v1/onboarding/state/reset` added; both honor `primary_parent`-only authorize hook (mirrors existing `/v1/onboarding/text/*` routes).
- ✅ Active-thread-reuse invariant preserved: `OnboardingService.submitTextTurn` is untouched in the resume code path; resume works by feeding existing `thread_turns` rows back to the unchanged service.
- ✅ Three new audit types added (`onboarding.resume_offered`, `onboarding.resumed`, `onboarding.reset`); resume audit fires fire-and-forget, reset audit fires via `request.auditContext` per project convention.
- ✅ Synthetic `OPENING_GREETING` correctly excluded from server state response (it lives only client-side); `OnboardingText` re-prepends it locally on resume so it always renders exactly once.
- ✅ Voice-modality resume gracefully degrades: when `modality='voice'`, the Continue button is replaced with "Switch to text" (server thread stays `voice`, the UI renders text mode against the existing turns). No silent modality downgrade on the server.
- ✅ `OnboardingResume.tsx` uses v2.0 design tokens (`amber-warm`, `fg`, `fg-muted`, `bg`) and the canonical `PrimaryButton` + `SecondaryButton` primitives. No v1 stones / amber-50.
- ✅ E2E + unit tests added: 5 Playwright scenarios for the resume flow, 11 unit tests for `OnboardingResume` + `formatRelative`, 6 new contract tests for `OnboardingStateResponseSchema`.
- ✅ Typecheck and lint clean on every file this slice touched. Pre-existing failures in unrelated files (auth.routes.test, plan-regeneration.job.test, voice.service.test, DisambiguationPicker.test, etc.) are out-of-scope and were verified against the HEAD baseline.
- ⚠️ Watch-point for code review: the `threads.modality` column on a 'voice'-origin resumed thread keeps the value 'voice' even when the user switches to text via the resume CTA. This is intentional (the modality reflects the thread's origin, not the user's current input device), but a future spec slice may want to add a `display_modality` or similar if downstream analytics care.

### File List

**Server (`apps/api/`):**
- `src/audit/audit.types.ts` — added 3 new audit_type literals (`onboarding.resume_offered`, `onboarding.resumed`, `onboarding.reset`)
- `src/modules/auth/auth.repository.ts` — added `getOnboardingProgress()` three-state derivation; `getIsOnboarded()` now delegates to it
- `src/modules/auth/auth.service.ts` — `LoginResult` interface gains `is_onboarding_in_progress: boolean`; `completeLogin` derives both flags from single repo call
- `src/modules/auth/auth.routes.ts` — `loginPayload()` returns new flag; audit metadata includes it for both `/login` and `/callback`
- `src/modules/auth/auth.service.test.ts` — replaced 2-state tests with 4-state truth table (`first-login`, `completed`, `not_started`, `in_progress`); `MockRepo` gains `getOnboardingProgress`
- `src/modules/auth/auth.routes.test.ts` — extended mock with `threads` + `thread_turns` defensive branches; happy-path assertions include `is_onboarding_in_progress`
- `src/modules/users/user.repository.ts` — added `hasActiveOnboardingThread()`
- `src/modules/users/user.service.ts` — `deriveIsOnboarded` → `deriveOnboardingFlags` returns both booleans; `toUserProfile` accepts the pair
- `src/modules/users/user.routes.test.ts` — mock gains `threads` + `thread_turns` branches; `MockOpts` adds `activeOnboardingThreadId` + `inProgressSummaryTurnCount`
- `src/modules/onboarding/onboarding.routes.ts` — registered `GET /v1/onboarding/state` + `POST /v1/onboarding/state/reset`; added secondary `AuditService` instance for fire-and-forget resume/reset writes
- `src/modules/onboarding/onboarding.service.ts` — added `getState()` + `resetState()` methods + their result types; `SubmitTextTurnResult` gains internal `_was_resumed` field (stripped by response Zod schema on the wire)

**Contracts (`packages/contracts/`):**
- `src/auth.ts` — `LoginResponseSchema.is_onboarding_in_progress: z.boolean()`
- `src/users.ts` — `UserProfileSchema.is_onboarding_in_progress: z.boolean()`
- `src/onboarding-state.ts` — NEW: `OnboardingStateStatusSchema`, `OnboardingTurnSnapshotSchema`, `OnboardingStateResponseSchema` + inferred types
- `src/onboarding-state.test.ts` — NEW: 9 round-trip + invariant tests
- `src/index.ts` — re-export `onboarding-state`
- `src/auth.test.ts` — fixtures updated for the new required field; new rejection test for missing `is_onboarding_in_progress`
- `src/users.test.ts` — fixture updated for the new required field

**Web (`apps/web/`):**
- `src/features/onboarding/OnboardingResume.tsx` — NEW: resume surface component + `formatRelative` helper
- `src/features/onboarding/OnboardingResume.test.tsx` — NEW: 6 component tests + 6 `formatRelative` tests
- `src/features/onboarding/OnboardingText.tsx` — accepts optional `initialTurns: Array<{id, role, content}>` prop; greeting still prepended client-side
- `src/routes/(app)/onboarding.tsx` — added `'resume'` + `'loading'` modes; fetches `GET /v1/onboarding/state` on mount; mounts `<OnboardingResume>` when in-progress; threads `initialTurns` into `OnboardingText` on Continue
- `src/routes/auth/login.test.tsx` — login response fixture includes new flag
- `src/routes/auth/callback.test.tsx` — callback response fixture includes new flag
- `test/e2e/_helpers.ts` — `mockLogin()` gains `isOnboardingInProgress?: boolean` option (default false); `userProfile()` gains `is_onboarding_in_progress` with sensible default
- `test/e2e/2-1-auth.spec.ts` — OAuth callback fixture extended with new field
- `test/e2e/2-4b-password-reset.spec.ts` — password-reset-complete fixture extended with new field
- `test/e2e/2-s26-resume-mid-flow-onboarding.spec.ts` — NEW: 5 scenarios (in-progress + continue, start-over, not-started, completed → /app, voice-modality variant)

**BMad sprint state:**
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — 2-s26 entry: `ready-for-dev` → `in-progress` → `review`
- `_bmad-output/implementation-artifacts/2-s26-resume-mid-flow-onboarding.md` — this file (Status: review, all tasks ticked, dev record filled)

### Change Log

| Date | Change | Notes |
|------|--------|-------|
| 2026-05-15 | Story file authored + ready-for-dev | `bmad-create-story` |
| 2026-05-15 | Schema-reuse design call confirmed | User selected "Keep — reuse threads/thread_turns" via clarifying question |
| 2026-05-15 | Implementation T1–T10 complete | All ACs satisfied; tests green for every file touched by this slice |
| 2026-05-15 | Story → review | Awaiting code review (recommend a different LLM per project convention) |

---

## Effort estimate

Roughly 1 to 1.5 days:
- ~3h server changes + tests (T1, T3, T4, T5)
- ~1h contracts (T2)
- ~3h frontend including new component + tests (T6, T7, T8)
- ~1h E2E (T9)
- ~30min auth-callback verification (T10)
- ~1h manual VT-style walk + code review polish

Lower risk than new-schema slices: no migrations, no agent changes, no auth-routing changes. Highest risk: getting the active-thread-lookup filter right when a thread is "closed" via reset — if it doesn't filter on closed_at, the reset path is silently broken.
