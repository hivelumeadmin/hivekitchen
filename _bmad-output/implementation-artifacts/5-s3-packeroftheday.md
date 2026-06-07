# Story 5-S3: PackerOfTheDay + Family Thread Schema

Status: done

<!-- folds: 5.1 (schema), 5.6 — MVP WALL -->
<!-- cited PRD: FR27, UX-DR29, FR28 partial -->

## Story

As a Parent in a two-parent household,
I want to tap a day tile on the Brief and assign my partner as packer for that day,
so that we can see at a glance who's responsible for each lunch without needing to coordinate separately.

## Acceptance Criteria

1. **Given** a household member on `/app`, **When** the Brief loads, **Then** each day tile area shows the name of the assigned packer (e.g. "Devon packs Tuesday") or an unassigned placeholder (e.g. "Nobody's claimed Wednesday") — one `<PackerChip>` per tile day.

2. **Given** a Parent taps a `<PackerChip>`, **When** the assignment picker opens, **Then** it lists every household member (Primary Parent + Secondary Caregiver) plus a "Nobody" option — drawn from `GET /v1/households/:id/members` (already exists from 5-S2).

3. **Given** a Parent selects a member and confirms, **When** the `PATCH /v1/households/:id/days/:date/packer` call succeeds, **Then** the chip immediately reflects the new packer name and the dialog closes.

4. **Given** Parent A assigns Devon to Tuesday on their tab, **When** the SSE `packer.assigned` event arrives on Parent B's open tab, **Then** Parent B's Tuesday chip updates to "Devon packs Tuesday" without a page refresh.

5. **Given** `PATCH /v1/households/:id/days/:date/packer` with a valid `{ packer_user_id: "<uuid>" }` and an authenticated `primary_parent` or `secondary_caregiver`, **When** processed, **Then** the API:
   - upserts the `day_assignments` row (UPSERT on `(household_id, date)` primary key)
   - emits `packer.assigned` SSE to all open household tabs
   - writes a `TurnBodySystemEvent` (`event: 'packer.assigned'`) to the household's coordination thread (lazy-creating the thread if none exists)
   - returns `{ date, packer_user_id, packer_display_name }`

6. **Given** `PATCH /v1/households/:id/days/:date/packer` with `{ packer_user_id: null }`, **When** processed, **Then** the row's `packer_user_id` is set to `null` (clearing the assignment); no SSE is emitted for the unassign (see Dev Notes on contract constraint).

7. **Given** `PATCH /v1/households/:id/days/:date/packer` with a `household_id` that does not match the authenticated user's household, **When** processed, **Then** the API returns `403 Forbidden`.

8. **Given** `PATCH /v1/households/:id/days/:date/packer` with a `guest_author` JWT, **When** processed, **Then** the API returns `403 Forbidden` — packer assignment is restricted to `primary_parent` and `secondary_caregiver`.

9. **Given** `GET /v1/households/:id/packers` called by an authenticated household member, **When** processed, **Then** returns all `day_assignments` rows for the household sorted by date ascending, with `packer_display_name` resolved from the users table.

10. **Given** the coordination thread has been seeded by the first `packer.assigned` system event, **When** `ThreadRepository.listTurns(threadId)` is called (by 5-S4 sequencing tests), **Then** the turn appears in order — the family thread is live.

---

## Tasks / Subtasks

### Task 1 — Migration: `day_assignments` table (AC: #5, #6)

- [x] 1.1 Create `supabase/migrations/20260615000000_create_day_assignments.sql`:

  ```sql
  CREATE TABLE day_assignments (
    household_id   UUID        NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    date           DATE        NOT NULL,
    packer_user_id UUID        REFERENCES users(id) ON DELETE SET NULL,
    assigned_by    UUID        NOT NULL REFERENCES users(id),
    assigned_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (household_id, date)
  );

  CREATE INDEX idx_day_assignments_household_date
    ON day_assignments (household_id, date);
  ```

  **CRITICAL:** `threads` and `thread_turns` tables ALREADY EXIST (Epic 12 migrations `20260504000000` + `20260504010000` + `20260505000000`). **Do NOT recreate them.** Only `day_assignments` is new.

**USER-SIDE GATE:** `supabase db push --include-all` before running against a live DB.

---

### Task 2 — Contracts: packer schemas (AC: #5, #9)

