# Story pre-4-s2: HeartNoteRepository Date Filter Fix

Status: done

## Story

As a child viewing their lunch link,
I want to see the Heart Note written for my specific lunch date,
so that a note authored on one day with a future `scheduled_for` date surfaces correctly on the intended day.

## Context

`HeartNoteRepository.findByChildAndDate()` currently filters on `created_at` instead of `scheduled_for`. A Heart Note authored on 2026-05-15 with `scheduled_for: '2026-05-17'` will not be returned when the lunch link requests the note for 2026-05-17. This is a correctness bug that must be fixed before story 4-s3 ships real HMAC-signed tokens (since 4-s3 uses real date-scoped token delivery).

**Source:** deferred-work.md → "code review of 4-s2-render-heart-note-on-child-surface-stub-token" — `HeartNoteRepository.findByChildAndDate filters on created_at not scheduled_for`.

## Acceptance Criteria

1. **Given** a Heart Note with `scheduled_for: '2026-05-17'` authored on `created_at: '2026-05-15'`,
   **When** `findByChildAndDate(householdId, childId, '2026-05-17')` is called,
   **Then** the note is returned.

2. **Given** a Heart Note with `scheduled_for: null` (no scheduled date),
   **When** `findByChildAndDate(householdId, childId, anyDate)` is called,
   **Then** the note is NOT returned (null result — a note without a schedule has no target date).

3. **Given** a Heart Note with `scheduled_for: '2026-05-16'`,
   **When** `findByChildAndDate(householdId, childId, '2026-05-17')` is called,
   **Then** null is returned.

4. **Given** multiple Heart Notes for the same child on the same `scheduled_for` date,
   **When** `findByChildAndDate` is called,
   **Then** the most recently updated note is returned (existing `order('updated_at', ascending: false).limit(1)` ordering is preserved).

5. **Given** the fix is complete,
   **When** `pnpm typecheck` runs,
   **Then** zero type errors.

## Tasks / Subtasks

### Task 1 — Fix the date filter in `findByChildAndDate` (AC: 1, 2, 3, 4)

**File:** `apps/api/src/modules/heart-notes/heart-note.repository.ts`

**Current code (lines 59–77):**
```typescript
async findByChildAndDate(
  householdId: string,
  childId: string,
  isoDate: string,
): Promise<HeartNoteRow | null> {
  const dayStart = `${isoDate}T00:00:00.000Z`;
  const nextDayStart = nextIsoDate(isoDate);
  const { data, error } = await this.client
    .from('heart_notes')
    .select(HEART_NOTE_COLUMNS)
    .eq('household_id', householdId)
    .eq('child_id', childId)
    .gte('created_at', dayStart)
    .lt('created_at', `${nextDayStart}T00:00:00.000Z`)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as HeartNoteRow | null) ?? null;
}
```

**Fix:** Replace the `created_at` range filter with a `scheduled_for` date equality filter.

`scheduled_for` is stored as a `DATE` or `TIMESTAMPTZ` column — check the migration to confirm. The cleanest filter depends on the column type:

- If `scheduled_for` is `DATE` (e.g., `'2026-05-17'`): use `.eq('scheduled_for', isoDate)`
- If `scheduled_for` is `TIMESTAMPTZ`: use the range approach but on `scheduled_for`

Also add `.not('scheduled_for', 'is', null)` to exclude notes with no scheduled date (AC: 2).

The `dayStart` and `nextDayStart` variables are no longer needed if using `.eq`. Remove them to avoid dead code.

**Fixed code:**
```typescript
async findByChildAndDate(
  householdId: string,
  childId: string,
  isoDate: string,
): Promise<HeartNoteRow | null> {
  const { data, error } = await this.client
    .from('heart_notes')
    .select(HEART_NOTE_COLUMNS)
    .eq('household_id', householdId)
    .eq('child_id', childId)
    .eq('scheduled_for', isoDate)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as HeartNoteRow | null) ?? null;
}
```

If the Supabase migration defines `scheduled_for` as `TIMESTAMPTZ` rather than `DATE`, replace `.eq('scheduled_for', isoDate)` with the range filter on `scheduled_for` instead (same pattern as the old `created_at` filter). Check `supabase/migrations/` for the `heart_notes` table definition before deciding.

- [x] Check `heart_notes` migration to confirm `scheduled_for` column type
- [x] Replace `created_at` filter with `scheduled_for` filter
- [x] Remove now-unused `dayStart` / `nextDayStart` variables if they have no other use
- [x] Verify `.not('scheduled_for', 'is', null)` is implicit in `.eq` (Supabase `.eq` on a nullable column returns only non-null matches where the value equals the target — null rows are excluded)

