# Story 12-S12: Orb Breathing, Nudge SSE Delivery + Opt-Out

Status: done

## Story

As a parent using HiveKitchen,
I want the Lumi orb to gently pulse when a proactive nudge is waiting for me,
and to be able to disable these nudges from the panel or account settings,
so that Lumi's proactive presence is helpful, not intrusive.

## Acceptance Criteria

1. **Given** `proactive_lumi_nudges` is a new boolean field in `notification_prefs`, **When** the DB migration runs, **Then** all existing `users.notification_prefs` JSONB values are backfilled with `"proactive_lumi_nudges": true` (if the key is absent), and the column default is updated to include the field as `true`.

2. **Given** the updated contract, **When** `NotificationPrefsSchema` is parsed, **Then** it requires `proactive_lumi_nudges: boolean`. `UpdateNotificationPrefsRequestSchema` accepts `proactive_lumi_nudges: boolean` as an optional patch field. Both schemas are exported from `@hivekitchen/contracts`.

3. **Given** the user service, **When** `updateNotificationPrefs()` is called, **Then** `proactive_lumi_nudges` is merged with the same `?? true` default pattern used for `weekly_plan_ready` and `grocery_list_ready`. `toUserProfile()` maps the field with the same `?? true` fallback for rows lacking it.

4. **Given** `sseDispatcherPlugin` is registered in `app.ts` before all route plugins, **When** any route plugin calls `fastify.sseDispatcher`, **Then** the decorator is available. The dispatcher stores connections in a `Map<householdId, Set<ServerResponse>>` (in-process, single-node). No cross-process fan-out in S12 — that is Epic 5 (5-S1).

5. **Given** `GET /v1/events` is open and authenticated, **When** the stream connects, **Then** `fastify.sseDispatcher.register(householdId, reply.raw)` is called. When the stream closes or errors, `fastify.sseDispatcher.unregister(householdId, reply.raw)` is called. The existing heartbeat every 20s is preserved.

6. **Given** `notification_prefs.proactive_lumi_nudges === false` for the household's primary parent, **When** `runLumiNudge()` runs, **Then** it returns immediately — `persistNudge()` is NOT called, no turn is persisted, no SSE is emitted. A single `info` log entry records the skip with `{ household_id, action: 'lumi.nudge.skipped_opt_out' }`.

7. **Given** `proactive_lumi_nudges` is `true` (or absent, defaulting to true), **When** `runLumiNudge()` runs, **Then** the Redis key `lumi:nudge:household:{id}` is read before calling `persistNudge()`. `persistNudge()` is called unconditionally (persistence is not gated). After `persistNudge()` returns, SSE is emitted ONLY if the key was NOT set at read time.

8. **Given** SSE should be emitted (key was not set before persist), **When** `persistNudge()` returns a `Turn`, **Then** `fastify.sseDispatcher.emit(householdId, 'lumi.nudge', JSON.stringify({ type: 'lumi.nudge', turn, surface }))` is called. The payload is a valid `LumiNudgeEvent`.

9. **Given** `useLumiNudgeSSE()` is mounted in `AppScopeLayout`, **When** the user has a valid `accessToken`, **Then** an `EventSource` is opened at `/v1/events?client_id=<uuid>&token=<accessToken>`. On a `lumi.nudge` message event, the payload is parsed against `LumiNudgeEventSchema`; if valid, `useLumiStore.getState().setNudge(parsed.turn)` is called. If the panel is already open on the matching surface, `appendTurn(parsed.turn)` is also called so the turn appears immediately. The `EventSource` is closed and replaced when `accessToken` changes.

10. **Given** `pendingNudge` is non-null in `lumi.store.ts`, **When** the user opens the Lumi panel (calls `openPanel()`), **Then** `pendingNudge` is cleared to `null` as part of the same state update. The orb animation (already driven by `pendingNudge !== null`) reverts to calm without any animation logic changes.

11. **Given** the LumiPanel is open, **When** the user sees a "Pause nudges" / "Resume nudges" toggle in the panel (always visible, not conditional on a nudge being present), **Then** toggling it calls `PATCH /v1/users/me/notification-prefs` with `{ proactive_lumi_nudges: <new value> }`. The toggle reflects the current value from the user store. Optimistic update: toggle the local store value immediately; revert on API error.