- [x] 2.1 Create `packages/contracts/src/packer.ts`:

  ```ts
  import { z } from 'zod';

  export const DayAssignmentSchema = z.object({
    date:                z.string().date(),
    packer_user_id:      z.string().uuid().nullable(),
    packer_display_name: z.string().nullable(),
  });

  export const DayAssignmentsResponseSchema = z.object({
    assignments: z.array(DayAssignmentSchema),
  });

  export const AssignPackerRequestSchema = z.object({
    packer_user_id: z.string().uuid().nullable(),
  });

  export const AssignPackerResponseSchema = DayAssignmentSchema;

  export type DayAssignment       = z.infer<typeof DayAssignmentSchema>;
  export type DayAssignmentsResponse = z.infer<typeof DayAssignmentsResponseSchema>;
  export type AssignPackerRequest = z.infer<typeof AssignPackerRequestSchema>;
  export type AssignPackerResponse = z.infer<typeof AssignPackerResponseSchema>;
  ```

- [x] 2.2 Add `export * from './packer.js';` to `packages/contracts/src/index.ts` — follow the pattern of the `household-members.ts` export added in 5-S2 (check the end of the file for the pattern).

- [x] 2.3 Add type re-exports to `packages/types/src/index.ts` — 4 types: `DayAssignment`, `DayAssignmentsResponse`, `AssignPackerRequest`, `AssignPackerResponse`.

- [x] 2.4 Write `packages/contracts/src/packer.test.ts`:
  - `DayAssignmentSchema` accepts valid `{ date: '2026-06-16', packer_user_id: UUID, packer_display_name: 'Devon' }`
  - `DayAssignmentSchema` accepts `packer_user_id: null` and `packer_display_name: null`
  - `DayAssignmentSchema` rejects missing `date`
  - `AssignPackerRequestSchema` accepts valid uuid, accepts `null`, rejects a non-uuid string

---

### Task 3 — API Repository: `DayAssignmentsRepository` (AC: #5, #6, #9)

- [x] 3.1 Create `apps/api/src/modules/households/day-assignments.repository.ts`:

  ```ts
  import { BaseRepository } from '../../repository/base.repository.js';

  export interface DayAssignmentRow {
    household_id:    string;
    date:            string;
    packer_user_id:  string | null;
    assigned_by:     string;
    assigned_at:     string;
  }

  export class DayAssignmentsRepository extends BaseRepository {
    async upsert(
      householdId: string,
      date: string,
      packerUserId: string | null,
      assignedBy: string,
    ): Promise<DayAssignmentRow> {
      const { data, error } = await this.client
        .from('day_assignments')
        .upsert(
          { household_id: householdId, date, packer_user_id: packerUserId, assigned_by: assignedBy },
          { onConflict: 'household_id,date' },
        )
        .select('*')
        .single();
      if (error) throw error;
      return data as DayAssignmentRow;
    }

    async findByHousehold(householdId: string): Promise<DayAssignmentRow[]> {
      const { data, error } = await this.client
        .from('day_assignments')
        .select('*')
        .eq('household_id', householdId)
        .order('date', { ascending: true });
      if (error) throw error;
      return (data ?? []) as DayAssignmentRow[];
    }
  }
  ```

---

### Task 4 — API Routes: `GET /packers` + `PATCH .../packer` (AC: #5–#9)

- [x] 4.1 Import `DayAssignmentsRepository` and `ThreadRepository` inside `householdsRoutesPlugin` in `apps/api/src/modules/households/households.routes.ts`. Instantiate alongside the other repositories already wired there:

  ```ts
  import { DayAssignmentsRepository } from './day-assignments.repository.js';
  import { ThreadRepository } from '../threads/thread.repository.js';
  // inside plugin fn:
  const dayAssignmentsRepo = new DayAssignmentsRepository(fastify.supabase);
  const threadRepository   = new ThreadRepository(fastify.supabase);
  ```

- [x] 4.2 Add `GET /v1/households/:id/packers`:
  - Prehandler: `authorize(['primary_parent', 'secondary_caregiver'])`
  - Cross-household 403 guard: `if (request.user.household_id !== householdId) throw new ForbiddenError(...)`
  - Fetch rows: `dayAssignmentsRepo.findByHousehold(householdId)`
  - Resolve display names: call `userRepository.findByHousehold(householdId)` once, build `Map<userId, displayName>`, map over assignment rows
  - Response: `DayAssignmentsResponseSchema` — `{ assignments: [{ date, packer_user_id, packer_display_name }] }`

