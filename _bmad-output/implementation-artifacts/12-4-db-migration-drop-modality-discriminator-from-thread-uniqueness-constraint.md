# Story 12.4: DB migration — drop modality discriminator from thread uniqueness constraint

Status: done

## Story

As a developer,
I want voice and text turns for the same surface to share one thread,
So that Lumi has full conversational context regardless of input mode (ADR-002 OQ-1).

## Architecture Overview

### Problem Being Solved

The migration in Story 2.7 (`20260505000000_threads_modality_and_unique_constraints.sql`) added a `modality` column to the `threads` table and a unique index `threads_one_active_per_household_type_modality` on `(household_id, type, modality) WHERE status = 'active'`.

This constraint was correct for the onboarding flow: it ensured that a voice onboarding session and a text onboarding session never shared a thread (they have different conversation shapes and data requirements). However, it is incompatible with ambient Lumi — where voice and text are both modalities of the **same** conversation on the same surface.

For ambient Lumi, one active thread per `(household_id, surface_type)` is the correct invariant — modality is a property of a turn, not a thread.

### Current DB State

```sql
-- Added in Story 2.7
ALTER TABLE threads
  ADD COLUMN modality text NOT NULL DEFAULT 'voice'
  CHECK (modality IN ('voice', 'text'));

CREATE UNIQUE INDEX threads_one_active_per_household_type_modality
  ON threads(household_id, type, modality)
  WHERE status = 'active';
```

### Target DB State

After this migration:

1. **The old all-types modality-discriminated index is dropped.** The `modality` column itself remains on the table — it is still used as a column on existing onboarding threads and may be useful for future analytics.

2. **A new onboarding-specific modality-discriminated index is created.** This preserves the original intent for onboarding: a voice and text onboarding thread cannot both be active simultaneously.

3. **A new ambient-type index is created.** One active thread per `(household_id, type)` for all non-onboarding thread types.

```sql
-- Drop the all-types modality-discriminated constraint
DROP INDEX IF EXISTS threads_one_active_per_household_type_modality;

-- Recreate: onboarding keeps its modality discriminator
CREATE UNIQUE INDEX threads_one_active_per_onboarding_type_modality
  ON threads (household_id, type, modality)
  WHERE status = 'active' AND type = 'onboarding';

-- New: ambient surfaces — one active thread per (household, type), modality-agnostic
CREATE UNIQUE INDEX threads_one_active_per_household_type
  ON threads (household_id, type)
  WHERE status = 'active' AND type != 'onboarding';
```

### Why Split Rather Than Single Index