12. **Given** the `/account` page, **When** the user views the notifications section, **Then** a "Lumi proactive nudges" row with a toggle is present alongside the existing `weekly_plan_ready` and `grocery_list_ready` rows. Toggling it calls the same PATCH endpoint and updates `notifPrefs.proactive_lumi_nudges` in local state.

## Tasks / Subtasks

- [x] Task 1 — DB migration: `proactive_lumi_nudges` in `notification_prefs` (AC: #1)
  - [x] Create `supabase/migrations/20261017000000_notification_prefs_proactive_nudges.sql`
  - [x] Backfill all existing rows where the key is absent:
    ```sql
    UPDATE users
    SET notification_prefs = notification_prefs || '{"proactive_lumi_nudges": true}'::jsonb
    WHERE notification_prefs->>'proactive_lumi_nudges' IS NULL;
    ```
  - [x] Update column default to include the new field:
    ```sql
    ALTER TABLE users
    ALTER COLUMN notification_prefs
    SET DEFAULT '{"weekly_plan_ready": true, "grocery_list_ready": true, "proactive_lumi_nudges": true}'::jsonb;
    ```
  - [x] No index — `notification_prefs` is queried by key only in the nudge job hot path; a full JSON index is not warranted at MVP

- [x] Task 2 — Contract: `packages/contracts/src/users.ts` (AC: #2)
  - [x] Add `proactive_lumi_nudges: z.boolean()` to `NotificationPrefsSchema`:
    ```ts
    export const NotificationPrefsSchema = z.object({
      weekly_plan_ready: z.boolean(),
      grocery_list_ready: z.boolean(),
      proactive_lumi_nudges: z.boolean(),   // NEW
    });
    ```
  - [x] Add `proactive_lumi_nudges: z.boolean().optional()` to `UpdateNotificationPrefsRequestSchema`
  - [x] Update the `.refine()` condition to include `d.proactive_lumi_nudges !== undefined` in the OR chain (the guard ensures at least one field is provided)
  - [x] `NotificationPrefs` type is inferred via `z.infer<>` — no manual type update needed
  - [x] Add contract round-trip tests in `packages/contracts/src/users.test.ts`:
    - `NotificationPrefsSchema.parse({ weekly_plan_ready: true, grocery_list_ready: true, proactive_lumi_nudges: false })` — passes
    - `NotificationPrefsSchema.parse({ weekly_plan_ready: true, grocery_list_ready: true })` — throws (missing required field)
    - `UpdateNotificationPrefsRequestSchema.parse({ proactive_lumi_nudges: false })` — passes (single-field patch)

- [x] Task 3 — API: `user.service.ts` — extend merge + `toUserProfile` (AC: #3)
  - [x] In `updateNotificationPrefs()`, extend the `merged` object type and logic:
    ```ts
    const merged: { weekly_plan_ready: boolean; grocery_list_ready: boolean; proactive_lumi_nudges: boolean } = {
      weekly_plan_ready: currentRow.notification_prefs?.weekly_plan_ready ?? true,
      grocery_list_ready: currentRow.notification_prefs?.grocery_list_ready ?? true,
      proactive_lumi_nudges: currentRow.notification_prefs?.proactive_lumi_nudges ?? true,  // NEW
    };
    if (input.weekly_plan_ready !== undefined) merged.weekly_plan_ready = input.weekly_plan_ready;
    if (input.grocery_list_ready !== undefined) merged.grocery_list_ready = input.grocery_list_ready;
    if (input.proactive_lumi_nudges !== undefined) merged.proactive_lumi_nudges = input.proactive_lumi_nudges;  // NEW
    ```
  - [x] In `toUserProfile()`, extend the `notification_prefs` mapping:
    ```ts
    notification_prefs: {
      weekly_plan_ready: row.notification_prefs?.weekly_plan_ready ?? true,
      grocery_list_ready: row.notification_prefs?.grocery_list_ready ?? true,
      proactive_lumi_nudges: row.notification_prefs?.proactive_lumi_nudges ?? true,  // NEW
    },
    ```
  - [x] Update `UpdateUserProfileInput.notification_prefs` type in `user.repository.ts` to include `proactive_lumi_nudges?: boolean`
  - [x] Update `UserProfileRow.notification_prefs` type to include `proactive_lumi_nudges?: boolean`

- [x] Task 4 — API: `user.repository.ts` — `findPrimaryParentForHousehold` (AC: #6, #7)
  - [x] Add method to `UserRepository`:
    ```ts
    async findPrimaryParentForHousehold(householdId: string): Promise<UserProfileRow | null> {
      const { data, error } = await this.client
        .from('users')
        .select(PROFILE_COLUMNS)
        .eq('current_household_id', householdId)
        .eq('role', 'primary_parent')
        .maybeSingle();
      if (error) throw error;
      return (data as UserProfileRow | null) ?? null;
    }
    ```
  - [x] Column is `current_household_id` — confirmed in `account-deletion.job.ts:144` and `kitchen-map.repository.ts:301`
  - [x] Add a test in `apps/api/src/modules/users/user.repository.test.ts` — mock returns primary_parent row with `notification_prefs`; verify method plucks it; mock null → returns null

- [x] Task 5 — API: `apps/api/src/plugins/sse-dispatcher.plugin.ts` (new file) (AC: #4)
  - [x] Create Fastify plugin using `fastify-plugin`:
    ```ts
    import fp from 'fastify-plugin';
    import type { FastifyPluginAsync } from 'fastify';
    import type { ServerResponse } from 'node:http';

    export interface SseDispatcher {
      register(householdId: string, res: ServerResponse): void;
      unregister(householdId: string, res: ServerResponse): void;
      emit(householdId: string, event: string, data: string): void;
    }

    declare module 'fastify' {
      interface FastifyInstance {
        sseDispatcher: SseDispatcher;
      }
    }

    const sseDispatcherPlugin: FastifyPluginAsync = async (fastify) => {
      const connections = new Map<string, Set<ServerResponse>>();

      fastify.decorate('sseDispatcher', {
        register(householdId, res) {
          if (!connections.has(householdId)) connections.set(householdId, new Set());
          connections.get(householdId)!.add(res);
        },
        unregister(householdId, res) {
          const set = connections.get(householdId);
          if (!set) return;
          set.delete(res);
          if (set.size === 0) connections.delete(householdId);
        },
        emit(householdId, event, data) {
          const set = connections.get(householdId);
          if (!set || set.size === 0) return;
          const payload = `event: ${event}\ndata: ${data}\n\n`;
          for (const res of set) {
            try { res.write(payload); } catch { set.delete(res); }
          }
          if (set.size === 0) connections.delete(householdId);
        },
      } satisfies SseDispatcher);
    };

    export default fp(sseDispatcherPlugin, { name: 'sse-dispatcher' });
    ```
  - [x] Export `SseDispatcher` interface — it is imported by `lumi-nudge.job.ts`
  - [x] Write unit test `apps/api/src/plugins/sse-dispatcher.plugin.test.ts` (no Fastify needed — test the object directly):
    - `register` + `emit` writes payload to res mock
    - `unregister` removes the connection; empty set removes the household key
    - `emit` to unknown household is a no-op

- [x] Task 6 — API: `app.ts` — register `sseDispatcherPlugin` (AC: #4)
  - [x] Import and register `sseDispatcherPlugin` before `eventsRoutes` and `lumiNudgeJobPlugin`
  - [x] Match the existing pattern: `await fastify.register(sseDispatcherPlugin)` with other infrastructure plugins

- [x] Task 7 — API: `apps/api/src/routes/v1/events/events.routes.ts` — wire dispatcher (AC: #5)
  - [x] After `reply.hijack()` and the SSE header writes, register the connection:
    ```ts
    fastify.sseDispatcher.register(payload.hh, reply.raw);
    ```
  - [x] On stream close, unregister:
    ```ts
    reply.raw.on('close', () => {
      fastify.sseDispatcher.unregister(payload.hh, reply.raw);
      clearInterval(heartbeat);
    });
    ```
  - [x] Move the `clearInterval(heartbeat)` into the `close` handler (it is currently separate — remove any existing close handler and consolidate into one)
  - [x] The `payload.hh` field is the `householdId` extracted from the verified JWT — confirm this field name by checking the JWT payload shape in the existing route

- [x] Task 8 — API: `apps/api/src/jobs/lumi-nudge.job.ts` — extend and add logic (AC: #6, #7, #8)
  - [x] Import `SseDispatcher` from the plugin and `UserRepository` from the users module
  - [x] Extend `LumiNudgeDeps`:
    ```ts
    export interface LumiNudgeDeps {
      lumiService: LumiService;
      logger: FastifyBaseLogger;
      redis: Redis;                          // NEW
      userRepository: UserRepository;        // NEW
      sseDispatcher: SseDispatcher;          // NEW
    }
    ```
  - [x] Rewrite `runLumiNudge` body:
    ```ts
    export async function runLumiNudge(deps: LumiNudgeDeps, data: LumiNudgeJobData): Promise<void> {
      try {
        // 1. Opt-out check — full skip if primary parent has disabled nudges
        const parent = await deps.userRepository.findPrimaryParentForHousehold(data.household_id);
        if (parent?.notification_prefs?.proactive_lumi_nudges === false) {
          deps.logger.info(
            { module: 'lumi', action: 'lumi.nudge.skipped_opt_out', household_id: data.household_id },
            'lumi nudge skipped — proactive nudges opted out',
          );
          return;
        }

        // 2. Read rate-limit gate BEFORE persist (S11 persistNudge sets NX EX 1800)
        const RATE_KEY = `lumi:nudge:household:${data.household_id}`;
        const wasRateLimited = (await deps.redis.get(RATE_KEY)) !== null;

        // 3. Persist unconditionally (S11 design: second nudge is persisted but SSE suppressed)
        const turn = await deps.lumiService.persistNudge({
          householdId: data.household_id,
          trigger: data.trigger,
          surface: data.surface,
          planContext: data.plan_context,
        });
        deps.logger.info(
          { module: 'lumi', action: 'lumi.nudge.persisted', household_id: data.household_id, trigger: data.trigger },
          'lumi nudge persisted',
        );

        // 4. Emit SSE only if this is the first nudge in the rate-limit window
        if (!wasRateLimited) {
          const event: LumiNudgeEvent = { type: 'lumi.nudge', turn, surface: data.surface };
          deps.sseDispatcher.emit(data.household_id, 'lumi.nudge', JSON.stringify(event));
        }
      } catch (err) {
        deps.logger.warn(
          { err, module: 'lumi', action: 'lumi.nudge.failed', household_id: data.household_id, trigger: data.trigger },
          'lumi nudge failed — fire-and-forget, not retried',
        );
      }
    }
    ```
  - [x] Import `LumiNudgeEvent` from `@hivekitchen/types`; import `Redis` from `ioredis`
  - [x] In the Fastify plugin body (`lumiNudgePlugin`), construct `UserRepository` and pass it to `runLumiNudge` via the deps:
    ```ts
    const userRepository = new UserRepository(fastify.supabase);
    fastify.bullmq.getWorker(
      NUDGE_QUEUE,
      async (job: Job<LumiNudgeJobData>) => {
        await runLumiNudge(
          { lumiService, logger: fastify.log, redis: fastify.redis, userRepository, sseDispatcher: fastify.sseDispatcher },
          job.data,
        );
      },
      { concurrency: 5 },
    );
    ```
  - [x] `sseDispatcherPlugin` must be registered before `lumiNudgeJobPlugin` in `app.ts` (Task 6 ensures this)
  - [x] Add new tests to `apps/api/src/jobs/lumi-nudge.job.test.ts`:
    - **Opt-out skip**: parent row has `proactive_lumi_nudges: false` → `persistNudge` is never called; SSE not emitted
    - **Parent not found (null)**: `findPrimaryParentForHousehold` returns `null` → nudge proceeds (treat null as opted-in)
    - **Rate-limited (SSE suppressed)**: Redis returns `'1'` → `persistNudge` called, SSE dispatcher `emit` NOT called
    - **Not rate-limited (SSE emitted)**: Redis returns `null` → `persistNudge` called, `sseDispatcher.emit` called with `'lumi.nudge'` and the serialized `LumiNudgeEvent`
    - **persistNudge throws**: error is caught and logged; `sseDispatcher.emit` not called

- [x] Task 9 — Web: `apps/web/src/hooks/useLumiNudgeSSE.ts` (new file) (AC: #9)
  - [x] Create hook:
    ```ts
    import { useEffect } from 'react';
    import { LumiNudgeEventSchema } from '@hivekitchen/contracts';
    import { useLumiStore } from '@/stores/lumi.store.js';

    export function useLumiNudgeSSE(accessToken: string | null): void {
      useEffect(() => {
        if (!accessToken) return;

        const clientId = crypto.randomUUID();
        const url = `/v1/events?client_id=${encodeURIComponent(clientId)}&token=${encodeURIComponent(accessToken)}`;
        const es = new EventSource(url);

        function onNudge(e: MessageEvent) {
          try {
            const parsed = LumiNudgeEventSchema.parse(JSON.parse(e.data as string));
            const store = useLumiStore.getState();
            store.setNudge(parsed.turn);
            // Append directly if panel is open on matching surface — avoids close/reopen for live updates
            if (store.isPanelOpen && store.surface === parsed.surface) {
              store.appendTurn(parsed.turn);
            }
          } catch {
            // malformed event — ignore
          }
        }

        es.addEventListener('lumi.nudge', onNudge);
        return () => {
          es.removeEventListener('lumi.nudge', onNudge);
          es.close();
        };
      }, [accessToken]);
    }
    ```
  - [x] `accessToken` is passed by the caller (layout.tsx reads it from auth store) — keeps the hook portable and testable
  - [x] Write `apps/web/src/hooks/useLumiNudgeSSE.test.ts` (new file):
    - Mock `EventSource` globally; verify `addEventListener('lumi.nudge', ...)` is called on mount
    - Valid `lumi.nudge` event → `setNudge` called with parsed turn
    - Panel open + matching surface → `appendTurn` also called
    - Panel closed → `appendTurn` NOT called
    - Malformed JSON → no throw, no state change
    - Token change → old `EventSource` is closed, new one opened
    - Token null → no `EventSource` created

- [x] Task 10 — Web: `apps/web/src/routes/(app)/layout.tsx` — mount SSE hook (AC: #9)
  - [x] Import `useLumiNudgeSSE` and the auth store
  - [x] Read `accessToken` from auth store (use the same pattern as `useLumiVoiceSession` for auth access)
  - [x] Call `useLumiNudgeSSE(accessToken)` at the top of `AppScopeLayout` — no JSX changes

- [x] Task 11 — Web: `apps/web/src/stores/lumi.store.ts` — `openPanel` clears nudge (AC: #10)
  - [x] Update `openPanel` to clear `pendingNudge`:
    ```ts
    openPanel: (mode) =>
      set((state) => ({
        isPanelOpen: true,
        panelMode: mode ?? state.panelMode,
        pendingNudge: null,   // NEW — orb stops breathing when panel opens
      })),
    ```
  - [x] Add test in `apps/web/src/stores/lumi.store.test.ts`:
    - Set `pendingNudge` via `setNudge(someTurn)` then call `openPanel()` → `pendingNudge` is `null`

- [x] Task 12 — Web: `apps/web/src/components/LumiPanel.tsx` — opt-out toggle (AC: #11)
  - [x] Read `proactive_lumi_nudges` from user profile store (auth store / user profile data)
  - [x] Add a compact toggle button in the LumiPanel footer or below the mode bar. Minimal UI — a text link or small switch:
    - Label: `"Pause nudges"` when `proactive_lumi_nudges === true`; `"Resume nudges"` when `false`
    - On click: optimistically toggle local value; call `PATCH /v1/users/me/notification-prefs` with `{ proactive_lumi_nudges: !currentValue }`; revert on error
  - [x] Keep the toggle subtle — it should not compete with the Lumi conversation. Consider placing it in a settings footer below the thread area, styled as a muted text button
  - [x] Update `apps/web/src/components/LumiPanel.test.tsx`:
    - Renders "Pause nudges" when `proactive_lumi_nudges` is `true`
    - Renders "Resume nudges" when `proactive_lumi_nudges` is `false`
    - Clicking calls PATCH with correct payload

- [x] Task 13 — Web: `apps/web/src/routes/(app)/account.tsx` — settings toggle (AC: #12)
  - [x] Extend `notifPrefs` initial state: `{ weekly_plan_ready: true, grocery_list_ready: true, proactive_lumi_nudges: true }`
  - [x] Add `proactive_lumi_nudges` key to `handleNotificationToggle` — no logic change needed if it uses `field: keyof NotificationPrefs`
  - [x] Add the toggle row in the notifications section:
    ```tsx
    <NotificationToggleRow
      label="Lumi proactive nudges"
      description="Lumi sends you a brief message when your plan is ready or something changes."
      checked={notifPrefs.proactive_lumi_nudges}
      onChange={(checked) => handleNotificationToggle('proactive_lumi_nudges', checked)}
    />
    ```
    (match the existing pattern for `weekly_plan_ready` and `grocery_list_ready` rows — no new component needed if a shared row component already exists)

## Dev Notes

### SSE dispatcher — single-process only
`sseDispatcherPlugin` uses an in-memory `Map`. This is correct for MVP. When Epic 5 (5-S1) ships Redis pub/sub per-tab SSE, the plugin's `emit()` will be replaced with a Redis `PUBLISH`. The `SseDispatcher` interface is the contract; callers (`events.routes.ts`, `lumi-nudge.job.ts`) do not need to change.

### Rate-limit TOCTOU
The Redis read in step 2 and the NX SET inside `persistNudge()` are not atomic. Under concurrent job execution for the same household, two workers could both observe a missing key and both emit SSE. BullMQ's default single-worker-per-queue behaviour makes this extremely unlikely at MVP concurrency levels — no additional locking is required.

### JWT payload field for householdId
The `events.routes.ts` JWT token is verified with `fastify.jwt.verify(token)`. Check the verified payload shape — the household field is likely `hh` (matching the existing heartbeat stub). Verify before using `payload.hh`.

### `current_household_id` column
The `users` table column linking a user to their household is `current_household_id`, not `household_id`. Confirmed in `account-deletion.job.ts:144` and `kitchen-map.repository.ts:301`.

### Auth store accessToken
In `layout.tsx`, the `accessToken` for the SSE `?token=` parameter should be read from the auth store using the same mechanism as other authenticated calls. If the auth store holds a Supabase session object, the access token is typically at `session.access_token`. Verify the exact selector before coding.

### `LumiNudgeEvent` type
`LumiNudgeEventSchema` and its inferred `LumiNudgeEvent` type already exist in `packages/contracts/src/lumi.ts` (added in the S11 pre-population step). No contracts changes needed for the event schema.

### Zod version
The project uses Zod 4, not 3.23. `z.boolean()`, `z.object()`, `.refine()`, and `.optional()` have the same API in Zod 4 as in Zod 3 — the only difference at this story's scope is that `.extend()` behaviour is stable and `z.infer<>` works identically.

### `UserRepository` import in nudge job
The nudge job plugin currently imports `LumiRepository` from the lumi module. Add `UserRepository` from `../../modules/users/user.repository.js`. Both extend `BaseRepository` and take the same Supabase client in their constructor.

### LumiPanel — where to source notification prefs
The LumiPanel currently has no user-profile store access. For S12, source `proactive_lumi_nudges` from wherever the account page reads it (the same auth or user Zustand store). Do not create a new store or duplicate state — use the existing pattern.

### Opt-out is a full skip — no thread write
When opted out, `persistNudge()` is NOT called. No nudge turn is created in the DB. This is the intended behaviour — opted-out users have a clean thread with no background pollution.

### Second nudge within rate-limit window
When the Redis key is already set (rate-limited), `persistNudge()` still runs and inserts a turn (S11 AC4: "persistence is unconditional"). SSE is not emitted. This means the second nudge turn will appear in the panel thread when the user next opens it — this is correct. The orb does not breathe again.

## Dev Agent Record

### Implementation Plan
Built bottom-up: migration → contract → API service/repository → SSE dispatcher plugin → app wiring → events route → nudge worker → web hook → layout mount → store → panel toggle → account toggle. Red-green per layer; full regression at the end.

### Completion Notes
Implemented all 12 ACs / 13 tasks for Story 12-S12 (orb breathing, nudge SSE delivery + opt-out).

**Backend**
- Migration `20261017000000_notification_prefs_proactive_nudges.sql` — JSONB backfill (`|| '{"proactive_lumi_nudges": true}'` where key absent) + widened column DEFAULT. **USER-SIDE GATE: `supabase db push --include-all`.**
- `NotificationPrefsSchema` now requires `proactive_lumi_nudges: boolean`; `UpdateNotificationPrefsRequestSchema` accepts it as an optional patch field (refine OR-chain extended). `NotificationPrefs` type re-inferred — no manual edit.
- `UserService.updateMyNotifications` merge + `toUserProfile` both extended with the `?? true` fallback. `UserProfileRow` / `UpdateUserProfileInput` `notification_prefs` shapes gained the optional field.
- `UserRepository.findPrimaryParentForHousehold(householdId)` — `.eq('current_household_id').eq('role','primary_parent').maybeSingle()`.
- New `sseDispatcherPlugin` (`apps/api/src/plugins/sse-dispatcher.plugin.ts`) — in-process `Map<householdId, Set<ServerResponse>>` registry exposing `register`/`unregister`/`emit`; a write that throws drops that connection. Registered in `app.ts` after bullmq, before `eventsRoutes` and `lumiNudgeJobPlugin`.
- `events.routes.ts` — registers `reply.raw` on connect; unregisters in the existing `request.raw.on('close')` handler (consolidated with `clearInterval`); heartbeat preserved.
- `runLumiNudge` extended with three deps (`redis`, `userRepository`, `sseDispatcher`): opt-out short-circuit (null parent = opted-in), pre-persist Redis gate read, unconditional persist, SSE emit only when the window was empty. Plugin body constructs `UserRepository` and passes `fastify.redis` + `fastify.sseDispatcher`.

**Frontend**
- New `useLumiNudgeSSE(accessToken)` hook — opens its own `EventSource` (the existing `lib/realtime/sse.ts` bridge only handles the default `message`/`InvalidationEvent`; nudges arrive as a NAMED `lumi.nudge` event). Parses with `LumiNudgeEventSchema.safeParse`, `setNudge` + live `appendTurn` when panel open on matching surface; reopens on token change. Mounted in `AppScopeLayout` reading `accessToken` from the auth store.
- `lumi.store.ts` — `openPanel` now clears `pendingNudge` (AC#10); added `proactiveNudges` (default `true`) + `setProactiveNudges`.
- `LumiPanel.tsx` — muted "Pause nudges"/"Resume nudges" footer toggle, optimistic store update + PATCH, revert on error.
- `account.tsx` — `proactive_lumi_nudges` row in the notifications section (reuses `handleNotificationToggle`), initial state + lumi-store sync on load and on toggle success.

### Spec ↔ codebase reconciliations
1. **PATCH path** — ACs #11/#12 say `PATCH /v1/users/me/notification-prefs`; the real route is `PATCH /v1/users/me/notifications`. Used the existing route (no new endpoint).
2. **"user store" for the panel toggle** — no user-profile Zustand store exists (account page holds `/me` in local component state). Per the Dev Note ("don't create a new store"), added `proactiveNudges` to the existing **lumi** store (cohesive with the orb/panel) and sync the canonical value from the account page (load + toggle). Known minor edge: if a previously-opted-out user opens the panel before ever loading `/account` this session, the label shows "Pause nudges" (default `true`) until synced; the orb itself is always correct (server suppresses the SSE when opted out). Did NOT fetch `/me` inside the panel — that would have broken the existing thread-hydration "does not call fetch" assertions.
3. **SSE URL base** — ACs #9 implies a relative `/v1/events`; the app is cross-origin, so the hook builds the URL with `VITE_SSE_BASE_URL ?? VITE_API_BASE_URL` exactly as `lib/realtime/sse.ts` does.
4. **`NotificationToggleRow`** — the story's Task 13 snippet references a `NotificationToggleRow` component that does not exist; matched the existing inline `<label>` checkbox pattern already used for `weekly_plan_ready`/`grocery_list_ready`.
5. **SSE plugin export** — used a named export `sseDispatcherPlugin` (project convention) rather than the story's `export default`.

### Verification
- Typecheck: 0 new errors in any changed file. Pre-existing baselines unchanged — API (`evals/runner`, `households/health/voice` tests, `voice.routes`), web (`child-bag-composition.tsx`, `heart-notes.ts`), contracts/types (`heart-notes.ts` Zod-4 `$ZodIssue`).
- Contracts: `users.test.ts` 40/40.
- API targeted: `lumi-nudge.job` + `sse-dispatcher.plugin` + `user.repository` + `user.routes` = 35/35. Full API suite 1644 pass / 20 fail (20 = documented pre-existing baseline; none in touched files) / 13 skipped.
- Web: full suite 498/498 pass (incl. new `useLumiNudgeSSE` 9, `lumi.store` +1, `LumiPanel` +4).

### File List
**Added**
- `supabase/migrations/20261017000000_notification_prefs_proactive_nudges.sql`
- `apps/api/src/plugins/sse-dispatcher.plugin.ts`
- `apps/api/src/plugins/sse-dispatcher.plugin.test.ts`
- `apps/api/src/modules/users/user.repository.test.ts`
- `apps/web/src/hooks/useLumiNudgeSSE.ts`
- `apps/web/src/hooks/useLumiNudgeSSE.test.ts`

**Modified**
- `packages/contracts/src/users.ts`
- `packages/contracts/src/users.test.ts`
- `apps/api/src/modules/users/user.service.ts`
- `apps/api/src/modules/users/user.repository.ts`
- `apps/api/src/modules/users/user.routes.test.ts`
- `apps/api/src/app.ts`
- `apps/api/src/routes/v1/events/events.routes.ts`
- `apps/api/src/jobs/lumi-nudge.job.ts`
- `apps/api/src/jobs/lumi-nudge.job.test.ts`
- `apps/web/src/routes/(app)/layout.tsx`
- `apps/web/src/stores/lumi.store.ts`
- `apps/web/src/stores/lumi.store.test.ts`
- `apps/web/src/components/LumiPanel.tsx`
- `apps/web/src/components/LumiPanel.test.tsx`
- `apps/web/src/routes/(app)/account.tsx`
- `apps/web/src/routes/(app)/account.test.tsx`
- `apps/web/src/routes/(app)/account-deletion.test.tsx`
- `apps/web/src/routes/(app)/account-export.test.tsx`
- `apps/web/test/e2e/_helpers.ts`

### Change Log
- 2026-06-06 — Implemented Story 12-S12: proactive-nudge opt-out (`notification_prefs.proactive_lumi_nudges`), in-process SSE dispatcher, nudge worker opt-out + rate-limit-aware SSE emit, `useLumiNudgeSSE` hook, orb-breath clear on panel open, in-panel + account opt-out toggles. All 12 ACs / 13 tasks complete. Status → review.

### Review Findings

- [x] [Review][Patch] P1: SSE `error` event does not call `unregister` — AC#5 requires unregister on both close AND error; only `close` is handled [`apps/api/src/routes/v1/events/events.routes.ts:~77`] — FIXED: added `fastify.sseDispatcher.unregister(payload.hh, reply.raw)` in the error handler
- [x] [Review][Patch] P2: `emit()` writes to `writableEnded` streams — `write()` on an ended stream emits a silent `ERR_STREAM_WRITE_AFTER_END` error event (not a throw), so the catch block never prunes the dead connection; it stays registered until the next emit cycle, spamming the error handler [`apps/api/src/plugins/sse-dispatcher.plugin.ts:40-46`] — FIXED: added `writableEnded` guard before `res.write()`
- [x] [Review][Defer] D1: TOCTOU Redis gate read/SET under concurrency:5 — double SSE emit possible; accepted in Dev Notes [`apps/api/src/jobs/lumi-nudge.job.ts:57`] — deferred, pre-existing S11 design decision
- [x] [Review][Defer] D2: Opt-out DB failure silently absorbed by outer catch — indistinguishable from persistNudge failure in logs [`apps/api/src/jobs/lumi-nudge.job.ts:46`] — deferred, fire-and-forget design
- [x] [Review][Defer] D3: Access token as URL query param in `useLumiNudgeSSE` — JWT in server access logs; pre-existing pattern from `sse.ts` [`apps/web/src/hooks/useLumiNudgeSSE.ts:25`] — deferred, pre-existing
- [x] [Review][Defer] D4: `proactiveNudges` store defaults `true` before `/account` loads — wrong label for opted-out users until first `/me` fetch; documented in reconciliation #2 [`apps/web/src/stores/lumi.store.ts:64`] — deferred, documented known edge
- [x] [Review][Defer] D5: `setNudge` fires even when `appendTurn` fires (orb breathes on live panel nudge) [`apps/web/src/hooks/useLumiNudgeSSE.ts:39-44`] — deferred, minor UX only
- [x] [Review][Defer] D6: `openPanel()` clears `pendingNudge` on mode switch within already-open panel [`apps/web/src/stores/lumi.store.ts:87`] — deferred, minor UX quirk
- [x] [Review][Defer] D7: `null` primary parent treated as opted-in; no household-validity guard [`apps/api/src/jobs/lumi-nudge.job.ts:47`] — deferred, intentional design
- [x] [Review][Defer] D8: Fast double-click can bypass `nudgeToggleSaving` useState guard [`apps/web/src/components/LumiPanel.tsx:112`] — deferred, very edge case
- [x] [Review][Defer] D9: Dead empty `Set` can persist in connections Map after all-fail emit [`apps/api/src/plugins/sse-dispatcher.plugin.ts:40-47`] — deferred, negligible at MVP