- [x] 4.3 Add `PATCH /v1/households/:id/days/:date/packer`:
  - Route params: `:id` (householdId), `:date` (ISO date string e.g. `'2026-06-16'`)
  - Prehandler: `authorize(['primary_parent', 'secondary_caregiver'])`
  - Cross-household 403 guard
  - Validate `:date` is a valid ISO date (regex `^\d{4}-\d{2}-\d{2}$`) — return 400 `ValidationError` if not
  - Body: `AssignPackerRequestSchema`
  - **Step A — upsert:**
    ```ts
    const row = await dayAssignmentsRepo.upsert(
      householdId, date, body.packer_user_id, request.user.id,
    );
    ```
  - **Step B — resolve display name:**
    ```ts
    let packerDisplayName: string | null = null;
    if (body.packer_user_id) {
      const profile = await userRepository.findUserById(body.packer_user_id);
      packerDisplayName = profile?.display_name ?? null;
    }
    ```
  - **Step C — emit SSE (only when assigning, not when clearing):**
    ```ts
    if (body.packer_user_id) {
      fastify.sseDispatcher.emit(
        householdId,
        'message',
        JSON.stringify({ type: 'packer.assigned', date, packer_id: body.packer_user_id }),
      );
    }
    ```
  - **Step D — write family thread turn (best-effort, wrapped in try-catch):**
    ```ts
    try {
      let thread = await threadRepository.findActiveThreadByHousehold(
        householdId, 'coordination', 'text',
      );
      if (!thread) {
        thread = await threadRepository.createThread(householdId, 'coordination', 'text');
      }
      await threadRepository.appendTurnNext({
        threadId: thread.id,
        role: 'system',
        body: {
          type: 'system_event',
          event: 'packer.assigned',
          payload: { date, packer_user_id: body.packer_user_id, packer_display_name: packerDisplayName },
        },
        modality: 'text',
      });
    } catch (err) {
      fastify.log.warn({ err }, 'packer: failed to write coordination thread turn');
    }
    ```
  - Response 200: `AssignPackerResponseSchema` — `{ date, packer_user_id: row.packer_user_id, packer_display_name: packerDisplayName }`

- [x] 4.4 Write tests appended to `apps/api/src/modules/households/households.routes.test.ts`:
  - `GET /v1/households/:id/packers` — 200 empty array when none assigned
  - `GET /v1/households/:id/packers` — 200 with assignment rows, display_name resolved
  - `GET /v1/households/:id/packers` — 403 cross-household
  - `PATCH /v1/households/:id/days/:date/packer` — 200, upserts row, emits SSE
  - `PATCH /v1/households/:id/days/:date/packer` — 200 with `null` clears assignment (no SSE emitted)
  - `PATCH /v1/households/:id/days/:date/packer` — 400 invalid date format (e.g. `'not-a-date'`)
  - `PATCH /v1/households/:id/days/:date/packer` — 403 cross-household
  - `PATCH /v1/households/:id/days/:date/packer` — 403 for `guest_author` role

---

### Task 5 — Web: `<PackerChip>` + `<PackerAssignmentDialog>` (AC: #1, #2, #3)

- [x] 5.1 Create `apps/web/src/features/plan/PackerChip.tsx`:
  - Props: `{ day: string; date: string; householdId: string }`
  - Fetches all assignments via `useQuery({ queryKey: QueryKeys.packers(householdId), queryFn: ... })` — one shared query for the whole canvas, cached at the household level
  - Derives the packer for this specific `date` from the response array
  - State: `[pickerOpen, setPickerOpen]`
  - Renders a `<button>` chip:
    - Assigned: `"Devon packs {day}"` — `font-sans text-[13px] text-fg rounded-full border border-border bg-surface-2 px-3 py-1`
    - Unassigned: `"Nobody's claimed {day}"` — same chip, `text-fg-muted`
  - On click: `setPickerOpen(true)` → renders `<PackerAssignmentDialog>`