A single partial index covering all types would need to either include or exclude the modality column. Including it would break ambient Lumi (can't have two active threads same surface different modality). Excluding it would break onboarding (could create voice + text onboarding threads simultaneously). Two narrow partial indexes is the correct solution.

### Rollback

The migration must be reversible:

```sql
-- Rollback: restore original all-types modality-discriminated constraint
DROP INDEX IF EXISTS threads_one_active_per_onboarding_type_modality;
DROP INDEX IF EXISTS threads_one_active_per_household_type;

CREATE UNIQUE INDEX threads_one_active_per_household_type_modality
  ON threads(household_id, type, modality)
  WHERE status = 'active';
```

### Migration Filename

Use timestamp `20260601000000` — after all existing migrations (`20260520000100` is the latest).

`supabase/migrations/20260601000000_ambient_lumi_thread_constraints.sql`

## Acceptance Criteria

1. **Given** the existing `threads_one_active_per_household_type_modality` constraint on the `threads` table, **When** Story 12.4 migration runs, **Then** the `threads_one_active_per_household_type_modality` index no longer exists.

2. **Given** the migration has run, **When** two active threads with the same household, `type = 'onboarding'`, but different `modality` values ('voice' and 'text') are inserted, **Then** the second insert succeeds (onboarding voice + text can still be separated — wait, this contradicts the intent). Actually: both `voice` and `text` onboarding threads for the same household cannot be active simultaneously. **Correction:** The onboarding-specific index `threads_one_active_per_onboarding_type_modality` on `(household_id, type, modality) WHERE type = 'onboarding'` means: one active `onboarding`+`voice` thread per household, AND one active `onboarding`+`text` thread per household. These are two separate constraints. So voice onboarding and text onboarding each have one active slot. This matches the original intent from Story 2.7.

3. **Given** the migration has run, **When** two active threads with the same household and the same non-onboarding type (e.g. `type = 'planning'`) are inserted regardless of `modality`, **Then** the second insert fails with a unique constraint violation — only one active thread per household per surface type.

4. **Given** the migration has run, **When** a `planning` thread is created for household A, **Then** the `modality` column still exists on the row (no column dropped — just indexes changed).

5. **Given** the migration has run, **When** the rollback SQL is applied, **Then** the original `threads_one_active_per_household_type_modality` index is recreated and the new indexes are removed.

6. **Given** the migration has run, **When** `pnpm --filter @hivekitchen/api test` runs (including any existing thread-related tests), **Then** all pass.

## Tasks / Subtasks

- [x] Task 1 — Create migration file (AC: #1, #2, #3, #4, #5)
  - [x] Create `supabase/migrations/20260620000000_ambient_lumi_thread_constraints.sql` (timestamp bumped from the spec's `20260601000000` — that slot is now occupied by Story 2.13's memory_nodes migration, which landed after 12.4 was authored)
  - [x] Add rollback comment block at the top (matching migration file convention)
  - [x] `DROP INDEX IF EXISTS threads_one_active_per_household_type_modality`
  - [x] `CREATE UNIQUE INDEX threads_one_active_per_onboarding_type_modality ON threads (household_id, type, modality) WHERE status = 'active' AND type = 'onboarding'`
  - [x] `CREATE UNIQUE INDEX threads_one_active_per_household_type ON threads (household_id, type) WHERE status = 'active' AND type != 'onboarding'`

- [x] Task 2 — Verify existing voice service still works with new constraint (AC: #6)
  - [x] Read `apps/api/src/modules/voice/voice.service.ts` — only thread-write site is `voice.service.ts:90` (`createThread(householdId, 'onboarding', 'voice')`); also verified `onboarding.service.ts:96` (`createThread(..., ONBOARDING_THREAD_TYPE, TEXT_MODALITY)`)
  - [x] Confirm it still passes `modality` when creating onboarding threads — both call sites pass an explicit modality, and the new onboarding-specific index still includes modality, so the existing R2-D1/R2-D2 invariant continues to hold
  - [x] No code changes required — the migration is index-only

- [x] Task 3 — Run tests (AC: #6)
  - [x] `pnpm --filter @hivekitchen/api test` — 221 pass / 11 skipped (only the same pre-existing `memory.service.test.ts > partial seeding` failure from prior uncommitted work remains; unrelated to 12.4)

## Dev Notes

### modality column is preserved
This migration drops and replaces **indexes only**. The `modality` column added in Story 2.7 is NOT dropped. Existing onboarding threads with `modality = 'voice'` or `modality = 'text'` remain valid. Future ambient Lumi thread creation (Story 12.5) may choose to set `modality = null` or omit modality entirely — but that's a Story 12.5 concern. This story only fixes the constraints.

### Ambient threads and modality column
The `modality` column is `NOT NULL` per the Story 2.7 migration. When Story 12.5 creates ambient Lumi threads (non-onboarding types), it will need to supply a `modality` value. Since ambient threads are modality-agnostic (both voice and text use the same thread), Story 12.5 should consider setting modality to a sentinel value or making the column nullable. **This story should check whether the NOT NULL constraint needs to be relaxed** for ambient thread types. If so, add:

```sql
-- Allow ambient thread types to omit modality
ALTER TABLE threads ALTER COLUMN modality DROP NOT NULL;
```

This is safe: the onboarding-specific index only fires for `type = 'onboarding'` rows, and onboarding always provides modality. For ambient types, `modality` becomes advisory.

### Existing constraint name
The exact index name is `threads_one_active_per_household_type_modality` — confirmed in `supabase/migrations/20260505000000_threads_modality_and_unique_constraints.sql`. Use `DROP INDEX IF EXISTS` to be safe if for any reason the index doesn't exist (e.g. running on a fresh DB that had a different sequence of migrations).

### Migration timestamp ordering
The last migration is `20260520000100`. Use `20260601000000` to leave gap for any future Story 2 work. [Source: supabase/migrations/ directory listing]

### Rollback format
Match the rollback comment format used in existing migrations:
```sql
-- Rollback:
--   DROP INDEX threads_one_active_per_onboarding_type_modality;
--   DROP INDEX threads_one_active_per_household_type;
--   CREATE UNIQUE INDEX threads_one_active_per_household_type_modality ...
```

### No Supabase type generation in this story
This story modifies indexes only (and possibly the NOT NULL constraint on `modality`). No new tables or columns are added that would require type regeneration beyond what Supabase infers automatically. If the column becomes nullable, any TypeScript interfaces using `modality: string` may need updating — check `apps/api/src/modules/voice/voice.repository.ts` for the threads row type.

### Project Structure Notes

- New file: `supabase/migrations/20260620000000_ambient_lumi_thread_constraints.sql`
- Possibly modified: `apps/api/src/modules/voice/voice.repository.ts` — if threads row type needs update for nullable modality
- No changes to contracts or frontend in this story

### References

- [Source: _bmad-output/planning-artifacts/adr-ambient-lumi.md#Decision 3 — Thread Model — DB migration required]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 12.4]
- [Source: supabase/migrations/20260505000000_threads_modality_and_unique_constraints.sql — existing constraint to drop]
- [Source: supabase/migrations/20260504000000_create_threads.sql — threads table schema]
- [Source: apps/api/src/modules/voice/voice.service.ts — existing thread creation to verify compatibility]

## Dev Agent Record

### Agent Model Used

claude-opus-4-7[1m]

### Debug Log References

- API tests after migration applied: `pnpm --filter @hivekitchen/api test` →
  221 pass / 11 skipped. The single failure (`memory.service.test.ts >
  partial seeding`) pre-existed in untracked code from a prior story and is
  unrelated to 12.4.
- Verified by `Grep` that the only call sites creating `threads` rows are:
  - `apps/api/src/modules/voice/voice.service.ts:90` — `createThread(hh, 'onboarding', 'voice')`
  - `apps/api/src/modules/onboarding/onboarding.service.ts:96` — `createThread(hh, ONBOARDING_THREAD_TYPE, TEXT_MODALITY)`
  Both pass `type='onboarding'` with an explicit modality, so they fall under
  the new `threads_one_active_per_onboarding_type_modality` partial index —
  identical semantics to the dropped index for onboarding flows.

### Completion Notes List

- **Timestamp bumped to `20260620000000`** (spec proposed `20260601000000`):
  Story 2.13's memory_nodes migration now occupies `20260601000000`, and
  Story 3.1's allergy guardrail migration occupies `20260610000000`. Bumping
  the migration timestamp to `20260620000000` keeps the sequence monotonic.
  Inline comment in the migration explains the bump.
- **`modality` NOT NULL constraint retained**: Dev Notes flagged this as
  optional. Decision: do not relax in this story. Existing tests and code all
  write a modality value; ambient thread creation (Story 12.5) can write a
  sentinel modality value. If a future story prefers `NULL` to "(arbitrary)
  initial modality", it can write a follow-up `ALTER COLUMN ... DROP NOT NULL`
  migration. Avoiding the column-level change here keeps this migration
  small, reversible, and risk-free.
- **No app-code changes**: the migration is index-only, and the only thread
  creators in the codebase already supply modality.

### File List

**New files:**
- `supabase/migrations/20260620000000_ambient_lumi_thread_constraints.sql`

**Modified files:**
- _(none)_

### Review Findings

- [x] [Review][Patch] Rollback comment uses plain `DROP INDEX` — missing `IF EXISTS` guards on both new indexes [`supabase/migrations/20260620000000_ambient_lumi_thread_constraints.sql:31-32`]
- [x] [Review][Patch] Spec filename field still shows `20260601000000`; actual file is `20260620000000` — update spec to match [`_bmad-output/implementation-artifacts/12-4-...:149`]
- [x] [Review][Defer] `ThreadRepository.findActiveThreadByHousehold()` filters by modality for all types — Story 12.5 adds `LumiRepository.findActiveAmbientThread()` (modality-agnostic) which is the correct lookup for ambient types; base method remains a trap for future callers [`apps/api/src/modules/threads/thread.repository.ts:59-74`] — deferred, pre-existing
- [x] [Review][Defer] `createThread` comment still names the dropped `threads_one_active_per_household_type_modality` index — stale documentation, out of scope for an index-only migration; update when Story 12.5 modifies the method signature [`apps/api/src/modules/threads/thread.repository.ts:41-44`] — deferred, pre-existing
- [x] [Review][Defer] No `CREATE INDEX CONCURRENTLY` — takes ShareLock during build; can't use CONCURRENTLY inside Supabase transaction-wrapped migrations; acceptable at current table size [`supabase/migrations/20260620000000_ambient_lumi_thread_constraints.sql:42-51`] — deferred, pre-existing

### Change Log

| Date       | Change                                                                                                                       |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------- |
| 2026-05-01 | Code review complete — 2 patches, 3 deferred, 11 dismissed. Status remains `review` until patches applied. |
| 2026-04-30 | Implemented Story 12.4 — replace the all-types modality-discriminated unique index with two narrow partial indexes (onboarding-specific modality index + ambient-type modality-agnostic index). Index-only migration; no app code changes. Status → review. |

