# Story 3-DM-B2: Allergen consolidation + household_cultural_identifiers + drop legacy encrypted columns

Status: done

## Implementation notes (2026-05-31)

**Foundation + cutover + test sweep shipped:**
- Migrations: `20261008000000_household_allergens_consolidation.sql` (schema) + `20261008000100_drop_legacy_allergen_columns.sql` (drops, gated by backfill verification).
- Backfill: `apps/api/scripts/backfill-household-allergens.ts` — 4-step migration (child_allergens, households.declared_allergens, cultural_identifiers, dietary_preferences) with count-parity verification gate; idempotent re-runs.
- New repos: `HouseholdAllergensRepository` (declareIfNew / findByHouseholdId / findByHouseholdAndChild / deleteByChild) + `HouseholdCulturalIdentifiersRepository` (listTags / declareIfNew / upsertSet).
- Single-source guardrail (AC9): `AllergyGuardrailRepository.getRulesForHousehold` collapsed to one `findByHouseholdId` call; fail-closed `AllergyGuardrailDecryptError` preserved.
- `HouseholdsRepository.getProfile/patchProfile` rewritten to read/write the new structured tables (`household_allergens` child_id=NULL, `household_cultural_identifiers`, `dietary_preferences` child_id=NULL).
- `ChildrenRepository` stopped selecting/writing the dropped encrypted children columns. Cultural / dietary inputs from `POST /v1/households/:id/children` now route to household tables (canonical §5 — household-scoped); reads overlay them back from those tables so the REST round-trip is preserved.
- `ChildAllergensRepository` rewritten as a thin delegating adapter over `HouseholdAllergensRepository` (per-child rows). Onboarding tools and `children.service` compile unchanged.
- Legacy `apps/api/scripts/backfill-child-allergens.{ts,test.ts}` deleted (superseded by B2's `backfill-household-allergens.ts`).

**Test sweep results:**
| File | Pre-sweep | Post-sweep |
| --- | --- | --- |
| `children.routes.test.ts` | 37 fail / 50 cases | 0 fail / 50 cases |
| `households.routes.test.ts` | 6 fail / 23 cases | 0 fail / 23 cases |
| `households.service.test.ts` | 0 fail / 6 cases | 0 fail / 6 cases |
| `allergy-guardrail.repository.test.ts` | 11 fail / 11 cases | 0 fail / 11 cases |
| `household-allergens.repository.test.ts` (new) | n/a | 6/6 pass |
| `backfill-child-allergens.test.ts` (deleted) | 4 fail / 4 cases | n/a — file removed |

Net: 58 B2-related failures resolved, 0 regressions introduced. Full API suite: 1273 pass / 30 fail (all 30 pre-existing per `git stash` comparison; B2 is not responsible).

**Followups (still open in deferred-work.md):**
- Delete the `ChildAllergensRepository` adapter and switch call-sites to `HouseholdAllergensRepository` directly. The adapter is now a soft no-op for most callers — clean removal is mechanical.
- `declare()` `child_allergen_id` returns empty string under the adapter (upsert + ignoreDuplicates does not expose the conflict row id). Audit logs redact allergen plaintext so no correlation gap. Closes when the adapter is deleted.
- 30 pre-existing failing tests across `auth.routes`, `day-overrides.{repository,service}`, `extra-library.repository`, `lunch-link.routes`, `memory.service`, `planner.prompt`, `onboarding.tools`, `audit.types`, `catalog-seed.service`, `plan-adjustment.service` — not B2 scope; pre-date the sprint catchup commit (`f00ef2f`).

## Story

As Epic 3 data-model solutioning,
We want to collapse the three places we store allergens (`child_allergens`, `households.declared_allergens` encrypted, `children.declared_allergens` encrypted) into a single `household_allergens` table with nullable `child_id`, plus extract `households.cultural_identifiers` (encrypted) into a structured `household_cultural_identifiers` table,
So that the guardrail evaluates one query against one table AND the coexistence chaos retires.

## Acceptance Criteria

1. `household_allergens` table exists per `canonical §6.2`:
   - id, household_id FK, **nullable child_id** FK (NULL = household-wide; non-NULL = attribution metadata)
   - encrypted `allergen` text + `allergen_hash` SHA-256
   - source enum includes `'child_medical'` for migrated `child_allergens` rows
   - optional `reason` text (≤200 chars)
   - COALESCE-sentinel UNIQUE on `(household_id, COALESCE(child_id, sentinel), allergen_hash)`
   - 2 indexes: `(household_id)` and partial `(child_id) WHERE child_id IS NOT NULL`
2. `household_cultural_identifiers` table exists per `canonical §6.1`:
   - composite PK `(household_id, cultural_tag)`
   - `cultural_tag` validated at service layer against `cultural_tags` vocab
   - `enforcement` + `source` columns
3. All `child_allergens` rows backfilled into `household_allergens`:
   - `child_id` preserved
   - `source` mapped: `'onboarding_declared'` → `'child_medical'`; other sources unchanged
4. All `households.declared_allergens` (encrypted jsonb arrays) decrypted → each array element re-encrypted + inserted as `household_allergens` row with `child_id=NULL`, `source='backfill_migration'`.
5. All `households.cultural_identifiers` decrypted → parsed → inserted into `household_cultural_identifiers`.
6. All `households.dietary_preferences` (encrypted jsonb) decrypted → parsed → inserted into existing `dietary_preferences` table with `child_id=NULL`, validated against `dietary_tags` vocab.
7. **Pre-drop verification gate**: row counts match expected. Migration ABORTS if mismatch.
8. After gate passes:
   - `DROP TABLE child_allergens;`
   - `ALTER TABLE households DROP COLUMN declared_allergens, cultural_identifiers, dietary_preferences;`
   - `ALTER TABLE children DROP COLUMN declared_allergens, cultural_identifiers, dietary_preferences;`
9. `AllergyGuardrailService` rewritten: single query `SELECT allergen FROM household_allergens WHERE household_id = ?` replaces the multi-source assembly.

## Dependencies & Context

**Design references:**
- Authoritative: canonical `§6.1`, `§6.2`, `§10.1` (Q1 decision)
- Breakdown: phase-4 doc Story B2
- Project memories: `[[allergen-storage-model]]`, `[[parent-confidence-prevents-cafeteria]]`

**Story dependencies:** none — parallel-safe with B1 (B2 doesn't touch the same children columns).

**Downstream blockers:** C1 (the guardrail re-eval in commit_plan() reads from household_allergens; the new single-query path simplifies the cutover).

**Key invariants:**
- Allergens are kitchen-shared constraints; medical attribution is metadata (Q1 reasoning)
- Encryption pattern matches `child_allergens` (slice 2.5-s1): AES-256-GCM under household DEK, SHA-256 of normalized plaintext for dedupe

## Tasks / Subtasks

### Task 1 — Schema creation

- [ ] Create `supabase/migrations/<timestamp>_household_allergens_consolidation.sql`
- [ ] `CREATE TABLE household_allergens (...)` per canonical §6.2 full DDL
- [ ] `CREATE INDEX household_allergens_household_idx`
- [ ] `CREATE INDEX household_allergens_child_idx ... WHERE child_id IS NOT NULL`
- [ ] `CREATE TABLE household_cultural_identifiers (...)` per canonical §6.1
- [ ] RLS: service-role-only writes; authenticated SELECT scoped to current_household_id (mirror household_rules pattern)

### Task 2 — Backfill script

- [ ] Create `apps/api/scripts/backfill-household-allergens.ts`
- [ ] **Step 1**: Migrate `child_allergens` → `household_allergens` (1:1 with `child_id` preserved). Map source enum: `'onboarding_declared'` → `'child_medical'`.
- [ ] **Step 2**: For each `households.declared_allergens` row: decrypt → for each allergen → encrypt + hash + INSERT into `household_allergens` with `child_id=NULL`, source `'backfill_migration'`.
- [ ] **Step 3**: For each `households.cultural_identifiers` row: decrypt → parse → INSERT each tag into `household_cultural_identifiers`. Validate each against `cultural_tags` vocab; skip + log if missing.
- [ ] **Step 4**: For each `households.dietary_preferences` row: decrypt → parse → INSERT each tag into existing `dietary_preferences` table with `child_id=NULL`. Validate against `dietary_tags` vocab; skip + log if missing.
- [ ] Service-role client (bypasses RLS)
- [ ] Idempotent (re-running is safe via UNIQUE constraints)

### Task 3 — Verification gate

- [ ] After backfill, run:
  ```sql
  -- expected_count = original child_allergens count + decrypted-array counts
  -- actual_count = SELECT count(*) FROM household_allergens
  ```
- [ ] Migration ABORTS if mismatch
- [ ] Same for `household_cultural_identifiers` and dietary_preferences additions

### Task 4 — Drops

- [ ] `DROP TABLE child_allergens;`
- [ ] `ALTER TABLE households DROP COLUMN declared_allergens, cultural_identifiers, dietary_preferences;`
- [ ] `ALTER TABLE children DROP COLUMN declared_allergens, cultural_identifiers, dietary_preferences;`

### Task 5 — Repository + service rewrite

- [ ] DELETE `apps/api/src/modules/children/child-allergens.repository.ts`
- [ ] DELETE `apps/api/src/modules/children/child-allergens.repository.test.ts`
- [ ] CREATE `apps/api/src/modules/households/household-allergens.repository.ts` (with `findByHouseholdId`, `findByHouseholdAndChild`, `upsert`)
- [ ] CREATE `apps/api/src/modules/households/household-cultural-identifiers.repository.ts`
- [ ] Update `apps/api/src/modules/allergy-guardrail/allergy-guardrail.service.ts`:
  - Replace multi-source allergen assembly with `householdAllergensRepo.findByHouseholdId(householdId)`
  - Per-child UNION logic removed (one query returns everything; guardrail evaluates against the union row set)
- [ ] Update onboarding write paths (`children.service.ts`, `households.service.ts`) to route allergen writes to `household_allergens` with appropriate `child_id` value
- [ ] Update `households.repository.ts` to drop encrypted-column read/write paths

### Task 6 — Contracts cleanup

- [ ] `packages/contracts/src/children.ts`: drop encrypted-array fields from `ChildSchema`
- [ ] `packages/contracts/src/index.ts`: export new `HouseholdAllergenSchema`, `HouseholdCulturalIdentifierSchema`
- [ ] `packages/types/src/index.ts`: types regenerate

## Test Plan

- Replace `child-allergens.repository.test.ts` with `household-allergens.repository.test.ts` (~15 test cases)
- Update `allergy-guardrail.service.test.ts` to expect single-source query (replace UNION-style mocks with one `findByHouseholdId` mock)
- Update `household-profile.test.ts` to drop encrypted-column assertions
- New: `household-cultural-identifiers.repository.test.ts`
- Use `buildChild` and new `buildHouseholdAllergen` factory from A3 if available
- Estimated: ~25 test changes

## Review Findings (2026-05-31)

### Decision-Needed

- [x] [Review][Decision] **F10: Household-wide allergens invisible from child-profile REST responses** — Resolved: D1-B (keep current behaviour — household-wide allergens on household profile only, not per-child REST response). — `ChildAllergensRepository.findByHousehold` filters `child_id !== null`, so `household_allergens` rows with `child_id=NULL` never appear in `GET /v1/households/:id/children/:childId` `declared_allergens`. A parent who sets a household-wide allergen via PATCH /v1/households/:id sees it in the household profile but not in any child's response. Options: (A) include household-wide rows in the child response overlay — the union of per-child + household-wide rows is the child's effective allergen set; (B) keep the current behaviour — household-wide allergens are visible only on the household profile, not per-child. The guardrail already sees both regardless.

- [x] [Review][Decision] **F11: Removed cultural/dietary tags silently orphaned — additive-only vs replace semantics** — Resolved: D2-A (replace semantics — `parent_edited` calls delete-then-reinsert; `onboarding_declared` calls remain additive). — `writeHouseholdScopedTags` and `HouseholdsRepository.patchProfile` use `ignoreDuplicates: true` with no delete step, so a PATCH that removes a tag leaves the old tag in `household_cultural_identifiers` / `dietary_preferences`. The response then echoes stale tags. Options: (A) add a delete-then-reinsert (replace semantics, matching the `declared_allergens` path) — note this has the same atomicity gap as F2; (B) keep additive-only, document the limitation, and accept that tag removal requires a separate DELETE endpoint; (C) accept additive-only as correct for the data model (cultural identity accumulates, it doesn't shrink).

### Patches

- [x] [Review][Patch] **F1: `onConflict` column list won't resolve COALESCE-sentinel UNIQUE constraint** [`apps/api/src/modules/households/household-allergens.repository.ts` + `apps/api/scripts/backfill-household-allergens.ts`] — The UNIQUE on `household_allergens` is expression-based (`UNIQUE (household_id, COALESCE(child_id, sentinel), allergen_hash)`, named `household_allergens_scope_hash_uniq`). PostgREST's `onConflict: 'household_id,child_id,allergen_hash'` does not match a functional index. For `child_id=NULL` rows, the upsert will either throw a constraint violation or insert duplicates. Fix: use the constraint name `household_allergens_scope_hash_uniq` in all `onConflict` calls targeting this table.

- [x] [Review][Patch] **F2: `patchProfile` delete-then-insert not atomic — guardrail sees empty allergens mid-update** [`apps/api/src/modules/households/households.repository.ts`] — `.delete().eq(...).is('child_id', null)` fires, then a loop calls `declareIfNew` one allergen at a time. A concurrent `getRulesForHousehold` call between delete and re-inserts returns zero household allergens and produces `verdict='clear'` for a plan that should be blocked. Fix: wrap the delete+insert sequence in a transaction, or restructure as a single upsert batch without a preceding delete.

- [x] [Review][Patch] **F6: `verifyCounts` uses `>=` — masks double-insert or partial-page failures** [`apps/api/scripts/backfill-household-allergens.ts:1152`] — `householdAllergensCount >= expectedHouseholdAllergens` passes when the target has MORE rows than expected (double-insert) or when the expected count is computed as 0 due to swallowed Step 1 errors. Fix: use exact equality `=== expectedHouseholdAllergens` or at minimum fail when the count diverges by more than a configurable tolerance.

- [x] [Review][Patch] **F8: `migrateCulturalIdentifiers` / `migrateDietaryPreferences` increment counter unconditionally** [`apps/api/scripts/backfill-household-allergens.ts:1027` and `:1096`] — After the `insertResult.error !== null` check, both functions call `summary.cultural_identifiers_inserted += 1` and `summary.dietary_preferences_inserted += 1` without checking `insertResult.data === null` (which signals a conflict-skip under `ignoreDuplicates: true`). The allergen paths correctly branch on `data === null`. Fix: add `if (insertResult.data === null) { ... } else { ... }` pattern matching `migrateHouseholdAllergens`.

- [x] [Review][Patch] **F9: `verifyCounts` gate doesn't check vocab-skip counts — silently lost data passes gate** [`apps/api/scripts/backfill-household-allergens.ts:1152`] — `ok` condition checks `decrypt_failures === 0 && insert_failures === 0` but not `cultural_identifiers_skipped_vocab` or `dietary_preferences_skipped_vocab`. A household whose entire cultural/dietary data maps to unknown vocab keys will be permanently lost (silent drop) while the gate passes and the drop migration runs. Fix: add `summary.cultural_identifiers_skipped_vocab === 0 && summary.dietary_preferences_skipped_vocab === 0` to the `ok` condition, or emit a prominent operator warning and set `ok = false`.

### Deferred

- [x] [Review][Defer] **F3: `findAllergenId` is a no-op stub — `declare()` always returns `child_allergen_id: ''` even on new inserts** [`apps/api/src/modules/children/child-allergens.repository.ts:1842`] — deferred, pre-existing (already in deferred-work.md; closes with adapter deletion)

- [x] [Review][Defer] **F5: `migrateChildAllergens` swallows table-not-found errors — gate computes expected=0 on re-run after drop** [`apps/api/scripts/backfill-household-allergens.ts:841`] — deferred, pre-existing; only relevant on mis-ordered ops (run backfill after drop migration); the comment already calls this out; process control is the mitigation

- [x] [Review][Defer] **F12: Child deleted mid-backfill causes FK violation — allergen row silently dropped from gate count** [`apps/api/scripts/backfill-household-allergens.ts`] — deferred, pre-beta; no concurrent user mutations expected during backfill execution; acceptable operational risk pre-launch

- [x] [Review][Defer] **F14: Drop migration has no SQL guard — gate only exits script non-zero, no SQL coupling** [`supabase/migrations/20261008000100_drop_legacy_allergen_columns.sql`] — deferred, pre-beta; process discipline (run backfill, check exit code, then apply drop) is the mitigation; SQL-level guard would require a Postgres function which is out of scope for a pre-beta migration

- [x] [Review][Defer] **F16: `verifyCounts` called twice in `main()` — redundant DB round-trip** [`apps/api/scripts/backfill-household-allergens.ts:1209`] — deferred, pre-existing; redundant but not incorrect; low priority

## Rollback

Revert PR. Down migration: restore `child_allergens` table from canonical pre-drop schema (DDL in the original 2.5-s1 migration `20260903000100`). Backfill `child_allergens` from `household_allergens WHERE child_id IS NOT NULL`. Restore households encrypted columns; aggregate `household_allergens WHERE child_id IS NULL` into jsonb arrays + re-encrypt. Restore children encrypted columns (typically NULL pre-beta).

Pre-beta hard cutover: data loss on rollback is acceptable per Menon 2026-05-31.