- [x] 5.2 Create `apps/web/src/features/plan/PackerAssignmentDialog.tsx`:
  - Props: `{ date: string; householdId: string; open: boolean; onClose: () => void }`
  - Fetches `HouseholdMembersResponse` via `hkFetch<HouseholdMembersResponse>('/v1/households/${householdId}/members')` on mount (reuse existing contract from 5-S2 — do NOT redefine the schema)
  - State: `selectedUserId: string | null` (null = "Nobody")
  - Renders: title "Who's packing [day]?", radio list of member names + "Nobody" option, "Assign" button
  - On submit:
    ```ts
    await hkFetch(`/v1/households/${householdId}/days/${date}/packer`, {
      method: 'PATCH',
      body: { packer_user_id: selectedUserId },  // raw object — NOT JSON.stringify
    });
    queryClient.invalidateQueries({ queryKey: QueryKeys.packers(householdId) });
    onClose();
    ```
  - Shows `aria-busy` on the Assign button while submitting
  - Shows inline error message on failure (reuse `role="alert"` pattern from other dialogs)

---

### Task 6 — Web: Wire BriefCanvas + SSE + QueryKeys (AC: #4)

- [x] 6.1 Add `packers` key to `apps/web/src/lib/realtime/query-keys.ts`:
  ```ts
  /** @example QueryKeys.packers('household-uuid') → ['packers', 'household-uuid'] */
  packers: (householdId: string): ['packers', string] => ['packers', householdId],
  ```

- [x] 6.2 Add a `weekDates` helper at the top of `BriefCanvas.tsx` (or in a colocated `plan-utils.ts` if you prefer):
  ```ts
  function getWeekDates(): Record<string, string> {
    const today = new Date();
    const dow = today.getDay(); // 0=Sun
    const monday = new Date(today);
    monday.setDate(today.getDate() - (dow === 0 ? 6 : dow - 1));
    const offsets: Record<string, number> = {
      monday: 0, tuesday: 1, wednesday: 2, thursday: 3, friday: 4, saturday: 5,
    };
    return Object.fromEntries(
      Object.entries(offsets).map(([day, offset]) => {
        const d = new Date(monday);
        d.setDate(monday.getDate() + offset);
        return [day, d.toISOString().slice(0, 10)];
      }),
    );
  }
  ```
  Call `const weekDates = useMemo(() => getWeekDates(), [])` inside `BriefCanvas`.

- [x] 6.3 Render `<PackerChip>` below each `<PlanTile>` in the tile grid inside `BriefCanvas.tsx`:
  ```tsx
  <PackerChip
    key={`packer-${summary.day}`}
    day={summary.day}
    date={weekDates[summary.day] ?? ''}
    householdId={householdId ?? ''}
  />
  ```
  The chip is a **sibling below the tile** — do NOT add props to `<PlanTile>` (surgical change only).

- [x] 6.4 Handle `packer.assigned` SSE in BriefCanvas's existing SSE subscriber (find where `packer.assigned` is expected to be handled — it may be in a `useEffect` or in `events.routes.ts` client handler). Invalidate:
  ```ts
  case 'packer.assigned':
    queryClient.invalidateQueries({ queryKey: QueryKeys.packers(householdId) });
    break;
  ```

---

### Task 7 — Web tests (AC: #1–#4)

- [x] 7.1 Create `apps/web/src/features/plan/PackerChip.test.tsx`:
  - Renders "Devon packs tuesday" when the GET response contains an assignment for that date
  - Renders "Nobody's claimed tuesday" when no assignment for that date
  - Opens `<PackerAssignmentDialog>` on chip click

- [x] 7.2 Create `apps/web/src/features/plan/PackerAssignmentDialog.test.tsx`:
  - Renders member list from mocked `GET /v1/households/:id/members`
  - Calls `PATCH .../packer` with selected `packer_user_id` on Assign
  - Calls `PATCH .../packer` with `null` when "Nobody" is selected

---

## Dev Notes

### CRITICAL: `threads` + `thread_turns` ALREADY EXIST — do NOT migrate them

`threads` and `thread_turns` were created by Epic 12 migrations:
- `20260504000000_create_threads.sql` — `id, household_id, type, status, created_at`
- `20260504010000_create_thread_turns.sql` — `id, thread_id, server_seq bigint, role, body jsonb, modality, created_at` + UNIQUE on `(thread_id, server_seq)`
- `20260505000000_threads_modality_and_unique_constraints.sql` — adds `modality` to `threads` + partial unique index `threads_one_active_per_household_type_modality`

**5-S3 only adds `day_assignments`.** Do not touch the threads migrations.

### CRITICAL: `packer.assigned` SSE contract already exists