### Task 2 — Add or update unit tests (AC: 1, 2, 3, 4)

**File:** `apps/api/src/modules/heart-notes/heart-note.repository.test.ts` (or nearest test file for this repository)

Add tests for the corrected behavior:
- Note with matching `scheduled_for` → returned
- Note with `scheduled_for: null` → not returned
- Note with different `scheduled_for` → not returned
- Multiple notes on same date → most recently updated returned

- [x] Add test: `findByChildAndDate` returns note matching `scheduled_for`
- [x] Add test: `findByChildAndDate` returns null when `scheduled_for` is null
- [x] Add test: `findByChildAndDate` returns null when `scheduled_for` is different date
- [x] Add test (if easy): returns most-recently-updated note when multiple exist on same date

## Dev Notes

### `scheduled_for` Column

From `HeartNoteRow` interface (lines 5–15 in `heart-note.repository.ts`):
```typescript
scheduled_for: string | null;
```

The interface types it as `string | null`. In production Supabase it is likely `DATE` type returning `'YYYY-MM-DD'` strings, which makes `.eq('scheduled_for', isoDate)` the correct filter.

If for any reason `scheduled_for` stores a full timestamp, revert to the range approach — but filter on `scheduled_for` not `created_at`.

### No Schema Changes

This is a query-only fix. No migrations, no contract changes, no new files.

### Files to Touch

| File | Change |
|---|---|
| `apps/api/src/modules/heart-notes/heart-note.repository.ts` | Fix filter column (lines ~71-72) |
| `apps/api/src/modules/heart-notes/heart-note.repository.test.ts` | Add tests |

### References

- Bug location: [Source: `apps/api/src/modules/heart-notes/heart-note.repository.ts` lines 59–77]
- HeartNoteRow interface: [Source: `apps/api/src/modules/heart-notes/heart-note.repository.ts` lines 5–15]
- Deferred-work entry: [Source: `_bmad-output/implementation-artifacts/deferred-work.md` — "code review of 4-s2" — `findByChildAndDate` entry]

## Review Findings

### Deferred

- [x] [Review][Defer] Null `scheduled_for` drafts invisible to compose surface — if heart-note.routes.ts calls `findByChildAndDate` to retrieve a draft that was created without a date, that draft is now un-findable. Intentional per AC2; if compose retrieval needs un-scheduled drafts, that belongs to 4-s1/4-s6. [`apps/api/src/modules/heart-notes/heart-note.repository.ts`] — deferred, intentional behavioral change per spec
- [x] [Review][Defer] No index on `scheduled_for` — query scans all `(household_id, child_id)` rows then filters by date. Pre-existing pattern (old `created_at` range scan had same cost). Adding a composite index is infrastructure work outside this scope. [`supabase/migrations/20260901000000_create_heart_notes.sql`] — deferred, pre-existing
- [x] [Review][Defer] Un-scheduling a note (PATCH `scheduled_for` to null) makes it permanently un-findable by date — intentional per AC2 semantics. Cancel/reschedule UX belongs to 4-s6. [`apps/api/src/modules/heart-notes/heart-note.repository.ts`] — deferred, future slice concern
- [x] [Review][Defer] Route test mock chains are positional — `heart-note.routes.test.ts` and `lunch-link.routes.test.ts` mock the Supabase chain as nested position-dependent arrow functions; if `.eq()` call order changes the mock still passes. Pre-existing pattern; repository unit tests provide column-name-sensitive filter coverage. [`apps/api/src/modules/heart-notes/heart-note.routes.test.ts`, `apps/api/src/modules/lunch-link/lunch-link.routes.test.ts`] — deferred, pre-existing routes mock pattern
- [x] [Review][Defer] UTC date default in `GET /v1/heart-notes` mismatches stored DATE for non-UTC households — route defaults `isoDate` to `new Date().toISOString().slice(0, 10)` (UTC midnight); a parent in UTC-5 past 7 PM local gets tomorrow's date while their draft has today's `scheduled_for`. Pre-existing; per-household timezone resolution is 4-s6 scope. [`apps/api/src/modules/heart-notes/heart-note.routes.ts`] — deferred, pre-existing; 4-s6 scope

### Dismissed (11)

