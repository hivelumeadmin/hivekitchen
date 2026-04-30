# Story 12.4: DB migration — drop modality discriminator from thread uniqueness constraint

Status: ready-for-dev

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

- [ ] Task 1 — Create migration file (AC: #1, #2, #3, #4, #5)
  - [ ] Create `supabase/migrations/20260601000000_ambient_lumi_thread_constraints.sql`
  - [ ] Add rollback comment block at the top (matching migration file convention)
  - [ ] `DROP INDEX IF EXISTS threads_one_active_per_household_type_modality`
  - [ ] `CREATE UNIQUE INDEX threads_one_active_per_onboarding_type_modality ON threads (household_id, type, modality) WHERE status = 'active' AND type = 'onboarding'`
  - [ ] `CREATE UNIQUE INDEX threads_one_active_per_household_type ON threads (household_id, type) WHERE status = 'active' AND type != 'onboarding'`

- [ ] Task 2 — Verify existing voice service still works with new constraint (AC: #6)
  - [ ] Read `apps/api/src/modules/voice/voice.service.ts` — check how `threads` table is written
  - [ ] Confirm it still passes `modality` when creating onboarding threads (the column still exists; the new onboarding index still includes modality)
  - [ ] If voice service creates threads without `modality`, it will violate the NOT NULL constraint — verify and fix if needed

- [ ] Task 3 — Run tests (AC: #6)
  - [ ] `pnpm --filter @hivekitchen/api test` — all passing

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

- New file: `supabase/migrations/20260601000000_ambient_lumi_thread_constraints.sql`
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

_to be filled on implementation_

### Debug Log References

### Completion Notes List

### File List