`packages/contracts/src/events.ts` line 28:
```ts
z.object({ type: z.literal('packer.assigned'), date: z.string().date(), packer_id: z.string().uuid() })
```
`packer_id` is `z.string().uuid()` — **not nullable**. Therefore:
- **Only emit the SSE event when `packer_user_id` is non-null** (assigning).
- **Do not emit when clearing** (unassign via `null`). The client refetches on next load; the tile just drops to "Nobody's claimed" state after manual refresh. Live unassign SSE is deferred.

### CRITICAL: `hkFetch` double-encoding trap (repeat from 5-S2 retro)

`apps/web/src/lib/fetch.ts` auto-JSON-stringifies `init.body`. Always pass raw objects:
```ts
body: { packer_user_id: selectedUserId }  // ✅
body: JSON.stringify({ ... })              // ❌ double-encoded
```
This has tripped 3 prior stories (Epic 7 retro, 7-S3, 7-S10, 5-S2).

### CRITICAL: Family thread type = `'coordination'`, modality = `'text'`

The `threads.type` column is free-text (no enum constraint). Use `'coordination'` for the family household coordination thread. Modality is `'text'` for this slice. The partial unique index `threads_one_active_per_household_type_modality` on `(household_id, type, modality) WHERE status='active'` guarantees at most one active coordination thread per household.

### Thread turn write is best-effort — wrap in try-catch

The PATCH response must not fail because the thread write failed. Mirror the best-effort pattern from `heart-note-delivery.job.ts` and memory audit writes: wrap the entire thread block (lookup + lazy-create + appendTurnNext) in a try-catch, log a warning on failure, continue.

### `authorize()` helper — correct import and usage

The `authorize()` helper lives at `apps/api/src/middleware/authorize.hook.ts` and is already imported in `households.routes.ts`. The pattern for both parents:
```ts
{ preHandler: authorize(['primary_parent', 'secondary_caregiver']) }
```
Guest authors (`'guest_author'`) must not be able to assign.

### `UserRepository.findUserById` already exists

To resolve `packer_display_name` for a single user, use the existing `userRepository.findUserById(userId)` method from `apps/api/src/modules/users/user.repository.ts`. Returns the user row (with `display_name` nullable).

For the GET /packers response, call `userRepository.findByHousehold(householdId)` once (already exists from 5-S2 Task 2.2), build a `Map<userId, displayName>`, then map over assignment rows — avoids N+1 queries.

### `QueryKeys.packers` is a new plural key — distinct from `QueryKeys.packer`

`QueryKeys.packer(date)` (singular, per-date) already exists in `query-keys.ts` and is used by other features. The new key for 5-S3's household-level fetch is `QueryKeys.packers(householdId)` (plural). Add it without removing or renaming the existing singular key.

### `ThreadRepository.appendTurnNext` handles server_seq — do not compute it manually

The existing `appendTurnNext()` in `thread.repository.ts` does max+1 with 3-attempt unique-violation retry. Use it directly — do not add a postgres SEQUENCE or compute seq manually.

### Presence `thread_id` TODO — deferred from 5-S1

`apps/api/src/modules/presence/presence.helpers.ts` has a comment: "until 5-S3 we use `householdId` as `thread_id`". The correct fix post-5-S3 is to look up the coordination thread ID. This is **intentionally deferred** — fixing it would require the presence routes to run an extra DB query per heartbeat, and the current proxy works. Leave the TODO comment in place; do not change `emitPresenceEvent`.

### SSE emit format

SSE dispatcher emits raw strings. Follow the exact pattern from `presence.helpers.ts`:
```ts
fastify.sseDispatcher.emit(householdId, 'message', JSON.stringify(event));
```
The client-side `EventSource` handler receives `event.data` as the raw JSON string.

### Zod 4 gotchas (not 3.23)

- `z.record()` requires two-arg: `z.record(z.string(), z.unknown())`
- `.uuid()` enforces strict RFC-4122 variant nibble in test fixtures — use a valid UUID like `'11111111-1111-4111-8111-111111111111'`
- `.date()` validates `'YYYY-MM-DD'` format (not datetime)

### Test baselines — do not regress