- isoDate format validation in repository — caught by Zod `.date()` at route boundary
- Route test doesn't cover date-matching behavior — covered by new repository unit tests
- buildMockClient column-key collision fragility — theoretical; current query has no duplicate-column EQs
- `scheduled_for` column type ambiguity — resolved: migration confirms `DATE` type; `.eq` with `YYYY-MM-DD` string is correct
- `nextIsoDate` deletion documents hidden assumption — nit; caller responsibility; Zod validates format at boundary; edge hunter confirmed module-private with no external callers
- Test mocks don't prove real Supabase PostgREST null-exclusion semantics — philosophical; behavior and spec are consistent
- ISO 8601 variant validation — caught at route boundary by Zod `.date()`
- Comment says "Supabase .eq semantics" not SQL — acceptable shorthand; null exclusion is standard SQL `=` semantics; no practical difference for callers
- Routes test `sampleRow()` has `scheduled_for: null` — routes tests verify HTTP response shape, not filter logic; mock `scheduled_for` value is irrelevant to route test assertions; repository tests cover filtering behavior
- False positive: test bodies appeared elided in auditor prompt — full test implementations are present in the actual file; auditor prompt artifact, not a real gap
- False positive: AC4 ordering test same `updated_at` — test correctly uses distinct timestamps (`08:00:00` vs `14:00:00`); ordering is properly validated

## Dev Agent Record

### Agent Model Used

Claude Opus 4.7 (1M context)

### Debug Log References

- Confirmed `scheduled_for` column type is `DATE` from `supabase/migrations/20260901000000_create_heart_notes.sql:17` → `.eq('scheduled_for', isoDate)` is the correct filter (Supabase `.eq` on nullable DATE column excludes rows where the value IS NULL).
- RED: 4 new tests in `heart-note.repository.test.ts` failed against the original `.gte/.lt('created_at', ...)` chain (mock had no `.gte`).
- GREEN: Replaced `created_at` range filter with `.eq('scheduled_for', isoDate)`; removed dead `dayStart`/`nextDayStart` locals and unused `nextIsoDate()` helper.
- Regression collateral: `heart-note.routes.test.ts` and `lunch-link.routes.test.ts` had mock chains modeling the OLD (buggy) `.gte → .lt → .order → ...` shape. Both updated to the corrected `.eq → .order → ...` shape — 4 previously-green tests stayed green after the mock update.
- Pre-existing unrelated failures in the API test suite (30 failures across auth/plans/agents/catalog/memory) are independent of this change; my fix reduced total API failures from 32 to 30 (the 2 lunch-link mock-chain failures).
- Pre-existing `pnpm typecheck` errors (`plans.service.test.ts`, `voice.routes.ts`, `voice.service.test.ts`) confirmed via `git stash` to exist on `main` before this change.

### Completion Notes List

- AC1 (note authored on 2026-05-15 with `scheduled_for: '2026-05-17'` is returned when queried for `2026-05-17`): satisfied by `.eq('scheduled_for', isoDate)`. Verified by test `returns the note whose scheduled_for matches the requested date (even if created earlier)`.
- AC2 (`scheduled_for: null` excluded): satisfied implicitly by Supabase `.eq` semantics — `.eq('scheduled_for', isoDate)` matches no rows where `scheduled_for IS NULL`. Verified by test `returns null when scheduled_for is null`. No explicit `.not('scheduled_for', 'is', null)` needed.
- AC3 (different `scheduled_for` excluded): verified by test `returns null when scheduled_for is a different date`.
- AC4 (existing `.order('updated_at', { ascending: false }).limit(1)` ordering preserved): verified by test `returns the most recently updated note when multiple share the same scheduled_for`.
- AC5 (`pnpm typecheck` zero errors): NOT verifiable — the API package has pre-existing typecheck errors on `main` in unrelated files (`plans.service.test.ts`, `voice.routes.ts`, `voice.service.test.ts`). This change introduces zero new type errors; behavior of typecheck against the changed files (`heart-note.repository.ts`, `heart-note.repository.test.ts`, `heart-note.routes.test.ts`, `lunch-link.routes.test.ts`) is clean.

### File List

- `apps/api/src/modules/heart-notes/heart-note.repository.ts` — modified (fix filter column; remove dead helper)
- `apps/api/src/modules/heart-notes/heart-note.repository.test.ts` — new (4 unit tests for `findByChildAndDate`)
- `apps/api/src/modules/heart-notes/heart-note.routes.test.ts` — modified (update mock chain to match new `.eq` shape)
- `apps/api/src/modules/lunch-link/lunch-link.routes.test.ts` — modified (update mock chain to match new `.eq` shape)

### Change Log

- 2026-05-26 — pre-4-s2 — Fixed `HeartNoteRepository.findByChildAndDate` to filter on `scheduled_for` instead of `created_at`. A Heart Note authored on day X with `scheduled_for: Y` now correctly surfaces on day Y. Notes with `scheduled_for IS NULL` are excluded by `.eq` semantics. Removed dead `nextIsoDate()` helper and `dayStart`/`nextDayStart` locals. Added 4 unit tests for the corrected behavior; updated 2 routes test mocks that modeled the old buggy chain shape.