Post 5-S2 code-review (6 patches applied, all done):
- **API:** ~1672 pass / 20 fail — pre-existing 20 failures are auth×7 / children.repository×3 / extra-library×3 / lunch-link-dev / onboarding.tools / audit-parity-drift / catalog-seed / households-memory-200-case / plan-adjustment / memory-partial-seeding — none in the households or threads domain
- **Web:** ~511 pass / 0 fail
- **Contracts:** 690 pass / 4 fail (cultural + heart-notes baseline)

Expected additions: +8 API route tests, +4 contract tests, +5 web tests ≈ 17 new tests.

### Source file map

| What | Where |
|------|-------|
| Thread repository (REUSE) | `apps/api/src/modules/threads/thread.repository.ts` |
| SSE dispatcher (REUSE) | `apps/api/src/plugins/sse-dispatcher.plugin.ts` |
| `packer.assigned` SSE contract (REUSE) | `packages/contracts/src/events.ts` line 28 |
| `TurnBodySystemEvent` contract (REUSE) | `packages/contracts/src/thread.ts` line 33 |
| `HouseholdMembersResponse` (REUSE in dialog) | `packages/contracts/src/household-members.ts` |
| Household routes (ADD here) | `apps/api/src/modules/households/households.routes.ts` |
| User repo for display_name | `apps/api/src/modules/users/user.repository.ts` |
| Presence emit pattern reference | `apps/api/src/modules/presence/presence.helpers.ts` |
| BriefCanvas (ADD PackerChip + SSE) | `apps/web/src/features/plan/BriefCanvas.tsx` |
| PlanTile (DO NOT MODIFY) | `apps/web/src/features/plan/PlanTile.tsx` |
| QueryKeys (ADD packers) | `apps/web/src/lib/realtime/query-keys.ts` |
| hkFetch (raw body) | `apps/web/src/lib/fetch.ts` |
| App registration (if route extracted) | `apps/api/src/app.ts` |
| Auth store (householdId) | `apps/web/src/stores/auth.store.ts` |

---

## Dev Agent Record

### Agent Model Used

claude-opus-4-8[1m]

### Debug Log References

_None — implementation completed without HALT conditions._

### Completion Notes List

All 7 tasks / 10 ACs implemented and verified.

**What shipped**
- Migration `20260615000000_create_day_assignments.sql` — `day_assignments` (composite PK `(household_id, date)`, nullable `packer_user_id ON DELETE SET NULL`, `assigned_by`/`assigned_at` audit trail). `threads`/`thread_turns` untouched (Epic 12).
- Contracts `packer.ts` (`DayAssignment`/`DayAssignmentsResponse`/`AssignPackerRequest`/`AssignPackerResponse`) + barrel export + 4 type re-exports. 6 contract tests.
- `DayAssignmentsRepository` (`upsert` on `household_id,date`; `findByHousehold` ordered by date asc).
- `GET /v1/households/:id/packers` (roster-map display-name resolution, no N+1) + `PATCH /v1/households/:id/days/:date/packer` (upsert → resolve name → emit `packer.assigned` SSE only on assign → best-effort coordination-thread `system_event` turn, lazy thread create). 8 route tests.
- Web: `<PackerChip>` (one shared `QueryKeys.packers` query, per-day derivation) + `<PackerAssignmentDialog>` (member radio list + Nobody, raw-body PATCH, invalidate, `aria-busy`, `role=alert`). `QueryKeys.packers` added. BriefCanvas `getWeekDates` + chip rendered below each tile. 6 web tests.

**Spec reconciliations (documented deviations)**
- **RLS added to the migration.** The story's bare SQL snippet omits RLS, but every sibling household-scoped table (e.g. `child_lunch_requests`) enables RLS with the inline-subquery policy `household_id = (SELECT current_household_id FROM users WHERE id = auth.uid())`, and project-context lists "Don't weaken RLS" as a Critical Don't-Miss invariant. Added the matching policy as a deliberate, convention-consistent enhancement.
- **`packer.assigned` SSE invalidation lives in `apps/web/src/lib/realtime/sse.ts`, not BriefCanvas (Task 6.4).** The client has ONE central SSE bridge (`createSseBridge`) with an exhaustive `InvalidationEvent` switch; BriefCanvas has no SSE subscriber (per project-context: components subscribe via the bridge, never instantiate `EventSource`). The existing `case 'packer.assigned'` already invalidated the singular `QueryKeys.packer(date)`; I augmented it to also invalidate the new household-level `QueryKeys.packers(householdId)`. The event payload carries only `date`+`packer_id` (household is implicit in the household-scoped stream), so `householdId` is read from the auth store — satisfies AC#4.
- **PackerChip+PlanTile wrapped in a per-cell `<div>` (Task 6.3).** The tile grid is a CSS grid; rendering the chip as a bare sibling would create a second grid cell and break the layout. Wrapped tile+chip in a `flex flex-col gap-2` cell (key moved to the wrapper). No props added to `<PlanTile>` (story constraint honored).
- **`PackerAssignmentDialog` gained a `day` prop** beyond the story's prop list so the title can read "Who's packing tuesday?" (AC#2).
- **Migration timestamp `20260615000000` is earlier than already-present migrations (…20261017…).** Followed the story's exact filename; the USER-SIDE GATE uses `supabase db push --include-all`, which is designed for out-of-order timestamps. `day_assignments` only references `households`/`users` (both created in much earlier migrations), so there is no dependency-ordering hazard.

**USER-SIDE GATE:** `supabase db push --include-all` (migration `20260615000000`) before running against a live DB.

**Verification**
- Contracts: packer 6/6 green. Full suite 693 pass / 7 fail — all 7 pre-existing (cultural ×1 + heart-notes ×3 baseline; auth.test ×3 are the uncommitted 5-S2 working-tree state — `HouseholdMembersResponseSchema` gained a required `household_display_name` field its stale test doesn't supply; auth.ts/auth.test.ts untouched by this slice).
- API: packers 8/8 green. Full suite 1672 pass / 20 fail — the 20 are the exact documented baseline (auth ×7, children.repository ×3, extra-library ×3, lunch-link-dev, onboarding.tools, audit-parity, catalog-seed, households-memory-200-case, plan-adjustment, memory-partial-seeding). Zero new failures.
- Web: 517 pass / 0 fail (511 baseline + 6 new — PackerChip 3, PackerAssignmentDialog 3). BriefCanvas (48) + sse (unchanged) green.
- Typecheck: 0 new errors in changed files. Pre-existing baselines only (web: `child-bag-composition.tsx`; api: `evals/runner.ts`, `voice.*`, `health.routes.test.ts`, `invite.routes.test.ts`, `households.routes.test.ts:449` getBrief mock; contracts: `heart-notes.ts`). No new deps.

### File List

**Contracts / Types**
- `packages/contracts/src/packer.ts` (new)
- `packages/contracts/src/packer.test.ts` (new)
- `packages/contracts/src/index.ts` (modified — export packer)
- `packages/types/src/index.ts` (modified — re-export 4 new types)

**API**
- `supabase/migrations/20260615000000_create_day_assignments.sql` (new)
- `apps/api/src/modules/households/day-assignments.repository.ts` (new)
- `apps/api/src/modules/households/households.routes.ts` (modified — GET /packers + PATCH /days/:date/packer + imports)
- `apps/api/src/modules/households/households.routes.test.ts` (modified — 8 new tests)

**Web**
- `apps/web/src/features/plan/PackerChip.tsx` (new)
- `apps/web/src/features/plan/PackerAssignmentDialog.tsx` (new)
- `apps/web/src/features/plan/PackerChip.test.tsx` (new — 3 tests)
- `apps/web/src/features/plan/PackerAssignmentDialog.test.tsx` (new — 2 tests)
- `apps/web/src/features/plan/BriefCanvas.tsx` (modified — getWeekDates helper + per-cell wrapper + PackerChip mount)
- `apps/web/src/lib/realtime/query-keys.ts` (modified — add packers key)
- `apps/web/src/lib/realtime/sse.ts` (modified — packer.assigned now also invalidates QueryKeys.packers(householdId); reconciliation — central SSE bridge, not BriefCanvas)

### Review Findings

- [x] [Review][Patch] P1: PATCH does not validate `packer_user_id` belongs to the caller's household — any authenticated caregiver can upsert a foreign UUID; DB FK prevents non-existent UUIDs but not cross-household assignment [`apps/api/src/modules/households/households.routes.ts` — PATCH handler]
- [x] [Review][Patch] P2: Dead `QueryKeys.packer(event.date)` invalidation in `packer.assigned` SSE case — no query in the codebase subscribes to this per-date key; `PackerChip` uses `QueryKeys.packers(householdId)` [`apps/web/src/lib/realtime/sse.ts:169`]
- [x] [Review][Patch] P3: `getWeekDates()` uses `.toISOString().slice(0,10)` which returns UTC date — for users in UTC+ timezones past midnight local time, Monday maps to the previous day's ISO date, sending PATCH to the wrong week row [`apps/web/src/features/plan/BriefCanvas.tsx` — `getWeekDates()`]
- [x] [Review][Patch] P4: `DayAssignmentsRepository.upsert` omits `assigned_at` from payload — PostgreSQL `DEFAULT now()` only fires on INSERT, so re-assignments retain the original `assigned_at` timestamp [`apps/api/src/modules/households/day-assignments.repository.ts` — `upsert()`]
- [x] [Review][Patch] P5: `PackerAssignmentDialog` initializes `selectedUserId` to `null` regardless of current assignment — clicking Assign without selecting a radio silently sends `packer_user_id: null` and clears an existing packer with no confirmation [`apps/web/src/features/plan/PackerAssignmentDialog.tsx`]
- [x] [Review][Defer] D1: RLS policy `USING` clause returns empty set when `auth.uid()` is null — consistent with all other household-scoped tables in this codebase; silent empty-result rather than error [`supabase/migrations/20260615000000_create_day_assignments.sql`] — deferred, pre-existing cross-codebase pattern
- [x] [Review][Defer] D2: `PackerAssignmentDialog` fetches members via `useEffect`+hkFetch outside React Query — duplicate uncached request on every dialog open [`apps/web/src/features/plan/PackerAssignmentDialog.tsx`] — deferred, minor perf; spec did not require useQuery here
- [x] [Review][Defer] D3: `PackerChip` falls back to `date=''` for any `summary.day` key absent from `weekDates` — chip button remains enabled; PATCH sends empty path segment causing 404 or 400 [`apps/web/src/features/plan/BriefCanvas.tsx`] — deferred, speculative; brief only returns mon–sat per data model
- [x] [Review][Defer] D4: `getWeekDates` memoized with `[]` deps — frozen at mount; won't recompute if user keeps the app open across a Sunday→Monday midnight boundary [`apps/web/src/features/plan/BriefCanvas.tsx`] — deferred, spec-explicit (`useMemo(() => getWeekDates(), [])`) and rare edge case
- [x] [Review][Defer] D5: `findUserById` in PATCH handler reads `users` without household scoping — PATCH response `packer_display_name` may differ from subsequent GET response for the same row if a cross-household UUID is persisted [`apps/api/src/modules/households/households.routes.ts` — PATCH handler] — deferred, secondary consequence of P1; fix P1 to prevent the root scenario
- [x] [Review][Defer] D6: Coordination thread turn written on unassign (`packer_user_id: null`) — spec only specifies SSE suppression on unassign, not thread-turn suppression; current behaviour records the unassign in the audit trail [`apps/api/src/modules/households/households.routes.ts` — PATCH handler] — deferred, spec ambiguity; arguably correct for audit completeness
- [x] [Review][Defer] D7: SSE emitted before coordination thread write — clients receive `packer.assigned` while the thread turn may not yet exist if the write is still in flight [`apps/api/src/modules/households/households.routes.ts` — PATCH handler] — deferred, intentional design; SSE-triggered UI update is correct regardless of thread write timing

---

## Change Log

| Date | Change |
|------|--------|
| 2026-06-06 | Story file authored: PackerOfTheDay + family thread schema (5-S3, MVP wall). `day_assignments` migration; `DayAssignmentsRepository`; `GET /v1/households/:id/packers` + `PATCH /v1/households/:id/days/:date/packer` (upsert + SSE `packer.assigned` + best-effort `TurnBodySystemEvent` to coordination thread); `<PackerChip>` + `<PackerAssignmentDialog>` wired below BriefCanvas tiles; `QueryKeys.packers` added. CRITICAL: `threads`/`thread_turns` ALREADY EXIST (Epic 12 migrations). |
| 2026-06-06 | Implemented all 7 tasks / 10 ACs → status review. Migration adds RLS (sibling-table convention). `packer.assigned` SSE plural-key invalidation landed in central `sse.ts` bridge (not BriefCanvas). PackerChip+PlanTile wrapped in per-cell div. No migration to threads. No new deps. Verification: contracts packer 6/6, API packers 8/8, web +6 (517 total); baselines unchanged (API 20-fail, web 0-fail, 0 new typecheck errors). USER-SIDE GATE: `supabase db push --include-all`. |
